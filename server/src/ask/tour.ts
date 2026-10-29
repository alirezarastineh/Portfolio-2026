import {
  createUIMessageStream,
  NoObjectGeneratedError,
  type ModelMessage,
  type UIMessageChunk,
} from "ai";
import { z } from "zod";

import type { Locale } from "../content/schema.js";
import { captureError } from "../lib/sentry.js";
import { newMessageId } from "./agent.js";
import { looksLikeInjection, type AnswerChecks } from "./checks.js";
import type { AskConfig } from "./config.js";
import { resolveDocument, type AskCorpus } from "./corpus/index.js";
import { snapshotKey } from "./corpus/snapshots.js";
import { hybridSearch } from "./embeddings.js";
import { ASK_MESSAGE_ID, signAnswer, signTour } from "./history.js";
import { echoOf, LeakTally, newScanState, scanChunk, type LeakGuard } from "./leak-guard.js";
import type { AnswerLog } from "./log.js";
import { MAP_KINDS, mapOf, type MapPage } from "./map.js";
import { TOUR_ROUTE } from "./outcome-rows.js";
import {
  AllModelsFailedError,
  answeringModel,
  newTrace,
  type ModelCall,
  type Trace,
} from "./models/fallback.js";
import { shortName, type ModelEntry } from "./models/registry.js";
import { PROMPT_HASH, PROMPT_VERSION, wrapVisitor } from "./prompt.js";
import { citeText, markersIn, withoutMarkers } from "./stream-transforms.js";
import {
  closingStream,
  finishReasonOf,
  guardFor,
  instructionIn,
  LANGUAGE_NAME,
  logRow,
  otherLanguage,
  repairOnce,
  structuredAsk,
  structuredChain,
  timings,
  wordCount,
} from "./structured.js";
import { allowedPath } from "./tools.js";
import {
  TOUR_INTEREST_CHARS,
  TOUR_INTRO_WORDS,
  TOUR_LINE_WORDS,
  TOUR_STOPS,
  tourFallbackLine,
  tourInstructions,
  tourPrompt,
  tourRepairNote,
  tourSchema,
  type TourFailure,
  type TourFallback,
  type TourPlan,
  type TourReplan,
} from "./tour-prompt.js";
import { buildAnswerTrace, type AnswerTrace } from "./trace.js";
import { summarizeCalls } from "./usage.js";

/**
 * A guided tour for a visitor's interest (visitor plan V16; the book's
 * Plan-and-Execute with a deterministic critic). One structured call on the
 * lite chain plans 3 to 5 stops from the portfolio's map (V15) and the
 * search's hits; code checks the plan before the visitor sees it, asks once
 * for a repair with the exact failures, and otherwise lets the short tour
 * stand in, which the browser builds with no model. The plan only proposes:
 * the visitor takes each step. Logged as a visitor's row on a route of its own
 * (`route: "tour"`), so `forget` takes it and the answers' measures
 * (`VISITOR_ANSWER`) never count it.
 */

/** A replan's request (the route checks it): the plan it replaces, signed, and the stop it starts from. */
export const tourRequestSchema = z.object({
  interest: z.string().trim().min(1).max(TOUR_INTEREST_CHARS),
  from: z.string().max(160).optional(),
  plan: z
    .object({
      messageId: z.string().regex(ASK_MESSAGE_ID),
      stops: z.array(z.string().max(160)).max(TOUR_STOPS.max),
      replanned: z.boolean(),
      sig: z.string().max(200),
    })
    .optional(),
});

export type TourRequestBody = z.infer<typeof tourRequestSchema>;

/** A stop as the visitor gets it: the page, and the line the plan wrote for it. */
export interface TourStop {
  id: string;
  title: string;
  url: string;
  line: string;
}

/** The `data-tour` part (the browser's `tourData` reads it field by field). */
export interface TourData {
  v: 1;
  /** `plan`: these stops, checked; `default`: the browser's short tour stands in. */
  kind: "plan" | "default";
  reason?: TourFallback;
  interest: string;
  stops: TourStop[];
  /** A replan's tour, which is not replanned again. */
  replanned: boolean;
  /** `signTour` over the session, this message and the stops: what a replan sends back. */
  sig: string;
}

/** The pages the critic lets a stop be, and what it reads them against. */
export interface TourCheckContext {
  /** The pages of the visitor's language a stop may be, by id. */
  pages: ReadonlyMap<string, MapPage>;
  corpus: Pick<AskCorpus, "byId" | "projects" | "posts">;
  /** The language the tour is written in. */
  language: Locale;
  /** The output guard; null leaves its check out (a unit test of the other gates). */
  guard: LeakGuard | null;
  /** The visitor's interest: their own words are no leak when a line repeats them. */
  interest: string;
}

/** A stop's id as the corpus names it, when it is one of the pages; else as written. */
function pageId(raw: string, ctx: TourCheckContext): string {
  const doc = resolveDocument(ctx.corpus, raw, ctx.language);
  return doc && ctx.pages.has(doc.id) ? doc.id : raw.trim();
}

function checkLine(
  stop: TourPlan["stops"][number],
  id: string,
  n: number,
  ctx: TourCheckContext,
): TourFailure[] {
  const failures: TourFailure[] = [];
  const cited = markersIn(stop.line).map(
    (raw) => resolveDocument(ctx.corpus, raw, ctx.language)?.id ?? raw,
  );
  if (!cited.length) {
    failures.push({
      gate: "citation",
      message: `stop ${n}: its line cites no page; end it with [^${id}]`,
    });
  } else {
    const others = [...new Set(cited.filter((c) => c !== id))];
    if (others.length) {
      failures.push({
        gate: "citation",
        message: `stop ${n}: its line cites ${others.join(", ")}; cite only [^${id}]`,
      });
    }
  }
  const words = wordCount(stop.line);
  if (words > TOUR_LINE_WORDS) {
    failures.push({
      gate: "length",
      message: `stop ${n}: its line has ${words} words, at most ${TOUR_LINE_WORDS}`,
    });
  }
  if (otherLanguage(stop.line, ctx.language)) {
    failures.push({
      gate: "language",
      message: `stop ${n}: its line is not in ${LANGUAGE_NAME[ctx.language]}`,
    });
  }
  const instruction = instructionIn(stop.line, ctx.guard, ctx.interest);
  if (instruction) {
    failures.push({ gate: "instruction", message: `stop ${n}: its line ${instruction}` });
  }
  return failures;
}

function checkIntro(
  intro: string,
  stops: ReadonlySet<string>,
  ctx: TourCheckContext,
): TourFailure[] {
  const failures: TourFailure[] = [];
  const words = wordCount(intro);
  if (!words) failures.push({ gate: "length", message: "the intro is empty" });
  if (words > TOUR_INTRO_WORDS) {
    failures.push({
      gate: "length",
      message: `the intro has ${words} words, at most ${TOUR_INTRO_WORDS}`,
    });
  }
  const strays = markersIn(intro)
    .map((raw) => resolveDocument(ctx.corpus, raw, ctx.language)?.id ?? raw)
    .filter((id) => !stops.has(id));
  if (strays.length) {
    failures.push({
      gate: "intro-citation",
      message: `the intro cites ${[...new Set(strays)].join(", ")}, which is not a stop`,
    });
  }
  if (otherLanguage(intro, ctx.language)) {
    failures.push({
      gate: "language",
      message: `the intro is not in ${LANGUAGE_NAME[ctx.language]}`,
    });
  }
  const instruction = instructionIn(intro, ctx.guard, ctx.interest);
  if (instruction) failures.push({ gate: "instruction", message: `the intro: ${instruction}` });
  return failures;
}

/**
 * The critic: code the planner cannot change. Each failure names its gate and
 * says exactly what is wrong, so one repair can fix it. A plan with no stops
 * is the planner's "nothing matches" and is not checked here.
 */
export function checkTour(plan: TourPlan, ctx: TourCheckContext): TourFailure[] {
  const failures: TourFailure[] = [];
  const n = plan.stops.length;
  if (n < TOUR_STOPS.min || n > TOUR_STOPS.max) {
    failures.push({
      gate: "count",
      message: `${n} stops: plan ${TOUR_STOPS.min} to ${TOUR_STOPS.max}`,
    });
  }
  const seenIds = new Map<string, number>();
  const seenUrls = new Map<string, number>();
  plan.stops.forEach((stop, i) => {
    const at = i + 1;
    const id = pageId(stop.id, ctx);
    const page = ctx.pages.get(id);
    if (!page || !allowedPath(ctx.corpus, page.url)) {
      failures.push({
        gate: "unknown",
        message: `stop ${at}: ${stop.id} is not one of the pages listed`,
      });
    } else {
      const earlier = seenIds.get(id) ?? seenUrls.get(page.url);
      if (earlier !== undefined) {
        failures.push({ gate: "duplicate", message: `stop ${at}: it repeats stop ${earlier}` });
      }
      seenIds.set(id, seenIds.get(id) ?? at);
      seenUrls.set(page.url, seenUrls.get(page.url) ?? at);
    }
    failures.push(...checkLine(stop, id, at, ctx));
  });
  failures.push(...checkIntro(plan.intro, new Set(seenIds.keys()), ctx));
  return failures;
}

/** How the planner names a page's kind. */
function kindLabel(page: MapPage): string {
  if (page.kind === "project") return page.url.includes("/work/") ? "case study" : "project";
  return page.kind;
}

const EXCERPT_CHARS = 160;

/** A page as the request lists it: its id, kind, title and the start of its text. */
function pageLine(page: MapPage, corpus: Pick<AskCorpus, "byId">): string {
  const text = (corpus.byId.get(page.id)?.text ?? "").replace(/\s+/g, " ").trim();
  const excerpt = text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text;
  return `- ${page.id} · ${kindLabel(page)} · ${page.title} · ${excerpt}`;
}

/**
 * The pages a plan may use, in the visitor's language: the search's hits for
 * the interest first, then on a replan the current stop's related pages, then
 * the rest of the map; the current stop and the stops seen left out.
 */
export function tourPages(
  map: readonly MapPage[],
  hits: readonly string[],
  replan?: { from: string; seen: readonly string[] },
): MapPage[] {
  const byId = new Map(map.map((p) => [p.id, p]));
  const left = new Set([...(replan?.seen ?? []), ...(replan ? [replan.from] : [])]);
  const near = replan ? (byId.get(replan.from)?.related ?? []) : [];
  const order = [...new Set([...hits, ...near, ...map.map((p) => p.id)])];
  return order.flatMap((id) => {
    const page = byId.get(id);
    return page && !left.has(id) ? [page] : [];
  });
}

export interface TourInput {
  interest: string;
  /** The language the tour is written in and its stops read in (`readingLocale`). */
  language: Locale;
  corpus: AskCorpus;
  config: AskConfig;
  /** The lite chain, less what the trust monitor demoted: models without structured output are left out here. */
  chain: ModelEntry[];
  trace: Trace;
  abortSignal: AbortSignal;
  replan?: { from: string; seen: readonly string[] };
  /** Whether the searches' embedding spend is recorded (an eval's is not). */
  persist?: boolean;
  /** A failover before the plan's first chunk (visitor plan V12). */
  onFailover?: (next: { position: number; of: number }) => void;
  /** Bulk evals pace each provider request through this. */
  beforeModelCall?: (entry: ModelEntry, signal?: AbortSignal) => Promise<void>;
}

export interface TourOutcome {
  kind: "plan" | "default";
  reason?: TourFallback;
  /** The planner's intro, or the server's line when the short tour stands in. */
  intro: string;
  stops: TourStop[];
  /** The planner was asked once more, with its failures. */
  repaired: boolean;
  /** The gates the plans failed, the first's then the repair's. */
  failures: string[];
  /** The interest read as an injection: no model was asked. */
  injection: boolean;
  /** The searches' embedding calls (plan phase 18), part of its cost. */
  searchCalls: ModelCall[];
}

const PLAN_CALL = { maxOutputTokens: 800, temperature: 0.2, maxRetries: 0 } as const;

/** The output guard for a tour's texts: the planner's instructions, never to be repeated. */
const tourGuard = (corpus: AskCorpus, config: AskConfig): LeakGuard =>
  guardFor(
    "tour",
    () => [tourInstructions("en"), tourInstructions("de")].join("\n\n"),
    corpus,
    config,
  );

function fallback(
  reason: TourFallback,
  input: TourInput,
  extra: Partial<TourOutcome> = {},
): TourOutcome {
  return {
    kind: "default",
    reason,
    intro: tourFallbackLine(reason, input.language),
    stops: [],
    repaired: false,
    failures: [],
    injection: false,
    searchCalls: [],
    ...extra,
  };
}

function resolveReplan(
  map: readonly MapPage[],
  replan?: { from: string; seen: readonly string[] },
): TourReplan | undefined {
  if (!replan) return undefined;
  const from = map.find((p) => p.id === replan.from);
  return from ? { id: from.id, title: from.title } : undefined;
}

function formatTourPlan(
  plan: TourPlan,
  ctx: TourCheckContext,
  repaired: boolean,
  failures: string[],
  searchCalls: ModelCall[],
): TourOutcome {
  return {
    kind: "plan",
    intro: plan.intro.trim(),
    stops: plan.stops.map((stop) => {
      const page = ctx.pages.get(pageId(stop.id, ctx))!;
      // Checked to cite its own stop: the visitor reads it without the marker, the stop is the link.
      return { id: page.id, title: page.title, url: page.url, line: withoutMarkers(stop.line) };
    }),
    repaired,
    failures,
    injection: false,
    searchCalls,
  };
}

function handlePlanError(
  error: unknown,
  input: TourInput,
  details: { repaired: boolean; failures: string[]; searchCalls: ModelCall[] },
): TourOutcome {
  if (input.abortSignal.aborted) throw error;
  // An answer that is not the plan's shape is no plan; anything else, no model could plan.
  const reason = NoObjectGeneratedError.isInstance(error) ? "no-match" : "unavailable";
  if (!(error instanceof AllModelsFailedError) && reason === "unavailable") {
    console.error("[ask] tour plan failed", error);
    captureError(error, { phase: "tour" });
  }
  return fallback(reason, input, details);
}

/**
 * The plan: no call for an interest that reads as an injection; one structured
 * call, checked; one repair with the exact failures; else the short tour.
 */
export async function planTour(input: TourInput): Promise<TourOutcome> {
  const { interest, language, corpus, config } = input;
  if (looksLikeInjection(interest)) return fallback("no-match", input, { injection: true });

  const map = mapOf(corpus, language).map.pages;
  const searchCalls: ModelCall[] = [];
  const { hits } = await hybridSearch(corpus, interest, {
    config,
    reading: language,
    kinds: [...MAP_KINDS],
    spend: { record: input.persist ?? true, calls: searchCalls },
  });
  const pages = tourPages(
    map,
    hits.map((h) => h.id),
    input.replan,
  );
  const chain = structuredChain(input.chain);
  if (!chain.length || pages.length < TOUR_STOPS.min) {
    return fallback(chain.length ? "no-match" : "unavailable", input, { searchCalls });
  }

  const replan = resolveReplan(map, input.replan);
  const request = tourPrompt(
    wrapVisitor(interest, language),
    pages.map((p) => pageLine(p, corpus)).join("\n"),
    replan,
  );
  const ask = structuredAsk<TourPlan>({
    chain,
    schema: tourSchema,
    instructions: tourInstructions(language),
    call: PLAN_CALL,
    trace: input.trace,
    config,
    abortSignal: input.abortSignal,
    onFailover: input.onFailover,
    beforeModelCall: input.beforeModelCall,
  });

  const ctx: TourCheckContext = {
    pages: new Map(pages.map((p) => [p.id, p])),
    corpus,
    language,
    guard: tourGuard(corpus, config),
    interest,
  };
  const failed: string[] = [];
  const messages: ModelMessage[] = [{ role: "user", content: request }];
  let repaired = false;
  try {
    let plan = await ask(messages);
    if (!plan.stops.length) return fallback("no-match", input, { searchCalls });
    let failures = checkTour(plan, ctx);
    if (failures.length) {
      failed.push(...failures.map((f) => f.gate));
      repaired = true;
      const repair = await repairOnce(plan, messages, tourRepairNote(failures), ask, (p) =>
        // A repair with no stops still fails: it gave up on what the first plan found.
        p.stops.length ? checkTour(p, ctx) : [{ gate: "count", message: "" }],
      );
      plan = repair.value;
      failures = repair.failures;
      if (failures.length) {
        failed.push(...failures.map((f) => f.gate));
        return fallback("no-match", input, { repaired, failures: failed, searchCalls });
      }
    }
    return formatTourPlan(plan, ctx, repaired, failed, searchCalls);
  } catch (error) {
    return handlePlanError(error, input, { repaired, failures: failed, searchCalls });
  }
}

export interface TourStreamRequest {
  interest: string;
  locale: Locale;
  /** The visitor's language, when clear; the tour is written in it. */
  language: Locale | null;
  sessionId: string;
  sessionHash: string;
  corpus: AskCorpus;
  config: AskConfig;
  chain: ModelEntry[];
  abortSignal: AbortSignal;
  replan?: { from: string; seen: readonly string[] };
  droppedAnswers?: number;
  /** Write the log row and the usage (default); off for evals run from a laptop. */
  persist?: boolean;
  /** Called once the stream is over, whatever the outcome (frees the concurrency slot). */
  onClose?: () => void;
}

/**
 * One tour, as one message: the plan (failover statuses meanwhile), then the
 * intro with its sources, the `data-tour` part and the finish, whose signature
 * covers the intro as any answer's covers its text. Logged however it ends.
 */
export function streamTour(request: TourStreamRequest): {
  messageId: string;
  stream: ReadableStream<UIMessageChunk>;
  done: Promise<TourOutcome | null>;
} {
  const { corpus, config, sessionId } = request;
  const language = request.language ?? request.locale;
  const messageId = newMessageId();
  const trace = newTrace();
  const cited = new Set<string>();
  const dropped: string[] = [];
  const replanned = request.replan !== undefined;
  let outcome: TourOutcome | null = null;
  let shown = "";
  let failure: unknown = null;

  const ui = createUIMessageStream({
    execute: async ({ writer }) => {
      outcome = await planTour({
        interest: request.interest,
        language,
        corpus,
        config,
        chain: request.chain,
        trace,
        abortSignal: request.abortSignal,
        ...(request.replan ? { replan: request.replan } : {}),
        persist: request.persist !== false,
        onFailover: (next) =>
          writer.write({
            type: "data-status",
            data: { code: "failover", ...next },
            transient: true,
          }),
      });
      // The intro through the citation check and the output guard, as an answer's words go.
      const guarded = scanChunk(
        tourGuard(corpus, config),
        newScanState(),
        outcome.intro,
        true,
        new LeakTally(),
        echoOf(request.interest),
      );
      const sources: UIMessageChunk[] = [];
      shown = citeText(guarded, { corpus, locale: language, cited, dropped }, (source) =>
        sources.push({
          type: "source-url",
          sourceId: source.id,
          url: source.url,
          title: source.title,
          providerMetadata: source.providerMetadata,
        }),
      );
      const stops = outcome.stops.map((s) => s.id);
      const data: TourData = {
        v: 1,
        kind: outcome.kind,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        interest: request.interest,
        stops: outcome.stops,
        replanned,
        sig: signTour(sessionId, messageId, { stops, replanned }),
      };
      const answering = answeringModel(trace);
      writer.write({ type: "start", messageId, messageMetadata: { createdAt: Date.now() } });
      writer.write({ type: "start-step" });
      for (const source of sources) writer.write(source);
      writer.write({ type: "text-start", id: "intro" });
      writer.write({ type: "text-delta", id: "intro", delta: shown });
      writer.write({ type: "text-end", id: "intro" });
      writer.write({ type: "data-tour", data });
      writer.write({ type: "finish-step" });
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: {
          sig: signAnswer(sessionId, messageId, shown),
          model: answering ? shortName(answering.model) : null,
          ...timings(trace),
        },
      });
    },
    onError: (error) => {
      failure ??= error;
      return "error";
    },
  });

  let resolveDone!: (outcome: TourOutcome | null) => void;
  const done = new Promise<TourOutcome | null>((resolve) => (resolveDone = resolve));

  const stream = closingStream(ui, async (ending, error) => {
    if (error !== undefined) failure ??= error;
    request.onClose?.();
    const result = outcome as TourOutcome | null;
    const finishReason = finishReasonOf(ending, request.abortSignal, failure);
    if (request.persist !== false) {
      await persistTour(request, {
        messageId,
        result,
        trace,
        shown,
        cited: [...cited],
        dropped,
        finishReason,
        replanned,
      });
    }
    resolveDone(result);
  });

  return { messageId, stream, done };
}

function baseRouteReason(result: TourOutcome | null): string {
  if (!result) return "none";
  if (result.kind === "plan") return "plan";
  const reason = result.injection ? "injection" : result.reason;
  return `default:${reason}`;
}

/** The row's route reason: how the tour came about. */
function routeReason(result: TourOutcome | null, replanned: boolean): string {
  const base = baseRouteReason(result);
  return replanned ? `${base}+replan` : base;
}

async function persistTour(
  request: TourStreamRequest,
  details: {
    messageId: string;
    result: TourOutcome | null;
    trace: Trace;
    shown: string;
    cited: string[];
    dropped: string[];
    finishReason: string;
    replanned: boolean;
  },
): Promise<void> {
  // A tour spends the visitors' share, as a question does. Its searches' embedding calls
  // are recorded as the searches make them (embeddings.ts), so here they are only its cost.
  await logRow({
    feature: "terminal",
    calls: details.trace.calls,
    sessionHash: request.sessionHash,
    corpus: request.corpus,
    label: "tour",
    entry: () => tourRow(request, details),
  });
}

function tourRow(
  request: TourStreamRequest,
  details: Parameters<typeof persistTour>[1],
): AnswerLog {
  const { result, trace } = details;
  const { tokens, usd } = summarizeCalls([...trace.calls, ...(result?.searchCalls ?? [])]);
  const tour: NonNullable<AnswerTrace["tour"]> = {
    stops: result?.stops.length ?? 0,
    repaired: result?.repaired ?? false,
    replanned: details.replanned,
    ...(result?.kind === "default"
      ? { fallback: result.injection ? ("injection" as const) : result.reason! }
      : {}),
    ...(result?.failures.length ? { failures: [...new Set(result.failures)] } : {}),
  };
  const checks: AnswerChecks = { v: 1, flags: result?.injection ? ["injection-attempt"] : [] };
  const answering = answeringModel(trace);
  return {
    id: details.messageId,
    sessionHash: request.sessionHash,
    locale: request.locale,
    language: request.language,
    // A visitor's row: `forget` takes it. The route keeps it out of the answers' measures.
    source: "terminal",
    route: TOUR_ROUTE,
    routeReason: routeReason(result, details.replanned),
    question: request.interest,
    answer: [details.shown, ...(result?.stops ?? []).map((s) => s.line)].filter(Boolean).join("\n"),
    citedIds: result?.kind === "plan" ? result.stops.map((s) => s.id) : details.cited,
    toolCalls: [],
    model: answering?.model ?? null,
    attempts: trace.attempts,
    ...timings(trace),
    tokens,
    usd,
    finishReason: details.finishReason,
    promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
    droppedAnswers: request.droppedAnswers ?? 0,
    trace: buildAnswerTrace([], trace, undefined, { tour }),
    droppedCitations: details.dropped,
    corpusKey: snapshotKey(request.corpus),
    checks,
  };
}
