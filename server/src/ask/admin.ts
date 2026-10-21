import { zValidator } from "@hono/zod-validator";
import { createUIMessageStreamResponse } from "ai";
import { and, asc, desc, eq, gte, inArray, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { PublicationError } from "../content/publish.js";
import { LOCALES, type Locale } from "../content/schema.js";
import { getDb } from "../db/client.js";
import {
  aiFaq,
  aiFaqTranslations,
  aiFeedback,
  aiGuardEvents,
  aiMcpUsage,
  aiMessages,
  aiReviews,
  aiSettings,
  aiUsage,
  aiUsageFeatures,
  contactMessages,
} from "../db/schema.js";
import { streamAnswer } from "./agent.js";
import { audit, countOpenAlerts, readDemotions } from "./audit.js";
import { OUTCOME_COLUMNS, UNKNOWN_ANSWER } from "./outcome-rows.js";
import type { AskConfig } from "./config.js";
import { largestCore } from "./corpus/index.js";
import { embeddingStatus } from "./embeddings.js";
import {
  askChain,
  askConfig,
  askCorpus,
  askDraftCorpus,
  askEvalPacing,
  askVisitorJudges,
} from "./deps.js";
import {
  FEATURES,
  FENCED_FEATURES,
  isSwitched,
  MAX_PUBLIC_RESERVE,
  reserveLine,
  SWITCHED_FEATURES,
} from "./features.js";
import { availability, hashWithSalt, refusal, spendByFeature, stateFor } from "./guard.js";
import { buildHistory, historyLimits } from "./history.js";
import type { ModelCall } from "./models/fallback.js";
import { breakerSnapshot } from "./models/circuit.js";
import { capsOf, configuredModels, excludedModels, type ChainRole } from "./models/registry.js";
import {
  browserView,
  completedWeeks,
  outcomes,
  PRIMARY_METRICS,
  shouldRotate,
  weeklyValues,
  type OutcomeRow,
} from "./outcomes.js";
import { buildInstructions, PROMPT_HASH, PROMPT_VERSION } from "./prompt.js";
import {
  buildQueue,
  isoWeek,
  labelStats,
  reviewReasons,
  weekBounds,
  type ReviewLabel,
} from "./reviews.js";
import { evalCasesRouter } from "./eval-cases-routes.js";
import { calibrate, FAITHFUL_AT } from "./evals/calibration.js";
import { faithfulnessRouter } from "./faithfulness-routes.js";
import { EVAL_CASES } from "./evals/cases.js";
import { fixtureAskCorpus } from "./evals/fixture.js";
import { FREE_TIER_RATE_LIMIT_RETRY, runEvals } from "./evals/run.js";
import { routeQuestion } from "./router.js";
import { SESSION_ID, streamsInFlight } from "./route.js";
import { calibrationPairs, reviewedToJudge } from "./runs/judge-work.js";
import { runsRouter } from "./runs/routes.js";
import { claimRequestEval, releaseRequestEval } from "./runs/runner.js";
import { activeRuns } from "./runs/store.js";
import { invalidateAssistantCache, readAiSettings, readFaq, type AiSettings } from "./settings.js";
import {
  insightQuestions,
  insightsNotice,
  latestSnapshot,
  markSeen,
  runInsights,
} from "./insights.js";
import { journalRouter } from "./journal-routes.js";
import { lastLearningCheck } from "./learning-monitor.js";
import { lessonsRouter } from "./lessons-routes.js";
import { perceptionRouter } from "./perception-routes.js";
import { routerReportRouter } from "./router-routes.js";
import { faqProposalsRouter } from "./agent/faq-routes.js";
import { proposalsRouter } from "./agent/routes.js";
import { faqInput, insertFaq } from "./faq.js";
import { skillsRouter } from "./skills/routes.js";
import { trustRouter } from "./trust-routes.js";
import { recordUsage } from "./usage.js";

/**
 * The admin's "Assistant" page: settings, health, usage, conversations, the
 * FAQ, visitor-question insights, a playground against the draft content, and
 * the editor copilot. Mounted under /admin, which supplies auth and CSRF.
 */
export const adminAskRouter = new Hono();

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

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
  // The spending fences (plan phase 13) are optional: the previous admin does
  // not send them, and saving from it keeps what is stored.
  publicReserve: z.number().min(0).max(MAX_PUBLIC_RESERVE).optional(),
  /** Merged into the stored caps: a feature left out keeps its cap; null removes it. */
  featureCaps: z
    .partialRecord(z.enum(FENCED_FEATURES), z.number().min(0.01).max(100).nullable())
    .optional(),
  /** Merged into the stored switches, the same way. */
  featureSwitches: z.partialRecord(z.enum(SWITCHED_FEATURES), z.boolean()).optional(),
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

/** A stored map with these keys replaced: jsonb's `||` keeps every key the patch leaves out. */
const merged = (
  column: typeof aiSettings.featureCaps | typeof aiSettings.featureSwitches,
  patch: object,
) => sql`${column} || ${JSON.stringify(patch)}::jsonb`;

/**
 * What changed among the settings that decide what may spend and when, as
 * "key before → after": the audit's reason for a save (plan phase 14).
 */
export function fenceChanges(before: AiSettings, after: AiSettings): string[] {
  const changes: string[] = [];
  const note = (key: string, was: unknown, now: unknown) => {
    const before = JSON.stringify(was);
    const after = JSON.stringify(now);
    if (before !== after) changes.push(`${key} ${before} → ${after}`);
  };
  note("enabled", before.enabled, after.enabled);
  note("dailyBudgetUsd", before.dailyBudgetUsd, after.dailyBudgetUsd);
  note("deepEnabled", before.deepEnabled, after.deepEnabled);
  note("publicReserve", before.publicReserve, after.publicReserve);
  for (const f of FENCED_FEATURES) {
    note(`featureCaps.${f}`, before.featureCaps[f], after.featureCaps[f]);
  }
  for (const f of SWITCHED_FEATURES) {
    note(`featureSwitches.${f}`, before.featureSwitches[f], after.featureSwitches[f]);
  }
  return changes;
}

adminAskRouter.put("/assistant/settings", zValidator("json", settingsInput, invalid), async (c) => {
  const { featureCaps, featureSwitches, ...input } = c.req.valid("json");
  const before = await readAiSettings();
  const now = new Date();
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, ...input, featureCaps, featureSwitches, updatedAt: now })
    .onConflictDoUpdate({
      target: aiSettings.id,
      set: {
        ...input,
        ...(featureCaps && { featureCaps: merged(aiSettings.featureCaps, featureCaps) }),
        ...(featureSwitches && {
          featureSwitches: merged(aiSettings.featureSwitches, featureSwitches),
        }),
        updatedAt: now,
      },
    });
  invalidateAssistantCache();
  const settings = await readAiSettings();
  const changes = fenceChanges(before, settings);
  if (changes.length) {
    await audit({
      actor: "admin",
      action: "settings.update",
      target: "settings",
      decision: "allowed",
      reason: changes.join("; "),
    }).catch((error) => console.error("[ask] settings change not audited", error));
  }
  return c.json({ ok: true, settings });
});

/* ------------------------------------------------------------------ health */

/**
 * Today's spend by feature against its lines, for the Overview. Each
 * feature's state is the one its next call would get: ok, off (a switch),
 * or the line it reached (budget, reserve, cap).
 */
async function spendView(config: AskConfig, settings: AiSettings) {
  const { totalUsd, features } = await spendByFeature();
  const budgetUsd = settings.dailyBudgetUsd ?? config.dailyBudgetUsd;
  return {
    totalUsd,
    budgetUsd,
    publicReserve: settings.publicReserve,
    reserveLineUsd: reserveLine(budgetUsd, settings.publicReserve),
    features: FEATURES.map((feature) => {
      const spentUsd = features.get(feature) ?? 0;
      const state = stateFor(config, settings, feature, { totalUsd, ownUsd: spentUsd });
      return {
        feature,
        spentUsd,
        capUsd: feature === "terminal" ? null : settings.featureCaps[feature],
        switchedOn: isSwitched(feature) ? settings.featureSwitches[feature] : null,
        state: state.state === "resting" ? state.line : state.state,
      };
    }),
  };
}

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
    /** The larger reading locale's core, as before per-locale cores (an older admin reads these). */
    coreChars: number;
    coreTokens: number;
    byLocale: Record<Locale, { chars: number; tokens: number }>;
    /** Hybrid search (plan phase 18): on, the model, chunks and how many have a vector. */
    embeddings: Awaited<ReturnType<typeof embeddingStatus>>;
  } | null = null;
  try {
    const current = await askCorpus(config);
    const kinds: Record<string, number> = {};
    for (const d of current.documents) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    const largest = largestCore(current);
    corpus = {
      key: current.key,
      documents: kinds,
      coreChars: largest.chars,
      coreTokens: largest.tokens,
      byLocale: Object.fromEntries(
        LOCALES.map((l) => [l, { chars: current.core[l].length, tokens: current.coreTokens[l] }]),
      ) as Record<Locale, { chars: number; tokens: number }>,
      embeddings: await embeddingStatus(current, config),
    };
  } catch (error) {
    console.error("[ask] corpus unavailable for health", error);
  }

  return c.json({
    state: await availability(config, settings, "terminal"),
    spend: await spendView(config, settings),
    // For the Overview's banner: what a human should look at (the Trust tab has the rest).
    trust: { alerts: await countOpenAlerts(), demoted: await readDemotions() },
    // Insights the adaptive trigger ran, not seen yet (plan phase 25).
    learning: { notice: await insightsNotice() },
    inFlight: streamsInFlight(),
    // The free-tier guard (visitor plan V1, D16): whether it is on, and what it left out.
    models: { freeOnly: config.freeOnly, excluded: excludedModels(config) },
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

/**
 * Gemini's own count of the prefix per reading locale (free); the page shows
 * the local estimate otherwise. `totalTokens` and `estimate` are the English
 * ones, as an older admin reads them.
 */
adminAskRouter.post("/assistant/corpus/count", async (c) => {
  const config = askConfig();
  const apiKey = config.gemini.apiKey;
  if (!apiKey) return c.json({ error: "no_gemini_key" }, 400);
  const corpus = await askCorpus(config);
  const count = async (locale: Locale): Promise<number | null> => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:countTokens`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildInstructions(corpus.core[locale]) }] }],
        }),
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => null);
    if (!res?.ok) return null;
    const { totalTokens } = (await res.json()) as { totalTokens?: number };
    return totalTokens ?? null;
  };
  const [en, de] = await Promise.all([count("en"), count("de")]);
  if (en === null && de === null) return c.json({ error: "count_failed" }, 502);
  return c.json({
    model: config.gemini.model,
    totalTokens: en,
    estimate: corpus.coreTokens.en,
    byLocale: {
      en: { totalTokens: en, estimate: corpus.coreTokens.en },
      de: { totalTokens: de, estimate: corpus.coreTokens.de },
    },
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
  // The model whose cache hits matter: the lite chain's first, which answers most questions.
  const primaryModel = askChain(askConfig(), "lite")[0]?.id ?? null;
  const byPrimary = sql`${aiMessages.model} = ${primaryModel}`;

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
      withDropped: sql<number>`count(*) filter (where jsonb_array_length(${aiMessages.droppedCitations}) > 0)::int`,
      flagged: sql<number>`count(*) filter (where ${FLAGGED})::int`,
      primaryInput: sql<number>`coalesce(sum((${aiMessages.tokens}->>'input')::float8) filter (where ${byPrimary}), 0)`,
      primaryCached: sql<number>`coalesce(sum((${aiMessages.tokens}->>'cached')::float8) filter (where ${byPrimary}), 0)`,
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

  const guardEvents = await getDb()
    .select()
    .from(aiGuardEvents)
    .where(gte(aiGuardEvents.day, since))
    .orderBy(asc(aiGuardEvents.day), asc(aiGuardEvents.kind));

  // What agents asked over MCP (plan phase 32), per day and name; an older client ignores it.
  const mcp = await getDb()
    .select()
    .from(aiMcpUsage)
    .where(gte(aiMcpUsage.day, since))
    .orderBy(asc(aiMcpUsage.day), asc(aiMcpUsage.name));

  // What each feature spent per day (features.ts); days before the split have none.
  const features = await getDb()
    .select({
      day: aiUsageFeatures.day,
      feature: aiUsageFeatures.feature,
      requests: sql<number>`sum(${aiUsageFeatures.requests})::int`,
      usd: sql<number>`sum(${aiUsageFeatures.usd})::float8`,
    })
    .from(aiUsageFeatures)
    .where(gte(aiUsageFeatures.day, since))
    .groupBy(aiUsageFeatures.day, aiUsageFeatures.feature)
    .orderBy(asc(aiUsageFeatures.day), asc(aiUsageFeatures.feature));

  // Each flag the checks raised, over the period: a set-returning function per row.
  const { rows: checks } = await getDb().execute<{ flag: string; count: number }>(sql`
    select f.flag, count(*)::int as count
    from ai_messages m
    cross join lateral jsonb_array_elements_text(coalesce(m.checks -> 'flags', '[]'::jsonb)) as f(flag)
    where m.created_at >= ${new Date(`${since}T00:00:00Z`)} and m.source = 'terminal'
    group by f.flag
    order by count desc, f.flag`);

  return c.json({ days, primaryModel, models, answers, guardEvents, checks, features, mcp });
});

/* ----------------------------------------------------------- conversations */

/** Answers any deterministic check flagged (checks.ts). */
const FLAGGED = sql`jsonb_array_length(coalesce(${aiMessages.checks} -> 'flags', '[]'::jsonb)) > 0`;

/** An answer as Conversations and Reviews show it; needs the join on `ai_feedback`. */
const CONVERSATION_ROW = {
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
  droppedCitations: aiMessages.droppedCitations,
  trace: aiMessages.trace,
  corpusKey: aiMessages.corpusKey,
  checks: aiMessages.checks,
  feedback: aiFeedback.value,
};

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
  if (filter === "dropped") {
    conditions.push(sql`jsonb_array_length(${aiMessages.droppedCitations}) > 0`);
  }
  if (filter === "flagged") conditions.push(FLAGGED);

  const rows = await getDb()
    .select(CONVERSATION_ROW)
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(and(...conditions))
    .orderBy(desc(aiMessages.createdAt))
    .limit(100);
  return c.json({ messages: rows });
});

/* ----------------------------------------------------------------- reviews */

/**
 * The weekly human review (reviews.ts): the week's queue with each answer as
 * Conversations shows it, and how far the review got. The label shares count
 * the random sample only, so the answers flagged into the queue do not drag
 * the estimate down.
 */
adminAskRouter.get("/assistant/reviews", async (c) => {
  const week = c.req.query("week") || isoWeek(new Date());
  const bounds = weekBounds(week);
  if (!bounds) return c.json({ error: "invalid_input" }, 400);
  const db = getDb();

  const candidates = await db
    .select({
      id: aiMessages.id,
      flags: sql<string[]>`coalesce(${aiMessages.checks} -> 'flags', '[]'::jsonb)`,
      thumbsDown: sql<boolean>`coalesce(${aiFeedback.value} = -1, false)`,
      unknown: sql<boolean>`${UNKNOWN_ANSWER}`,
      // A judge found it unfaithful (the nightly judge, plan phase 26).
      unfaithful: sql<boolean>`coalesce((${aiMessages.judge} ->> 'faithfulness')::float8 < ${FAITHFUL_AT}, false)`,
      // Why the thumbs-down, and a stop mid-answer (the browser's signals, visitor plan V2).
      downReason: aiFeedback.reason,
      stopped: sql<boolean>`coalesce((${aiMessages.signals} ->> 'stopped')::boolean, false)`,
      reviewed: sql<boolean>`${aiReviews.messageId} is not null`,
    })
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .leftJoin(aiReviews, eq(aiReviews.messageId, aiMessages.id))
    .where(
      and(
        eq(aiMessages.source, "terminal"),
        gte(aiMessages.createdAt, bounds.start),
        lt(aiMessages.createdAt, bounds.end),
      ),
    );
  const queue = buildQueue(
    week,
    candidates.map((row) => ({ id: row.id, reasons: reviewReasons(row), reviewed: row.reviewed })),
  );

  const ids = queue.map((entry) => entry.id);
  const [rows, reviews] = ids.length
    ? await Promise.all([
        db
          .select(CONVERSATION_ROW)
          .from(aiMessages)
          .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
          .where(inArray(aiMessages.id, ids)),
        db.select().from(aiReviews).where(inArray(aiReviews.messageId, ids)),
      ])
    : [[], []];
  const messages = new Map(rows.map((row) => [row.id, row]));
  const reviewed = new Map(reviews.map((review) => [review.messageId, review]));
  const entries = queue.flatMap((entry) => {
    const message = messages.get(entry.id);
    if (!message) return []; // pruned in between
    const review = reviewed.get(entry.id);
    return [
      {
        message,
        reasons: entry.reasons,
        sampled: entry.sampled,
        review: review
          ? { labels: review.labels, note: review.note, reviewedAt: review.reviewedAt }
          : null,
      },
    ];
  });

  return c.json({
    week,
    previous: isoWeek(new Date(bounds.start.getTime() - 1)),
    next: bounds.end.getTime() <= Date.now() ? isoWeek(bounds.end) : null,
    queue: entries,
    stats: {
      answers: candidates.length,
      queued: entries.length,
      reviewed: entries.filter((entry) => entry.review).length,
      labels: labelStats(entries.flatMap((e) => (e.sampled && e.review ? [e.review] : []))),
    },
  });
});

const verdict = z.boolean().nullable();
const reviewInput = z.object({
  labels: z.object({
    correct: verdict,
    grounded: verdict,
    helpful: verdict,
    tone: verdict,
    language: verdict,
  } satisfies Record<ReviewLabel, typeof verdict>),
  note: z.string().max(2000).nullable(),
});

adminAskRouter.put(
  "/assistant/reviews/:messageId",
  zValidator("json", reviewInput, invalid),
  async (c) => {
    const messageId = c.req.param("messageId");
    const input = c.req.valid("json");
    const [message] = await getDb()
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .where(and(eq(aiMessages.id, messageId), eq(aiMessages.source, "terminal")));
    if (!message) return c.json({ error: "not_found" }, 404);

    const review = {
      labels: input.labels,
      note: input.note?.trim() || null,
      reviewedAt: new Date(),
    };
    await getDb()
      .insert(aiReviews)
      .values({ messageId, ...review })
      .onConflictDoUpdate({ target: aiReviews.messageId, set: review });
    return c.json({ ok: true, reviewedAt: review.reviewedAt });
  },
);

/* ---------------------------------------------------------------- outcomes */

const OUTCOME_DAYS = 30;
/** The primary metric's weekly reviews shown, oldest first. */
const OUTCOME_WEEKS = 4;

/**
 * Whether visitors got what they came for (outcomes.ts): the last 30 days'
 * composite, the hand-off funnel, and the primary metric per weekly review
 * with the rotation rule's verdict.
 */
adminAskRouter.get("/assistant/outcomes", async (c) => {
  const now = new Date();
  const weeks = completedWeeks(OUTCOME_WEEKS, now);
  const since = new Date(now.getTime() - OUTCOME_DAYS * 24 * 60 * 60 * 1000);
  const oldest = weekBounds(weeks[0]!)!.start;
  const from = oldest < since ? oldest : since;
  const db = getDb();

  const rows: OutcomeRow[] = await db
    .select(OUTCOME_COLUMNS)
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(and(eq(aiMessages.source, "terminal"), gte(aiMessages.createdAt, from)));
  const [sent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contactMessages)
    .where(and(eq(contactMessages.origin, "ask"), gte(contactMessages.createdAt, since)));

  const { primaryMetric } = await readAiSettings();
  const weekly = weeklyValues(rows, primaryMetric, weeks);
  const recent = rows.filter((row) => row.createdAt >= since);
  return c.json({
    days: OUTCOME_DAYS,
    outcomes: outcomes(recent, sent?.n ?? 0),
    // What the visitors' browsers saw, and why the 👎s (visitor plan V2).
    browser: browserView(recent),
    primary: {
      metric: primaryMetric,
      weeks: weekly,
      rotate: shouldRotate(weekly.map((w) => w.value)),
    },
    metrics: PRIMARY_METRICS,
  });
});

adminAskRouter.put(
  "/assistant/primary-metric",
  zValidator("json", z.object({ metric: z.enum(PRIMARY_METRICS) }), invalid),
  async (c) => {
    const { metric } = c.req.valid("json");
    const now = new Date();
    await getDb()
      .insert(aiSettings)
      .values({ id: 1, primaryMetric: metric, updatedAt: now })
      .onConflictDoUpdate({
        target: aiSettings.id,
        set: { primaryMetric: metric, updatedAt: now },
      });
    invalidateAssistantCache();
    return c.json({ ok: true });
  },
);

/* --------------------------------------------------------------------- FAQ */

const idParam = zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
  result.success ? undefined : c.json({ error: "invalid_id" }, 400),
);

adminAskRouter.get("/assistant/faq", async (c) => c.json({ faq: await readFaq() }));

adminAskRouter.post("/assistant/faq", zValidator("json", faqInput, invalid), async (c) => {
  const input = c.req.valid("json");
  const id = await getDb().transaction((tx) => insertFaq(tx, input));
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
      // A language left out goes; the others are written in place, and a translation's date
      // moves only when its words do: it is the "as of" date the assistant gives (plan phase 19).
      const kept = LOCALES.filter((locale) => input.translations[locale]);
      await tx
        .delete(aiFaqTranslations)
        .where(and(eq(aiFaqTranslations.faqId, id), notInArray(aiFaqTranslations.locale, kept)));
      await Promise.all(
        kept.map((locale) => {
          const t = input.translations[locale]!;
          return tx
            .insert(aiFaqTranslations)
            .values({ faqId: id, locale, ...t })
            .onConflictDoUpdate({
              target: [aiFaqTranslations.faqId, aiFaqTranslations.locale],
              set: {
                question: t.question,
                answer: t.answer,
                updatedAt: sql`case when ${aiFaqTranslations.question} is distinct from excluded.question or ${aiFaqTranslations.answer} is distinct from excluded.answer then now() else ${aiFaqTranslations.updatedAt} end`,
              },
            });
        }),
      );
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

/**
 * The previous admin's insights request, kept as it was: a run, unless the
 * latest one read the newest answer and is younger than the cache's time
 * (`cached`). The runs are kept now (insights.ts), not held in memory; the
 * answer also names the run its topics come from (`snapshot`), so a lesson
 * made from a topic names that run, whatever ran since.
 */
adminAskRouter.post("/assistant/insights", async (c) => {
  const config = askConfig();
  const refresh = c.req.query("refresh") === "1";
  if (!refresh) {
    const [latest, [newest]] = await Promise.all([
      latestSnapshot(),
      insightQuestions().then((rows) => rows.slice(0, 1)),
    ]);
    const fresh = latest && Date.now() - latest.createdAt.getTime() < config.insightCacheTtlMs;
    if (!newest) return c.json({ topics: [], analysed: 0 });
    if (fresh && latest.newestMessageId === newest.id) {
      return c.json({
        topics: latest.topics,
        analysed: latest.analysed,
        cached: true,
        snapshot: latest,
      });
    }
  }
  const result = await runInsights(config, "admin");
  if (!result.ok) return c.json({ error: result.error }, 503);
  if (!result.snapshot) return c.json({ topics: [], analysed: 0 });
  return c.json({
    topics: result.snapshot.topics,
    analysed: result.snapshot.analysed,
    snapshot: result.snapshot,
  });
});

/** The last run and the trigger's last word (plan phase 25): no model call. */
adminAskRouter.get("/assistant/insights", async (c) => {
  const [snapshot, trigger] = await Promise.all([latestSnapshot(), lastLearningCheck()]);
  return c.json({ snapshot: snapshot ?? null, trigger });
});

/** A run seen, and every run before it: the Overview's notice goes. */
adminAskRouter.post(
  "/assistant/insights/:id/seen",
  zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
    result.success ? undefined : c.json({ error: "invalid_id" }, 400),
  ),
  async (c) => {
    if (!(await markSeen(c.req.valid("param").id))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);

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
  // The admin's switch turns the public assistant off, not the playground,
  // which stops at the visitors' reserve and its own cap instead.
  const state = await availability(config, await readAiSettings(), "playground");
  if (state.state !== "ok") return c.json({ error: refusal(state) }, 503);

  const history = await buildHistory({
    messages: body.messages,
    sessionId: body.sessionId,
    locale: body.locale,
    // The admin may try a longer question than a visitor.
    ...historyLimits(config),
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
  // As for visitors: an answer routed lite may move up to the deep chain (plan phase 20).
  const escalation = state.deepAllowed ? () => askChain(config, "deep") : undefined;

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
    escalation,
    abortSignal: c.req.raw.signal,
    droppedAnswers: history.droppedAnswers,
    window: history.window,
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
});

/* ------------------------------------------------------------------- evals */

/** Background runs (the Evals tab since plan phase 8): start, follow, cancel, resume. */
adminAskRouter.route("/assistant/runs", runsRouter);

/** Eval cases frozen from visitor answers (plan phase 12): list, freeze, retire. */
adminAskRouter.route("/assistant/eval-cases", evalCasesRouter);

/** Who may do what, what is demoted, the alerts and the audit log (plan phase 14). */
adminAskRouter.route("/assistant/trust", trustRouter);

/** What the assistant reads and how it uses it, and the corpus tiers (plan phase 16). */
adminAskRouter.route("/assistant/perception", perceptionRouter);

/** How answers were routed, and the false-simple rate (plan phase 20). */
adminAskRouter.route("/assistant/router", routerReportRouter);

/** Why answers failed: Diagnose and the failure journal (plan phase 24). */
adminAskRouter.route("/assistant/journal", journalRouter);

/** What several failures taught: lessons, applied and measured (plan phase 25). */
adminAskRouter.route("/assistant/lessons", lessonsRouter);
// Judged faithfulness per model and route, and the last nightly judge run (plan phase 26).
adminAskRouter.route("/assistant/faithfulness", faithfulnessRouter);

/**
 * The content agent's proposals (plan phases 29–30): drafts for the content's
 * gaps, written into the drafts only on the admin's apply, never published.
 */
adminAskRouter.route("/assistant/proposals", proposalsRouter);

/**
 * The FAQ pipeline's proposals (plan phase 31): FAQ entries drafted from an
 * insight topic or a journal entry, live only once the admin accepts one.
 */
adminAskRouter.route("/assistant/faq-proposals", faqProposalsRouter);

/**
 * The judges and how far the one on visitor answers agrees with reviewers
 * (evals/calibration.ts), plus the answerers a pairwise run can compare.
 */
adminAskRouter.get("/assistant/judge", async (c) => {
  const config = askConfig();
  const visitorJudge = askVisitorJudges(config)[0]?.id ?? null;
  const [pairs, unjudged] = visitorJudge
    ? await Promise.all([calibrationPairs(visitorJudge), reviewedToJudge(visitorJudge)])
    : [[], []];
  const models = (["lite", "deep"] as const).flatMap((role) =>
    askChain(config, role).map((e) => e.id),
  );
  return c.json({
    fixtureJudge: askChain(config, "judge")[0]?.id ?? null,
    visitorJudge,
    calibration: calibrate(pairs),
    unjudged: unjudged.length,
    answerers: [...new Set(["lite", "deep", ...models])],
  });
});

/**
 * The eval suite inside one request: the previous admin's Evals tab, kept
 * until the new admin (background runs) is deployed. It and the start of a
 * background run exclude each other (runs/runner.ts), and it refuses while a
 * run of any kind is active: one paid thing at a time.
 */
adminAskRouter.post(
  "/assistant/evals",
  zValidator("json", z.object({ cases: z.array(z.string().max(40)).max(60).optional() }), invalid),
  async (c) => {
    // Claimed before the first await, so no run can start in between.
    if (!claimRequestEval()) return c.json({ error: "already_running" }, 409);
    const calls: ModelCall[] = [];
    try {
      if ((await activeRuns()).length) return c.json({ error: "already_running" }, 409);
      const config = askConfig();
      const state = await availability(config, await readAiSettings(), "eval");
      if (state.state !== "ok") return c.json({ error: refusal(state) }, 503);

      const wanted = c.req.valid("json").cases;
      const cases = wanted?.length ? EVAL_CASES.filter((e) => wanted.includes(e.id)) : EVAL_CASES;
      const summary = await runEvals({
        cases,
        corpus: fixtureAskCorpus(config),
        config,
        chain: (role) => askChain(config, role),
        concurrency: 1,
        pacing: askEvalPacing(),
        rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
        stopOnUnavailable: true,
        abortSignal: c.req.raw.signal,
        promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
        calls,
      });
      return c.json(summary);
    } finally {
      releaseRequestEval();
      if (calls.length) {
        await recordUsage(calls, "eval").catch((error) =>
          console.error("[ask] eval usage not recorded", error),
        );
      }
    }
  },
);

/* ----------------------------------------------------------------- copilot */

// The editor copilot: its skills, their drafts and the editor's verdicts (plan phase 27).
adminAskRouter.route("/ai", skillsRouter);
