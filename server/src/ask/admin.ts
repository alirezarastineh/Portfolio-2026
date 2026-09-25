import { zValidator } from "@hono/zod-validator";
import { createUIMessageStreamResponse, generateText, Output } from "ai";
import { and, asc, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { PublicationError } from "../content/publish.js";
import { LOCALES } from "../content/schema.js";
import { getDb } from "../db/client.js";
import {
  aiFaq,
  aiFaqTranslations,
  aiFeedback,
  aiMessages,
  aiSettings,
  aiUsage,
} from "../db/schema.js";
import { streamAnswer } from "./agent.js";
import type { AskConfig } from "./config.js";
import { askChain, askConfig, askCorpus, askDraftCorpus } from "./deps.js";
import { availability, hashWithSalt } from "./guard.js";
import { buildHistory } from "./history.js";
import { createFallbackModel, newTrace, type ModelCall, type Trace } from "./models/fallback.js";
import { breakerSnapshot } from "./models/circuit.js";
import { capsOf, configuredModels, shortName, type ChainRole } from "./models/registry.js";
import { buildInstructions, PROMPT_HASH, PROMPT_VERSION } from "./prompt.js";
import { EVAL_CASES } from "./evals/cases.js";
import { fixtureAskCorpus } from "./evals/fixture.js";
import { FREE_TIER_EVAL_PACING, FREE_TIER_RATE_LIMIT_RETRY, runEvals } from "./evals/run.js";
import { routeQuestion } from "./router.js";
import { SESSION_ID, streamsInFlight } from "./route.js";
import { invalidateAssistantCache, readAiSettings, readFaq } from "./settings.js";
import { countTokens } from "./tokens.js";
import { recordUsage } from "./usage.js";

/**
 * The admin's "Assistant" page: settings, health, usage, conversations, the
 * FAQ, visitor-question insights, a playground against the draft content, and
 * the editor copilot. Mounted under /admin, which supplies auth and CSRF.
 */
export const adminAskRouter = new Hono();

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

/** A model call outside the visitor stream (insights, copilot): same chain, budget and accounting. */
async function oneShot<T>(
  config: AskConfig,
  role: ChainRole,
  run: (model: ReturnType<typeof createFallbackModel>) => Promise<T>,
): Promise<{ ok: true; value: T; trace: Trace } | { ok: false; error: string }> {
  const settings = await readAiSettings();
  const state = await availability(config, { ...settings, enabled: true });
  if (state.state === "off") return { ok: false, error: "assistant_off" };
  if (state.state === "resting") return { ok: false, error: "assistant_resting" };
  const chain = askChain(config, role);
  if (!chain.length) return { ok: false, error: "assistant_off" };
  const trace = newTrace();
  const model = createFallbackModel({
    entries: chain,
    trace,
    firstChunkTimeoutMs: config.firstChunkTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    estimateTokens: (options) => countTokens(JSON.stringify(options.prompt)),
  });
  try {
    const value = await run(model);
    return { ok: true, value, trace };
  } catch (error) {
    console.error(`[ask] ${role} call failed`, error);
    return { ok: false, error: "unavailable" };
  } finally {
    if (trace.calls.length) await recordUsage(trace.calls).catch(() => undefined);
  }
}

/* ---------------------------------------------------------------- settings */

const settingsInput = z.object({
  enabled: z.boolean(),
  dailyBudgetUsd: z.number().min(0.01).max(100).nullable(),
  deepEnabled: z.boolean(),
  suggestedQuestions: z.object(
    Object.fromEntries(
      LOCALES.map((l) => [l, z.array(z.string().trim().min(3).max(120)).max(6)]),
    ) as Record<(typeof LOCALES)[number], z.ZodArray<z.ZodString>>,
  ),
  systemCard: z.object(
    Object.fromEntries(LOCALES.map((l) => [l, z.string().max(4000)])) as Record<
      (typeof LOCALES)[number],
      z.ZodString
    >,
  ),
});

function envSummary(config: AskConfig) {
  const chain = (role: ChainRole) =>
    askChain(config, role).map((e) => ({
      id: e.id,
      provider: e.provider,
      tools: e.tools,
      contextWindow: e.contextWindow,
      available: e.available,
    }));
  return {
    enabled: config.enabled,
    unavailableReason: config.unavailableReason,
    defaultBudgetUsd: config.dailyBudgetUsd,
    keys: { gemini: !!config.gemini.apiKey, openrouter: !!config.openrouter.apiKey },
    chains: {
      lite: chain("lite"),
      deep: chain("deep"),
      copilot: chain("copilot"),
      insight: chain("insight"),
    },
    limits: {
      ratePerHour: config.ratePerHour,
      ratePerDay: config.ratePerDay,
      maxConcurrent: config.maxConcurrent,
      maxOutputTokens: config.maxOutputTokens,
      historyTurns: config.historyTurns,
    },
    prompt: `${PROMPT_VERSION}+${PROMPT_HASH}`,
  };
}

adminAskRouter.get("/assistant/settings", async (c) => {
  const config = askConfig();
  return c.json({ settings: await readAiSettings(), env: envSummary(config) });
});

adminAskRouter.put("/assistant/settings", zValidator("json", settingsInput, invalid), async (c) => {
  const input = c.req.valid("json");
  const now = new Date();
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, ...input, updatedAt: now })
    .onConflictDoUpdate({ target: aiSettings.id, set: { ...input, updatedAt: now } });
  invalidateAssistantCache();
  return c.json({ ok: true, settings: await readAiSettings() });
});

/* ------------------------------------------------------------------ health */

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

adminAskRouter.get("/assistant/health", async (c) => {
  const config = askConfig();
  const settings = await readAiSettings();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .select({
      model: aiMessages.model,
      ttftMs: aiMessages.ttftMs,
      attempts: aiMessages.attempts,
      finishReason: aiMessages.finishReason,
    })
    .from(aiMessages)
    .where(and(gte(aiMessages.createdAt, since), eq(aiMessages.source, "terminal")));

  const firstChoice = askChain(config, "lite")[0]?.id;
  const byModel = new Map<string, number[]>();
  let fallbacks = 0;
  let failures = 0;
  for (const row of rows) {
    if (!row.model) {
      failures++;
      continue;
    }
    if (row.model !== firstChoice && row.model !== askChain(config, "deep")[0]?.id) fallbacks++;
    const list = byModel.get(row.model) ?? [];
    if (row.ttftMs !== null) list.push(row.ttftMs);
    byModel.set(row.model, list);
  }

  let corpus: {
    key: string;
    documents: Record<string, number>;
    coreChars: number;
    coreTokens: number;
  } | null = null;
  try {
    const current = await askCorpus(config);
    const kinds: Record<string, number> = {};
    for (const d of current.documents) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    corpus = {
      key: current.key,
      documents: kinds,
      coreChars: current.core.length,
      coreTokens: current.coreTokens,
    };
  } catch (error) {
    console.error("[ask] corpus unavailable for health", error);
  }

  return c.json({
    state: await availability(config, settings),
    inFlight: streamsInFlight(),
    breakers: breakerSnapshot(configuredModels(config)),
    last24h: {
      answers: rows.length,
      failures,
      fallbackRate: rows.length ? fallbacks / rows.length : 0,
      models: [...byModel].map(([model, ttft]) => ({
        model,
        answers: ttft.length,
        p50TtftMs: percentile(ttft, 0.5),
        p95TtftMs: percentile(ttft, 0.95),
        caps: capsOf(model),
      })),
    },
    corpus,
  });
});

/** Gemini's own count of the prefix (free); the page shows the local estimate otherwise. */
adminAskRouter.post("/assistant/corpus/count", async (c) => {
  const config = askConfig();
  if (!config.gemini.apiKey) return c.json({ error: "no_gemini_key" }, 400);
  const corpus = await askCorpus(config);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:countTokens`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.gemini.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildInstructions(corpus.core) }] }],
      }),
      signal: AbortSignal.timeout(10_000),
    },
  ).catch(() => null);
  if (!res?.ok) return c.json({ error: "count_failed" }, 502);
  const { totalTokens } = (await res.json()) as { totalTokens?: number };
  return c.json({
    model: config.gemini.model,
    totalTokens: totalTokens ?? null,
    estimate: corpus.coreTokens,
  });
});

adminAskRouter.get("/assistant/corpus", async (c) => {
  const draft = c.req.query("draft") === "1";
  const config = askConfig();
  try {
    const corpus = draft ? await askDraftCorpus(config) : await askCorpus(config);
    return c.json({
      key: corpus.key,
      coreTokens: corpus.coreTokens,
      documents: corpus.documents.map((d) => ({
        id: d.id,
        kind: d.kind,
        locale: d.locale,
        title: d.title,
        url: d.url,
        chars: d.text.length,
      })),
    });
  } catch (error) {
    if (error instanceof PublicationError) return c.json({ error: error.code }, 422);
    throw error;
  }
});

/* ------------------------------------------------------------------- usage */

adminAskRouter.get("/assistant/usage", async (c) => {
  const days = Math.min(90, Math.max(1, Number.parseInt(c.req.query("days") ?? "30", 10) || 30));
  const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const models = await getDb()
    .select()
    .from(aiUsage)
    .where(gte(aiUsage.day, since))
    .orderBy(asc(aiUsage.day), asc(aiUsage.model));

  const answers = await getDb()
    .select({
      day: sql<string>`to_char(${aiMessages.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      answers: sql<number>`count(*)::int`,
      up: sql<number>`count(${aiFeedback.messageId}) filter (where ${aiFeedback.value} = 1)::int`,
      down: sql<number>`count(${aiFeedback.messageId}) filter (where ${aiFeedback.value} = -1)::int`,
    })
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(
      and(
        gte(aiMessages.createdAt, new Date(`${since}T00:00:00Z`)),
        eq(aiMessages.source, "terminal"),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return c.json({ days, models, answers });
});

/* ----------------------------------------------------------- conversations */

/** Answers that admit the portfolio does not say: the list worth turning into FAQ entries. */
const UNKNOWN_ANSWER = sql`(${aiMessages.answerExcerpt} ~* '(not (in|part of|mentioned in) (the|this|his|my) (portfolio|documents|site|content)|no information|isn''t (mentioned|covered)|nicht (im|in den|auf der) (portfolio|dokumenten|unterlagen|website)|keine (informationen|angaben))')`;

adminAskRouter.get("/assistant/conversations", async (c) => {
  const filter = c.req.query("filter");
  const source = c.req.query("source") === "playground" ? "playground" : "terminal";
  const before = c.req.query("before");
  const conditions: SQL[] = [eq(aiMessages.source, source)];
  if (before && !Number.isNaN(Date.parse(before)))
    conditions.push(lt(aiMessages.createdAt, new Date(before)));
  if (filter === "down") conditions.push(eq(aiFeedback.value, -1));
  if (filter === "unknown") conditions.push(UNKNOWN_ANSWER);
  if (filter === "failed") conditions.push(sql`${aiMessages.finishReason} like 'error:%'`);

  const rows = await getDb()
    .select({
      id: aiMessages.id,
      createdAt: aiMessages.createdAt,
      session: sql<string>`left(${aiMessages.sessionHash}, 10)`,
      locale: aiMessages.locale,
      route: aiMessages.route,
      question: aiMessages.questionRedacted,
      answer: aiMessages.answerExcerpt,
      citedIds: aiMessages.citedIds,
      toolCalls: aiMessages.toolCalls,
      model: aiMessages.model,
      attempts: aiMessages.attempts,
      ttftMs: aiMessages.ttftMs,
      totalMs: aiMessages.totalMs,
      tokens: aiMessages.tokens,
      usd: aiMessages.usd,
      finishReason: aiMessages.finishReason,
      promptVersion: aiMessages.promptVersion,
      feedback: aiFeedback.value,
    })
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(and(...conditions))
    .orderBy(desc(aiMessages.createdAt))
    .limit(100);
  return c.json({ messages: rows });
});

/* --------------------------------------------------------------------- FAQ */

const faqInput = z.object({
  isVisible: z.boolean(),
  translations: z
    .object(
      Object.fromEntries(
        LOCALES.map((l) => [
          l,
          z
            .object({
              question: z.string().trim().min(3).max(300),
              answer: z.string().trim().min(3).max(3000),
            })
            .optional(),
        ]),
      ) as Record<
        (typeof LOCALES)[number],
        z.ZodOptional<z.ZodObject<{ question: z.ZodString; answer: z.ZodString }>>
      >,
    )
    .refine((t) => Object.values(t).some(Boolean), { message: "at least one language" }),
});

const idParam = zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
  result.success ? undefined : c.json({ error: "invalid_id" }, 400),
);

adminAskRouter.get("/assistant/faq", async (c) => c.json({ faq: await readFaq() }));

adminAskRouter.post("/assistant/faq", zValidator("json", faqInput, invalid), async (c) => {
  const input = c.req.valid("json");
  const id = await getDb().transaction(async (tx) => {
    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${aiFaq.position}) + 1, 0)::int` })
      .from(aiFaq);
    const [row] = await tx
      .insert(aiFaq)
      .values({ position: next, isVisible: input.isVisible })
      .returning({ id: aiFaq.id });
    const translations = LOCALES.flatMap((locale) => {
      const t = input.translations[locale];
      return t ? [{ faqId: row!.id, locale, ...t }] : [];
    });
    await tx.insert(aiFaqTranslations).values(translations);
    return row!.id;
  });
  invalidateAssistantCache();
  return c.json({ ok: true, id }, 201);
});

adminAskRouter.put(
  "/assistant/faq/:id",
  idParam,
  zValidator("json", faqInput, invalid),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const found = await getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(aiFaq)
        .set({ isVisible: input.isVisible, updatedAt: new Date() })
        .where(eq(aiFaq.id, id))
        .returning({ id: aiFaq.id });
      if (!row) return false;
      await tx.delete(aiFaqTranslations).where(eq(aiFaqTranslations.faqId, id));
      const translations = LOCALES.flatMap((locale) => {
        const t = input.translations[locale];
        return t ? [{ faqId: id, locale, ...t }] : [];
      });
      await tx.insert(aiFaqTranslations).values(translations);
      return true;
    });
    if (!found) return c.json({ error: "not_found" }, 404);
    invalidateAssistantCache();
    return c.json({ ok: true });
  },
);

adminAskRouter.delete("/assistant/faq/:id", idParam, async (c) => {
  const [row] = await getDb()
    .delete(aiFaq)
    .where(eq(aiFaq.id, c.req.valid("param").id))
    .returning({ id: aiFaq.id });
  if (!row) return c.json({ error: "not_found" }, 404);
  invalidateAssistantCache();
  return c.json({ ok: true });
});

adminAskRouter.patch(
  "/assistant/faq-order",
  zValidator("json", z.object({ ids: z.array(z.uuid()).max(200) }), invalid),
  async (c) => {
    const { ids } = c.req.valid("json");
    if (!ids.length) return c.json({ ok: true });
    const values = sql.join(
      ids.map((id, position) => sql`(${id}::uuid, ${position}::int)`),
      sql`, `,
    );
    await getDb().execute(sql`
      update ${aiFaq} set position = v.position, updated_at = now()
      from (values ${values}) as v(id, position)
      where ${aiFaq.id} = v.id
    `);
    invalidateAssistantCache();
    return c.json({ ok: true });
  },
);

/* ---------------------------------------------------------------- insights */

const insightSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().describe("A short topic name, e.g. 'Availability and notice period'"),
        summary: z.string().describe("One sentence: what visitors keep asking"),
        questions: z.number().int().describe("How many of the questions belong here"),
        examples: z.array(z.string()).max(3).describe("Up to 3 representative questions, verbatim"),
        unanswered: z.boolean().describe("True when the assistant mostly could not answer these"),
      }),
    )
    .max(12),
});

export type InsightTopics = z.infer<typeof insightSchema>;

let insightCache:
  { at: number; key: string; value: InsightTopics & { analysed: number } } | undefined;

adminAskRouter.post("/assistant/insights", async (c) => {
  const config = askConfig();
  const refresh = c.req.query("refresh") === "1";
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .select({
      id: aiMessages.id,
      question: aiMessages.questionRedacted,
      unknown: sql<boolean>`${UNKNOWN_ANSWER}`,
      down: sql<boolean>`coalesce(${aiFeedback.value} = -1, false)`,
    })
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(and(gte(aiMessages.createdAt, since), eq(aiMessages.source, "terminal")))
    .orderBy(desc(aiMessages.createdAt))
    .limit(300);

  if (!rows.length) return c.json({ topics: [], analysed: 0 });
  const key = rows[0]!.id;
  if (
    !refresh &&
    insightCache?.key === key &&
    Date.now() - insightCache.at < config.insightCacheTtlMs
  ) {
    return c.json({ ...insightCache.value, cached: true });
  }

  const list = rows
    .map(
      (r) =>
        `- ${r.question.replace(/\s+/g, " ").slice(0, 300)}${r.unknown || r.down ? " [not answered]" : ""}`,
    )
    .join("\n");
  const result = await oneShot(config, "insight", (model) =>
    generateText({
      model,
      maxRetries: 0,
      maxOutputTokens: 2_000,
      output: Output.object({ schema: insightSchema }),
      instructions:
        "You group questions that visitors asked a portfolio's AI assistant into topics, so its owner sees what recruiters and engineers want to know and what the assistant could not answer. Questions marked [not answered] got no useful answer. Write in English. Use only the questions given.",
      prompt: `Questions (newest first):\n${list}`,
    }).then((r) => r.output),
  );
  if (!result.ok) return c.json({ error: result.error }, 503);

  const value = { ...result.value, analysed: rows.length };
  insightCache = { at: Date.now(), key, value };
  return c.json(value);
});

/* -------------------------------------------------------------- playground */

adminAskRouter.post("/assistant/playground", async (c) => {
  const parsed = z
    .object({
      sessionId: z.string().regex(SESSION_ID),
      locale: z.enum(["en", "de"]),
      deep: z.boolean().optional(),
      messages: z.array(z.unknown()).min(1).max(40),
    })
    .safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const body = parsed.data;

  const config = askConfig();
  // The admin's switch turns the public assistant off, not the playground.
  const settings = await readAiSettings();
  const state = await availability(config, { ...settings, enabled: true });
  if (state.state === "off") return c.json({ error: "assistant_off" }, 503);
  if (state.state === "resting") return c.json({ error: "assistant_resting" }, 503);

  const history = await buildHistory({
    messages: body.messages,
    sessionId: body.sessionId,
    locale: body.locale,
    historyTurns: config.historyTurns,
    maxInputTokens: Math.max(2_000, Math.floor(config.maxInputTokens * 0.25)),
    maxChars: 2_000,
  });
  if (!history.ok) return c.json({ error: history.error }, 400);

  let corpus;
  try {
    corpus = await askDraftCorpus(config);
  } catch (error) {
    if (error instanceof PublicationError) return c.json({ error: error.code }, 422);
    throw error;
  }
  const route = routeQuestion(history.question, {
    forceDeep: body.deep ?? false,
    deepAllowed: state.deepAllowed,
    projectNames: corpus.projects.map((p) => p.name),
  });
  const chain = askChain(config, route.route);
  if (!chain.length) return c.json({ error: "assistant_off" }, 503);

  const { stream } = streamAnswer({
    messages: history.messages,
    question: history.question,
    locale: body.locale,
    language: history.language,
    sessionId: body.sessionId,
    sessionHash: hashWithSalt("session", body.sessionId),
    source: "playground",
    route,
    corpus,
    config,
    chain,
    abortSignal: c.req.raw.signal,
    droppedAnswers: history.droppedAnswers,
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
});

/* ------------------------------------------------------------------- evals */

let evalRunning = false;

/**
 * The eval suite on demand, against the frozen fixture corpus. The page asks
 * for confirmation because it consumes configured-provider quota. Usage counts
 * toward the daily budget like any other call.
 */
adminAskRouter.post(
  "/assistant/evals",
  zValidator("json", z.object({ cases: z.array(z.string().max(40)).max(60).optional() }), invalid),
  async (c) => {
    if (evalRunning) return c.json({ error: "already_running" }, 409);
    const config = askConfig();
    const settings = await readAiSettings();
    const state = await availability(config, { ...settings, enabled: true });
    if (state.state !== "ok") return c.json({ error: `assistant_${state.state}` }, 503);

    const wanted = c.req.valid("json").cases;
    const cases = wanted?.length ? EVAL_CASES.filter((e) => wanted.includes(e.id)) : EVAL_CASES;
    const calls: ModelCall[] = [];
    evalRunning = true;
    try {
      const summary = await runEvals({
        cases,
        corpus: fixtureAskCorpus(config),
        config,
        chain: (role) => askChain(config, role),
        concurrency: 1,
        pacing: FREE_TIER_EVAL_PACING,
        rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
        stopOnUnavailable: true,
        abortSignal: c.req.raw.signal,
        promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
        calls,
      });
      return c.json(summary);
    } finally {
      evalRunning = false;
      if (calls.length) await recordUsage(calls).catch(() => undefined);
    }
  },
);

/* ----------------------------------------------------------------- copilot */

const copilotInput = z.discriminatedUnion("task", [
  z.object({
    task: z.literal("translate"),
    text: z.string().min(1).max(20_000),
    from: z.enum(["en", "de"]),
    to: z.enum(["en", "de"]),
    /** Rich-text fields send HTML; the markup must come back unchanged. */
    html: z.boolean().default(false),
  }),
  z.object({
    task: z.literal("tighten"),
    text: z.string().min(1).max(2_000),
    locale: z.enum(["en", "de"]),
    maxLength: z.number().int().min(10).max(2_000).optional(),
  }),
  z.object({
    task: z.literal("seo"),
    text: z.string().min(1).max(20_000),
    locale: z.enum(["en", "de"]),
    maxLength: z.number().int().min(50).max(320).default(155),
  }),
  z.object({
    task: z.literal("faq-answer"),
    question: z.string().min(3).max(300),
    locale: z.enum(["en", "de"]),
  }),
]);

const LANGUAGE = { en: "English", de: "German" } as const;

adminAskRouter.post("/ai/copilot", zValidator("json", copilotInput, invalid), async (c) => {
  const input = c.req.valid("json");
  const config = askConfig();

  let instructions: string;
  let prompt: string;
  let maxLength: number | undefined;
  switch (input.task) {
    case "translate":
      if (input.from === input.to) return c.json({ text: input.text });
      instructions = `Translate the text from ${LANGUAGE[input.from]} to ${LANGUAGE[input.to]} for a senior engineer's portfolio. Keep technical terms, product names, numbers and code unchanged; keep the tone. ${input.html ? "The text is HTML: keep every tag and attribute exactly as it is and translate only the text between tags." : "Return plain text."} Return only the translation.`;
      prompt = input.text;
      break;
    case "tighten": {
      maxLength = input.maxLength;
      const limit = maxLength ? `At most ${maxLength} characters. ` : "";
      instructions = `Rewrite the text in ${LANGUAGE[input.locale]} to be shorter and sharper, keeping every fact. ${limit}No quotes, no preamble. Return only the rewritten text.`;
      prompt = input.text;
      break;
    }
    case "seo":
      maxLength = input.maxLength;
      instructions = `Write a search-result description in ${LANGUAGE[input.locale]} for this page of a senior AI / full-stack engineer's portfolio: specific, factual, no hype, at most ${maxLength} characters. Return only the description.`;
      prompt = input.text.replace(/<[^<>]{1,1000}>/g, " ").slice(0, 8_000);
      break;
    case "faq-answer": {
      const corpus = await askCorpus(config);
      instructions = `Draft an answer in ${LANGUAGE[input.locale]} to a question visitors ask about Alireza Rastineh, using only the portfolio documents below. Third person, at most 80 words. If the documents do not answer it, write exactly: NO_ANSWER\n\n# Portfolio documents\n\n${corpus.core}`;
      prompt = input.question;
      break;
    }
  }

  const result = await oneShot(config, "copilot", (model) =>
    generateText({
      model,
      instructions,
      prompt,
      maxRetries: 0,
      maxOutputTokens: 4_000,
      temperature: 0.2,
    }).then((r) => r.text.trim()),
  );
  if (!result.ok) return c.json({ error: result.error }, 503);
  let text = result.value;
  if (maxLength && text.length > maxLength) {
    const cut = text.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(" ");
    text = lastSpace > 0 ? cut.slice(0, lastSpace).trimEnd() : cut;
  }
  return c.json({ text, model: shortName(result.trace.calls.at(-1)?.model ?? "") });
});
