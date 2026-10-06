import { createUIMessageStreamResponse } from "ai";
import { and, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { clientIp } from "../auth/middleware.js";
import { getDb } from "../db/client.js";
import { aiFeedback, aiMessages } from "../db/schema.js";
import { captureError } from "../lib/sentry.js";
import { turnstileEnabled, verifyTurnstile, VerifiedSessions } from "../lib/turnstile.js";
import { streamAnswer } from "./agent.js";
import { demotedSubjects } from "./audit.js";
import { askChain, askConfig, askCorpus } from "./deps.js";
import { backfillEmbeddings } from "./embeddings.js";
import { availability, checkRate, ConcurrencyGate, hashWithSalt, recordRequest } from "./guard.js";
import { countGuardEvent } from "./guard-events.js";
import { ASK_MESSAGE_ID, buildHistory } from "./history.js";
import { shortName } from "./models/registry.js";
import { routeQuestion } from "./router.js";
import { assistantState } from "./settings.js";
import { DEEP_ROUTE, withoutDemoted } from "./trust.js";

/**
 * The public assistant API:
 *   POST /v1/ask           one streamed answer (AI SDK UI message stream)
 *   GET  /v1/ask/config    whether it is on, suggested questions, limits
 *   POST /v1/ask/feedback  +1 / -1 on an answer from this session
 *   POST /v1/ask/handoff   the visitor's yes to that answer's hand-off offer
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
});

const handoffBody = z.object({
  sessionId: z.string().regex(SESSION_ID),
  messageId: z.string().regex(ASK_MESSAGE_ID),
});

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
  const parsed = askBody.safeParse(await readJson(c));
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
    historyTurns: config.historyTurns,
    // The corpus prefix takes its share first; history gets the rest.
    maxInputTokens: Math.max(2_000, Math.floor(config.maxInputTokens * 0.25)),
    maxChars: config.maxMessageChars,
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
        const route = routeQuestion(history.question, {
          forceDeep: body.deep ?? false,
          deepAllowed: deepOpen,
          projectNames: corpus.projects.map((p) => p.name),
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
    });
  });

  router.post("/feedback", async (c) => {
    const parsed = feedbackBody.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
    const { sessionId, messageId, value } = parsed.data;

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
      .values({ messageId, value })
      .onConflictDoUpdate({ target: aiFeedback.messageId, set: { value, createdAt: new Date() } });
    return c.json({ ok: true });
  });

  router.post("/handoff", async (c) => {
    const parsed = handoffBody.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
    const { sessionId, messageId } = parsed.data;

    // Only the session that got the offer may confirm it, only on an answer
    // that made one, and the first yes is the one that counts.
    const [confirmed] = await getDb()
      .update(aiMessages)
      .set({ handoffConfirmedAt: sql`coalesce(${aiMessages.handoffConfirmedAt}, now())` })
      .where(
        and(
          eq(aiMessages.id, messageId),
          eq(aiMessages.sessionHash, hashWithSalt("session", sessionId)),
          sql`${aiMessages.toolCalls} @> '["handoff_contact"]'::jsonb`,
        ),
      )
      .returning({ id: aiMessages.id });
    if (!confirmed) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
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
