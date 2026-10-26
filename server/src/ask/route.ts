import { createUIMessageStreamResponse } from "ai";
import { and, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { clientIp } from "../auth/middleware.js";
import { getDb } from "../db/client.js";
import { aiFeedback, aiMessages } from "../db/schema.js";
import type { Locale } from "../content/schema.js";
import { captureError } from "../lib/sentry.js";
import { turnstileEnabled, verifyTurnstile, VerifiedSessions } from "../lib/turnstile.js";
import { readingLocale, streamAnswer } from "./agent.js";
import type { AskCorpus } from "./corpus/index.js";
import { demotedSubjects } from "./audit.js";
import { askChain, askConfig, askCorpus } from "./deps.js";
import { backfillEmbeddings } from "./embeddings.js";
import {
  availability,
  checkForgetRate,
  checkMapRate,
  checkRate,
  checkScorecardRate,
  ConcurrencyGate,
  hashWithSalt,
  recordForgetRequest,
  recordMapRequest,
  recordRequest,
  recordScorecardRequest,
} from "./guard.js";
import { focusOf, focusSchema } from "./focus.js";
import { forgetSessions } from "./forget.js";
import { countGuardEvent } from "./guard-events.js";
import {
  ASK_MESSAGE_ID,
  buildHistory,
  cleanVisitorText,
  historyLimits,
  verifyTour,
} from "./history.js";
import { inspectView } from "./inspect.js";
import { etagMatches, mapOf } from "./map.js";
import { shortName } from "./models/registry.js";
import { PAGE_CHARS, pageDocument } from "./page.js";
import { routeQuestion } from "./router.js";
import { scorecard } from "./scorecard.js";
import { assistantState } from "./settings.js";
import { FEEDBACK_REASONS, SignalLimiter, signalsSchema } from "./signals.js";
import { OFFERED_HANDOFF } from "./outcome-rows.js";
import { streamTour, tourRequestSchema, type TourRequestBody } from "./tour.js";
import { DEEP_ROUTE, withoutDemoted } from "./trust.js";

/**
 * The public assistant API:
 *   POST /v1/ask           one streamed answer (AI SDK UI message stream); with
 *                          `mode: "tour"`, a guided tour for an interest (V16)
 *   GET  /v1/ask/config    whether it is on, suggested questions, limits
 *   POST /v1/ask/feedback  +1 / -1 on an answer from this session, a -1 with its reason
 *   POST /v1/ask/signal    what this session's browser saw of an answer (visitor plan V2)
 *   POST /v1/ask/handoff   the visitor's yes to that answer's hand-off offer
 *   POST /v1/ask/inspect   what the log keeps of one of this session's answers (visitor plan V12)
 *   GET  /v1/ask/scorecard the eval run and 30 days of live checks, while published (V13)
 *   POST /v1/ask/forget    this session's answers deleted from the log, on the visitor's yes (V14)
 *   GET  /v1/ask/map       one language's published pages, dated and related (V15)
 *   GET  /v1/ask/stream-check  three ticks, so a deploy can prove nothing buffers
 *
 * No cookies and no credentials: the browser holds a random session id per
 * tab, and only its salted hash is stored.
 */

export const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;

const askBody = z.object({
  sessionId: z.string().regex(SESSION_ID),
  locale: z.enum(["en", "de"]),
  deep: z.boolean().optional(),
  /**
   * The path of the page asked on (visitor plan V8), without query or hash.
   * Only a published case study or post means anything (`pageDocument`).
   */
  page: z.string().max(PAGE_CHARS).optional(),
  /**
   * What the visitor points at on that page (visitor plan V9): a section or a
   * code block, taken from the page's document, or a selection, trusted only
   * if the document holds it (`focusOf`).
   */
  focus: focusSchema.optional(),
  /**
   * How technical the visitor asked answers to be (visitor plan V10), kept in
   * their browser. The terminal sends nothing for standard; taken all the same.
   */
  level: z.enum(["plain", "standard", "expert"]).optional(),
  /**
   * `tour`: plan a guided tour for the visitor's interest (visitor plan V16)
   * instead of answering; `tour` carries the interest, and a replan's plan.
   */
  mode: z.enum(["answer", "tour"]).optional(),
  tour: tourRequestSchema.optional(),
  /** Hidden from people; a bot that fills it gets nothing. */
  website: z.string().max(200).optional(),
  /** While Turnstile is on: needed once per session, on its first question. */
  turnstileToken: z.string().max(2048).optional(),
  messages: z.array(z.unknown()).min(1).max(40),
});

const verifiedSessions = new VerifiedSessions();

const feedbackBody = z.object({
  sessionId: z.string().regex(SESSION_ID),
  messageId: z.string().regex(ASK_MESSAGE_ID),
  value: z.union([z.literal(1), z.literal(-1)]),
  /** Why a -1 (visitor plan V2): one of the codes the terminal offers. */
  reason: z.enum(FEEDBACK_REASONS).optional(),
});

const signalBody = z.object({
  sessionId: z.string().regex(SESSION_ID),
  messageId: z.string().regex(ASK_MESSAGE_ID),
  signals: signalsSchema,
});

const signalLimiter = new SignalLimiter();

const handoffBody = z.object({
  sessionId: z.string().regex(SESSION_ID),
  messageId: z.string().regex(ASK_MESSAGE_ID),
});

const inspectBody = handoffBody;

const forgetBody = z.object({
  sessionId: z.string().regex(SESSION_ID),
  /** The tab's sessions before its `reset`s, which the terminal keeps for this (V14). */
  earlier: z.array(z.string().regex(SESSION_ID)).max(10).optional(),
});

const mapQuery = z.object({ locale: z.enum(["en", "de"]) });

const gate = new ConcurrencyGate(() => askConfig().maxConcurrent);
const inFlight = new Set<AbortController>();

export function streamsInFlight(): number {
  return gate.inFlight;
}

/** On shutdown: end every stream now (the visitor sees an interrupted answer and `retry`). */
export function abortAllAsks(reason = "shutdown"): void {
  for (const controller of inFlight) controller.abort(new Error(reason));
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

async function checkTurnstile(
  sessionId: string,
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  const session = hashWithSalt("session", sessionId);
  if (verifiedSessions.has(session)) return true;
  if (!(await verifyTurnstile(token, ip))) return false;
  verifiedSessions.add(session);
  return true;
}

type AskBody = z.infer<typeof askBody>;

type AdmittedAsk = {
  body: AskBody;
  history: Extract<Awaited<ReturnType<typeof buildHistory>>, { ok: true }>;
  config: ReturnType<typeof askConfig>;
  deepAllowed: boolean;
  ipHash: string;
  sessionHash: string;
  release: () => void;
};

type AdmitResult = { ok: true; ask: AdmittedAsk } | { ok: false; response: Response };

/**
 * Every refusal a visitor can hit before a stream starts: invalid input, the
 * honeypot, Turnstile, availability, history, rate limits and the concurrency
 * gate. Counted in guard-events; the answers table never sees them.
 */
async function admitAsk(c: Context): Promise<AdmitResult> {
  const parsed = askBody
    // A tour needs its interest (visitor plan V16).
    .refine((body) => body.mode !== "tour" || body.tour !== undefined)
    .safeParse(await readJson(c));
  if (!parsed.success || parsed.data.website) {
    countGuardEvent(parsed.success ? "honeypot" : "invalid_input");
    return { ok: false, response: c.json({ error: "invalid_input" }, 400) };
  }
  const body = parsed.data;

  if (!(await checkTurnstile(body.sessionId, body.turnstileToken, clientIp(c)))) {
    countGuardEvent("turnstile_required");
    return { ok: false, response: c.json({ error: "turnstile_required" }, 403) };
  }

  const config = askConfig();
  const { settings } = await assistantState();
  const state = await availability(config, settings, "terminal");
  if (state.state !== "ok") {
    countGuardEvent(state.state);
    return { ok: false, response: c.json({ error: `assistant_${state.state}` }, 503) };
  }

  const history = await buildHistory({
    messages: body.messages,
    sessionId: body.sessionId,
    locale: body.locale,
    ...historyLimits(config),
  });
  if (!history.ok) {
    const tooLong = history.error === "too_long";
    countGuardEvent(tooLong ? "too_long" : "invalid_input");
    return {
      ok: false,
      response: c.json({ error: history.error }, tooLong ? 413 : 400),
    };
  }

  const ipHash = hashWithSalt("ip", clientIp(c));
  const sessionHash = hashWithSalt("session", body.sessionId);
  const rate = await checkRate(config, ipHash, sessionHash);
  if (!rate.ok) {
    countGuardEvent("rate_limited");
    c.header("Retry-After", String(rate.retryAfter));
    return {
      ok: false,
      response: c.json({ error: "rate_limited", retryAfter: rate.retryAfter }, 429),
    };
  }

  const release = gate.tryEnter();
  if (!release) {
    countGuardEvent("busy");
    c.header("Retry-After", "5");
    return { ok: false, response: c.json({ error: "busy", retryAfter: 5 }, 429) };
  }

  return {
    ok: true,
    ask: {
      body,
      history,
      config,
      deepAllowed: state.deepAllowed,
      ipHash,
      sessionHash,
      release,
    },
  };
}

/**
 * A replan's start (visitor plan V16), or null for a first plan; `invalid`
 * when its stop is not a page of the tour's language, or its plan is not one
 * this server signed for the session, or was replanned already.
 */
function replanOf(
  tour: TourRequestBody,
  sessionId: string,
  corpus: AskCorpus,
  reading: Locale,
): { from: string; seen: string[] } | null | "invalid" {
  if (tour.from === undefined && tour.plan === undefined) return null;
  const pages = mapOf(corpus, reading).map.pages;
  if (!tour.from || !pages.some((page) => page.id === tour.from)) return "invalid";
  const plan = tour.plan;
  if (plan && (plan.replanned || !verifyTour(sessionId, plan.messageId, plan, plan.sig))) {
    return "invalid";
  }
  return { from: tour.from, seen: plan?.stops ?? [] };
}

/** A tour's stream, once admitted: the lite chain, the visitor's language, the replan checked. */
async function tourResponse(c: Context, ask: AdmittedAsk): Promise<Response> {
  const { body, history, config, ipHash, sessionHash, release } = ask;
  const controller = new AbortController();
  const onClientGone = () => controller.abort(new Error("client disconnected"));
  try {
    const interest = cleanVisitorText(body.tour!.interest);
    const corpus = await askCorpus(config);
    const replan = replanOf(
      body.tour!,
      body.sessionId,
      corpus,
      readingLocale(body.locale, history.language),
    );
    if (!interest || replan === "invalid") {
      release();
      countGuardEvent("invalid_input");
      return c.json({ error: "invalid_input" }, 400);
    }
    await recordRequest(ipHash, sessionHash);
    const demoted = await demotedSubjects();
    c.req.raw.signal.addEventListener("abort", onClientGone, { once: true });
    inFlight.add(controller);
    const { stream } = streamTour({
      interest,
      locale: body.locale,
      language: history.language,
      sessionId: body.sessionId,
      sessionHash,
      corpus,
      config,
      chain: withoutDemoted(askChain(config, "lite"), demoted),
      abortSignal: controller.signal,
      ...(replan ? { replan } : {}),
      droppedAnswers: history.droppedAnswers,
      onClose: () => {
        release();
        inFlight.delete(controller);
        c.req.raw.signal.removeEventListener("abort", onClientGone);
      },
    });
    return createUIMessageStreamResponse({
      stream,
      headers: { "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  } catch (error) {
    release();
    inFlight.delete(controller);
    c.req.raw.signal.removeEventListener("abort", onClientGone);
    throw error;
  }
}

export function createAskRouter(): Hono {
  const router = new Hono();

  router.post(
    "/",
    // Eight turns of 600 characters plus signatures fit easily; anything bigger is not a visitor.
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => {
        countGuardEvent("too_large");
        return c.json({ error: "too_large" }, 413);
      },
    }),
    async (c) => {
      const admitted = await admitAsk(c);
      if (!admitted.ok) return admitted.response;
      // A guided tour (visitor plan V16): admitted as a question is, planned instead of answered.
      if (admitted.ask.body.mode === "tour") return tourResponse(c, admitted.ask);
      const { body, history, config, deepAllowed, ipHash, sessionHash, release } = admitted.ask;

      const controller = new AbortController();
      const onClientGone = () => controller.abort(new Error("client disconnected"));
      try {
        await recordRequest(ipHash, sessionHash);
        const corpus = await askCorpus(config);
        // New chunks get their search vectors in the background (plan phase 18), never in the way.
        void backfillEmbeddings(corpus, config).catch((error: unknown) => {
          console.error("[ask] embedding backfill failed", error);
          captureError(error, { phase: "embeddings" });
        });
        // What the trust monitor demoted is closed to visitors until the admin reinstates it.
        const demoted = await demotedSubjects();
        const deepOpen = deepAllowed && !demoted.has(DEEP_ROUTE);
        // The case study or post asked on, if it is one (visitor plan V8).
        const page = pageDocument(corpus, body.page, readingLocale(body.locale, history.language));
        const route = routeQuestion(history.question, {
          forceDeep: body.deep ?? false,
          deepAllowed: deepOpen,
          projectNames: corpus.projects.map((p) => p.name),
          ...(page?.project ? { pageProject: page.project } : {}),
        });
        const chain = withoutDemoted(askChain(config, route.route), demoted);
        // Where the deep route is open, an answer routed lite may move up to it (plan phase 20).
        const escalation = deepOpen
          ? () => withoutDemoted(askChain(config, "deep"), demoted)
          : undefined;
        if (!chain.length) {
          release();
          countGuardEvent("off");
          return c.json({ error: "assistant_off" }, 503);
        }

        c.req.raw.signal.addEventListener("abort", onClientGone, { once: true });
        inFlight.add(controller);
        const { stream } = streamAnswer({
          messages: history.messages,
          question: history.question,
          locale: body.locale,
          language: history.language,
          sessionId: body.sessionId,
          sessionHash,
          source: "terminal",
          route,
          corpus,
          config,
          chain,
          escalation,
          abortSignal: controller.signal,
          droppedAnswers: history.droppedAnswers,
          window: history.window,
          page,
          focus: body.focus ? focusOf(body.focus, page) : null,
          ...(body.level && body.level !== "standard" ? { level: body.level } : {}),
          onClose: () => {
            release();
            inFlight.delete(controller);
            c.req.raw.signal.removeEventListener("abort", onClientGone);
          },
        });

        return createUIMessageStreamResponse({
          stream,
          headers: {
            // Compression and proxy buffering would hold tokens back.
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      } catch (error) {
        release();
        inFlight.delete(controller);
        c.req.raw.signal.removeEventListener("abort", onClientGone);
        throw error;
      }
    },
  );

  router.get("/config", async (c) => {
    const config = askConfig();
    const { settings } = await assistantState();
    const state = await availability(config, settings, "terminal");
    c.header("Cache-Control", "no-store");
    return c.json({
      state: state.state,
      deep: state.state === "ok" && state.deepAllowed && !(await demotedSubjects()).has(DEEP_ROUTE),
      suggestions: settings.suggestedQuestions,
      limits: { maxChars: config.maxMessageChars, historyTurns: config.historyTurns },
      model: shortName(config.gemini.model),
      // Whether `evals` is offered (visitor plan V13): the scorecard is the admin's to publish.
      scorecard: settings.publicScorecard,
    });
  });

  // Public, and working with the assistant off: aggregates only, no model call, cached.
  router.get("/scorecard", async (c) => {
    const { settings } = await assistantState();
    if (!settings.publicScorecard) return c.json({ error: "not_published" }, 404);
    const ipHash = hashWithSalt("ip", clientIp(c));
    const rate = await checkScorecardRate(ipHash);
    if (!rate.ok) {
      c.header("Retry-After", String(rate.retryAfter));
      return c.json({ error: "rate_limited", retryAfter: rate.retryAfter }, 429);
    }
    await recordScorecardRequest(ipHash);
    c.header("Cache-Control", "public, max-age=600");
    return c.json(await scorecard(settings));
  });

  // Public, and working with the assistant off: the corpus's pages and links, no model call.
  router.get("/map", async (c) => {
    const parsed = mapQuery.safeParse({ locale: c.req.query("locale") });
    if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
    const ipHash = hashWithSalt("ip", clientIp(c));
    const rate = await checkMapRate(ipHash);
    if (!rate.ok) {
      c.header("Retry-After", String(rate.retryAfter));
      return c.json({ error: "rate_limited", retryAfter: rate.retryAfter }, 429);
    }
    await recordMapRequest(ipHash);
    const { map, etag } = mapOf(await askCorpus(askConfig()), parsed.data.locale);
    // A publish changes the corpus's key, and so the validator: a revalidation is cheap.
    c.header("ETag", etag);
    c.header("Cache-Control", "public, max-age=300");
    if (etagMatches(c.req.header("if-none-match"), etag)) return c.body(null, 304);
    return c.json(map);
  });

  router.post("/feedback", async (c) => {
    const parsed = feedbackBody.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
    const { sessionId, messageId, value } = parsed.data;
    // A reason belongs to a -1 only: a +1 clears the one a -1 had.
    const reason = value === -1 ? (parsed.data.reason ?? null) : null;

    // Only the session that received the answer may rate it.
    const [message] = await getDb()
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.id, messageId),
          eq(aiMessages.sessionHash, hashWithSalt("session", sessionId)),
        ),
      )
      .limit(1);
    if (!message) return c.json({ error: "not_found" }, 404);

    await getDb()
      .insert(aiFeedback)
      .values({ messageId, value, reason })
      .onConflictDoUpdate({
        target: aiFeedback.messageId,
        set: { value, reason, createdAt: new Date() },
      });
    return c.json({ ok: true });
  });

  router.post("/signal", async (c) => {
    const parsed = signalBody.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
    const { sessionId, messageId, signals } = parsed.data;
    const sessionHash = hashWithSalt("session", sessionId);
    if (!signalLimiter.take(sessionHash)) return c.json({ error: "rate_limited" }, 429);

    // Only the session that got the answer. The browser sends totals, set over what is there,
    // so a batch sent twice (a retry, the page's last word) cannot count twice.
    const [row] = await getDb()
      .update(aiMessages)
      .set({
        signals: sql`coalesce(${aiMessages.signals}, '{"v":1}'::jsonb) || ${JSON.stringify(signals)}::jsonb`,
      })
      .where(and(eq(aiMessages.id, messageId), eq(aiMessages.sessionHash, sessionHash)))
      .returning({ id: aiMessages.id });
    // The answer is logged once its stream ends: the browser tries again a moment later.
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  router.post("/handoff", async (c) => {
    const parsed = handoffBody.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
    const { sessionId, messageId } = parsed.data;

    // Only the session that got the offer may confirm it, only on an answer
    // that made one (the model's tool, or the server's own, visitor plan V6),
    // and the first yes is the one that counts.
    const [confirmed] = await getDb()
      .update(aiMessages)
      .set({ handoffConfirmedAt: sql`coalesce(${aiMessages.handoffConfirmedAt}, now())` })
      .where(
        and(
          eq(aiMessages.id, messageId),
          eq(aiMessages.sessionHash, hashWithSalt("session", sessionId)),
          OFFERED_HANDOFF,
        ),
      )
      .returning({ id: aiMessages.id });
    if (!confirmed) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  router.post("/inspect", async (c) => {
    const parsed = inspectBody.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
    const { sessionId, messageId } = parsed.data;

    // Only the session that got the answer, only a visitor's: the projection is the visitor's view.
    const [row] = await getDb()
      .select({
        id: aiMessages.id,
        createdAt: aiMessages.createdAt,
        promptVersion: aiMessages.promptVersion,
        route: aiMessages.route,
        model: aiMessages.model,
        ttftMs: aiMessages.ttftMs,
        totalMs: aiMessages.totalMs,
        citedIds: aiMessages.citedIds,
        droppedCitations: aiMessages.droppedCitations,
        checks: aiMessages.checks,
        trace: aiMessages.trace,
      })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.id, messageId),
          eq(aiMessages.sessionHash, hashWithSalt("session", sessionId)),
          eq(aiMessages.source, "terminal"),
        ),
      )
      .limit(1);
    c.header("Cache-Control", "no-store");
    // The answer is logged once its stream ends: the browser tries again a moment later.
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(inspectView(row));
  });

  // The visitor's own call, after their yes in the terminal: that session's answers only.
  router.post("/forget", async (c) => {
    const parsed = forgetBody.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
    const ipHash = hashWithSalt("ip", clientIp(c));
    const rate = await checkForgetRate(ipHash);
    if (!rate.ok) {
      c.header("Retry-After", String(rate.retryAfter));
      return c.json({ error: "rate_limited", retryAfter: rate.retryAfter }, 429);
    }
    await recordForgetRequest(ipHash);
    const { sessionId, earlier = [] } = parsed.data;
    const deleted = await forgetSessions(
      [sessionId, ...earlier].map((id) => hashWithSalt("session", id)),
    );
    // Counted as an aggregate, as refusals are: how often visitors use it, never whose.
    if (deleted) countGuardEvent("forgotten");
    return c.json({ ok: true, deleted });
  });

  router.get("/stream-check", () => {
    const encoder = new TextEncoder();
    let tick = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (tick > 0) await new Promise((resolve) => setTimeout(resolve, 400));
        controller.enqueue(encoder.encode(`data: tick ${++tick}\n\n`));
        if (tick >= 3) controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });

  return router;
}
