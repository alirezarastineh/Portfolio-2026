import { NoObjectGeneratedError, type ModelMessage } from "ai";
import { z } from "zod";

import type { Locale } from "../../content/schema.js";
import { captureError } from "../../lib/sentry.js";
import { looksLikeInjection, ungroundedFigures } from "../checks.js";
import type { AskConfig } from "../config.js";
import { resolveDocument, type AskCorpus } from "../corpus/index.js";
import { coreView } from "../corpus/render.js";
import { hybridSearch } from "../embeddings.js";
import type { LeakGuard } from "../leak-guard.js";
import { AllModelsFailedError, type ModelCall, type Trace } from "../models/fallback.js";
import type { ModelEntry } from "../models/registry.js";
import { wrapVisitor } from "../prompt.js";
import { sensitivityOf } from "../router.js";
import { markersIn, withoutMarkers } from "../stream-transforms.js";
import {
  guardFor,
  instructionIn,
  LANGUAGE_NAME,
  otherLanguage,
  repairOnce,
  structuredAsk,
  structuredChain,
  wordCount,
  type GateFailure,
} from "../structured.js";
import {
  MATCH_BRIEF_CHARS,
  MATCH_ITEM_CHARS,
  MATCH_ITEMS,
  MATCH_KINDS,
  MATCH_PASSAGES,
  MATCH_ROW_WORDS,
  MATCH_SUMMARY_WORDS,
  planInstructions,
  planPrompt,
  planRepairNote,
  planSchema,
  rowsRepairNote,
  synthInstructions,
  synthPrompt,
  synthSchema,
  type MatchKind,
  type MatchPlan,
  type MatchStatus,
  type MatchStop,
  type MatchSynthesis,
  type SynthItem,
} from "./prompt.js";

/**
 * Match a brief (visitor plan V19; the book's ReWOO and Prompt Chaining): a
 * role, a project or a problem, checked against the published work in four
 * steps and two model calls whatever its length. The plan (lite, structured)
 * lists its items; code searches the corpus for each, with no model; the
 * synthesis (deep when open, structured) writes a row per item from those
 * passages and the core; code verifies every row. Each call's output passes
 * code's gates or is repaired once with the exact failures: a plan that
 * fails twice stops politely, a row that fails twice becomes "not
 * published", never invented. What the server writes itself (the counts, a
 * row nothing shows, a careful topic) is never the model's.
 */

export const matchRequestSchema = z.object({
  kind: z.enum(MATCH_KINDS),
  brief: z.string().max(MATCH_BRIEF_CHARS),
});

export type MatchRequestBody = z.infer<typeof matchRequestSchema>;

/**
 * A brief's own careful words, beside the router's careful topics: a budget,
 * a salary, a rate (not a rate limit), pay, in English and German. Here only,
 * so the live router's questions are routed as before.
 */
const BRIEF_CAREFUL: readonly RegExp[] = [
  /\bbudget/i,
  /\bsalar(?:y|ies)\b/i,
  /\b(?:compensation|remuneration)\b/i,
  /\bpay\s+(?:range|band|scale)\b/i,
  /\b(?:day|daily|hourly)\s+rates?\b(?!\s*limit)/i,
  /\brate\s+card\b/i,
  /\b(?:gehalt|honorar|vergütung|stundensatz|tagessatz|stundenlohn)/i,
];

/** Whether an item is a careful topic: the server says it is not published, and the hand-off follows. */
export function carefulOf(text: string): boolean {
  return sensitivityOf(text) !== null || BRIEF_CAREFUL.some((pattern) => pattern.test(text));
}

/** What the plan's critic reads an item against. */
export interface PlanCheckContext {
  kind: MatchKind;
  /** The language the match is written in. */
  language: Locale;
  /** The visitor's brief: their own words are no leak when an item repeats them. */
  brief: string;
  /** The output guard; null leaves its check out (a unit test of the other gates). */
  guard: LeakGuard | null;
}

const folded = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The plan's critic: code the planner cannot change. Each failure names its
 * item and says exactly what is wrong. A plan with no items is the planner's
 * "nothing to check" and is not checked here.
 */
export function checkPlan(plan: MatchPlan, ctx: PlanCheckContext): GateFailure[] {
  const failures: GateFailure[] = [];
  const n = plan.items.length;
  if (n > MATCH_ITEMS.max) {
    failures.push({
      gate: "count",
      message: `${n} items: list at most ${MATCH_ITEMS.max}, the most important first`,
    });
  }
  const seen = new Map<string, number>();
  plan.items.forEach((item, i) => {
    const at = i + 1;
    const text = item.text.trim();
    if (!text) failures.push({ gate: "length", message: `item ${at} is empty` });
    if (text.length > MATCH_ITEM_CHARS) {
      failures.push({
        gate: "length",
        message: `item ${at} has ${text.length} characters, at most ${MATCH_ITEM_CHARS}`,
      });
    }
    const earlier = seen.get(folded(text));
    if (earlier === undefined) seen.set(folded(text), at);
    else failures.push({ gate: "duplicate", message: `item ${at} repeats item ${earlier}` });
    if (otherLanguage(text, ctx.language)) {
      failures.push({
        gate: "language",
        message: `item ${at} is not in ${LANGUAGE_NAME[ctx.language]}`,
      });
    }
    const instruction = instructionIn(text, ctx.guard, ctx.brief);
    if (instruction) failures.push({ gate: "instruction", message: `item ${at}: ${instruction}` });
  });
  if (ctx.kind === "role" && n && !plan.items.some((item) => item.priority === "must")) {
    failures.push({
      gate: "must",
      message: "no item is a must: mark the requirements the role cannot do without must",
    });
  }
  return failures;
}

/** One item of the plan, as the match keeps it. */
export interface MatchItem {
  /** Its number in the plan, from 1. */
  n: number;
  text: string;
  priority: "must" | "nice";
  /** A careful topic: no search, the server's row. */
  careful: boolean;
  /** The documents its search found, best first. */
  hits: string[];
}

/** One row of the answer, by its item's number. */
export interface MatchRow {
  n: number;
  status: MatchStatus;
  /** The model's words for evidence and partial; empty for not-published (the server's line). */
  summary: string;
  /** The documents it rests on, as the corpus names them. */
  cites: string[];
  /** The critic made it not-published after the repair: what it said was not shown. */
  downgraded: boolean;
}

/** What the rows' critic reads them against. */
export interface RowsCheckContext extends PlanCheckContext {
  corpus: Pick<AskCorpus, "byId">;
  /** The items the synthesis was sent, by number, each with its passages' documents. */
  sent: ReadonlyMap<number, ReadonlySet<string>>;
  /** The documents the core holds with their text. */
  resident: ReadonlySet<string>;
}

/** A failure of one row (`item`), or of the rows as a whole. */
export interface RowFailure extends GateFailure {
  item?: number;
}

/** A row's citations as the corpus names them; what does not resolve stays as written. */
function resolveCites(row: MatchSynthesis["rows"][number], ctx: RowsCheckContext) {
  return row.cites.map((raw) => ({ raw, doc: resolveDocument(ctx.corpus, raw, ctx.language) }));
}

function rowFailures(row: MatchSynthesis["rows"][number], ctx: RowsCheckContext): RowFailure[] {
  const item = row.item;
  const fail = (gate: string, message: string): RowFailure => ({ gate, message, item });
  const failures: RowFailure[] = [];
  const cites = resolveCites(row, ctx);
  if (!cites.length) {
    failures.push(
      fail(
        "citation",
        `item ${item} cites nothing: cite what it rests on, or mark it not-published`,
      ),
    );
  }
  for (const { raw, doc } of cites) {
    if (!doc) {
      failures.push(fail("citation", `item ${item} cites ${raw}, which the site does not have`));
    } else if (!ctx.sent.get(item)!.has(doc.id) && !ctx.resident.has(doc.id)) {
      failures.push(
        fail(
          "citation",
          `item ${item} cites ${doc.id}, which is not among its passages or the documents`,
        ),
      );
    }
  }
  const text = withoutMarkers(row.summary);
  const words = wordCount(text);
  if (!words) failures.push(fail("length", `item ${item}: its summary is empty`));
  if (words > MATCH_ROW_WORDS) {
    failures.push(
      fail("length", `item ${item}: its summary has ${words} words, at most ${MATCH_ROW_WORDS}`),
    );
  }
  const figures = ungroundedFigures({
    text,
    question: ctx.brief,
    citedTexts: cites.flatMap(({ doc }) => (doc ? [doc.text] : [])),
  });
  if (figures.length) {
    failures.push(
      fail("figures", `item ${item} states ${figures.join(", ")}, which no document it cites does`),
    );
  }
  if (otherLanguage(text, ctx.language)) {
    failures.push(
      fail("language", `item ${item}: its summary is not in ${LANGUAGE_NAME[ctx.language]}`),
    );
  }
  const instruction = instructionIn(text, ctx.guard, ctx.brief);
  if (instruction) failures.push(fail("instruction", `item ${item}: its summary ${instruction}`));
  return failures;
}

/**
 * The rows' critic: one row for each item sent and no other; each row that is
 * not not-published cites documents its passages or the core hold, states no
 * figure they lack, in the match's language, with nothing that reads as an
 * instruction. A not-published row's words and citations are the server's,
 * so it is not checked (its citations are dropped, not failed).
 */
export function checkRows(out: MatchSynthesis, ctx: RowsCheckContext): RowFailure[] {
  const failures: RowFailure[] = [];
  const seen = new Set<number>();
  for (const row of out.rows) {
    if (!ctx.sent.has(row.item)) {
      failures.push({
        gate: "rows",
        message: `there is no item ${row.item}: write one row for each numbered item only`,
      });
    } else if (seen.has(row.item)) {
      failures.push({ gate: "rows", message: `item ${row.item} has two rows: write one` });
    } else {
      seen.add(row.item);
      if (row.status !== "not-published") failures.push(...rowFailures(row, ctx));
    }
  }
  for (const n of ctx.sent.keys()) {
    if (!seen.has(n)) failures.push({ gate: "rows", message: `item ${n} has no row`, item: n });
  }
  return failures;
}

/** The documents the rows that passed rest on: all a summary may cite. */
function citedByRows(rows: readonly MatchRow[]): Set<string> {
  return new Set(rows.flatMap((row) => row.cites));
}

/**
 * The summary's critic: optional, so it is never repaired for on its own; a
 * failing summary is left out and the counts line stands alone.
 */
export function checkSummary(
  summary: string,
  rows: readonly MatchRow[],
  ctx: RowsCheckContext,
): GateFailure[] {
  const text = summary.trim();
  if (!text) return [];
  const failures: GateFailure[] = [];
  const words = wordCount(text);
  if (words > MATCH_SUMMARY_WORDS) {
    failures.push({
      gate: "summary-length",
      message: `the summary has ${words} words, at most ${MATCH_SUMMARY_WORDS}`,
    });
  }
  const allowed = citedByRows(rows);
  const marked = markersIn(text).map((raw) => resolveDocument(ctx.corpus, raw, ctx.language));
  if (!marked.length) {
    failures.push({
      gate: "summary-citation",
      message: "the summary cites nothing: cite what it names, as [^id]",
    });
  }
  const strays = marked.filter((doc) => !doc || !allowed.has(doc.id));
  if (strays.length) {
    failures.push({
      gate: "summary-citation",
      message: "the summary cites a document no row cites",
    });
  }
  const figures = ungroundedFigures({
    text,
    question: ctx.brief,
    citedTexts: marked.flatMap((doc) => (doc ? [doc.text] : [])),
  });
  if (figures.length) {
    failures.push({
      gate: "summary-figures",
      message: `the summary states ${figures.join(", ")}, which no document it cites does`,
    });
  }
  if (otherLanguage(text, ctx.language)) {
    failures.push({
      gate: "summary-language",
      message: `the summary is not in ${LANGUAGE_NAME[ctx.language]}`,
    });
  }
  const instruction = instructionIn(text, ctx.guard, ctx.brief);
  if (instruction)
    failures.push({ gate: "summary-instruction", message: `the summary: ${instruction}` });
  return failures;
}

/**
 * The rows as the visitor gets them, after the one repair: a row that still
 * fails, or is missing, becomes not-published and is counted downgraded; a
 * second row for an item, or a row for no item, is left out; a
 * not-published row carries no words and no citations of the model's.
 */
export function settleRows(
  out: MatchSynthesis,
  failures: readonly RowFailure[],
  ctx: RowsCheckContext,
): MatchRow[] {
  const failed = new Set(failures.flatMap((f) => (f.item === undefined ? [] : [f.item])));
  return [...ctx.sent.keys()].map((n): MatchRow => {
    const row = out.rows.find((r) => r.item === n);
    if (!row || failed.has(n)) {
      return { n, status: "not-published", summary: "", cites: [], downgraded: true };
    }
    if (row.status === "not-published") {
      return { n, status: "not-published", summary: "", cites: [], downgraded: false };
    }
    const cites = [...new Set(resolveCites(row, ctx).map(({ doc }) => doc!.id))];
    return {
      n,
      status: row.status,
      summary: withoutMarkers(row.summary),
      cites,
      downgraded: false,
    };
  });
}

/** One step as it starts, for the stream's progress parts. */
export type MatchStep =
  | { step: "plan" }
  | { step: "search"; items: number }
  | { step: "write"; items: number; repair?: true }
  | { step: "check" };

export interface MatchInput {
  kind: MatchKind;
  brief: string;
  /** The language the match is written in, and the corpus it reads. */
  language: Locale;
  corpus: AskCorpus;
  config: AskConfig;
  /** The lite chain, less what the trust monitor demoted. */
  lite: ModelEntry[];
  /** The deep chain, less the demoted, when the deep route is open; null otherwise. */
  deep: ModelEntry[] | null;
  trace: Trace;
  abortSignal: AbortSignal;
  /** Whether the searches' embedding spend is recorded (an eval's is not). */
  persist?: boolean;
  /** Each step as it starts. */
  onStep?: (step: MatchStep) => void;
  /** A failover before a call's answer (visitor plan V12). */
  onFailover?: (next: { position: number; of: number }) => void;
  /** Bulk evals pace each provider request through this. */
  beforeModelCall?: (entry: ModelEntry, signal?: AbortSignal) => Promise<void>;
}

export interface MatchOutcome {
  kind: MatchKind;
  language: Locale;
  items: MatchItem[];
  /** One for each item, in the plan's order; none when the match stopped. */
  rows: MatchRow[];
  /** The model's summary, when it passed its checks. */
  summary: string | null;
  /** Why it stopped before its rows. */
  stop?: MatchStop;
  repaired: { plan: boolean; rows: boolean };
  /** The gates the plans, rows and summary failed, in order. */
  failures: string[];
  /** The brief read as an injection: recorded, and its rows still need their citations. */
  injection: boolean;
  /** The searches run, and their embedding calls (plan phase 18). */
  searches: number;
  searchCalls: ModelCall[];
}

const PLAN_CALL = { maxOutputTokens: 800, temperature: 0.2, maxRetries: 0 } as const;
const SYNTH_CALL = { maxOutputTokens: 2_000, temperature: 0.2, maxRetries: 0 } as const;

/** The output guard for match's texts: both calls' instructions, never to be repeated. */
export const matchGuard = (corpus: AskCorpus, config: AskConfig): LeakGuard =>
  guardFor(
    "match",
    () =>
      MATCH_KINDS.flatMap((kind) =>
        (["en", "de"] as const).flatMap((language) => [
          planInstructions(kind, language),
          synthInstructions(kind, language),
        ]),
      ).join("\n\n"),
    corpus,
    config,
  );

/** Why a call failed, as a stop: no parseable answer is nothing to check; anything else, no model. */
function stopFor(error: unknown, input: MatchInput, phase: string): MatchStop {
  if (input.abortSignal.aborted) throw error;
  if (NoObjectGeneratedError.isInstance(error)) return "empty";
  if (!(error instanceof AllModelsFailedError)) {
    console.error(`[ask] ${phase} failed`, error);
    captureError(error, { phase });
  }
  return "unavailable";
}

const gatesOf = (failures: readonly GateFailure[]) => failures.map((f) => f.gate);

/** The plan: one structured call on the lite chain, checked; one repair; else a stop. */
async function planItems(
  input: MatchInput,
  ctx: PlanCheckContext,
  outcome: MatchOutcome,
): Promise<MatchPlan["items"] | MatchStop> {
  const chain = structuredChain(input.lite);
  if (!chain.length) return "unavailable";
  const ask = structuredAsk<MatchPlan>({
    chain,
    schema: planSchema,
    instructions: planInstructions(input.kind, input.language),
    call: PLAN_CALL,
    trace: input.trace,
    config: input.config,
    abortSignal: input.abortSignal,
    onFailover: input.onFailover,
    beforeModelCall: input.beforeModelCall,
  });
  const messages: ModelMessage[] = [
    { role: "user", content: planPrompt(input.kind, wrapVisitor(input.brief, input.language)) },
  ];
  try {
    let plan = await ask(messages);
    if (!plan.items.length) return "empty";
    let failures = checkPlan(plan, ctx);
    if (failures.length) {
      outcome.failures.push(...gatesOf(failures));
      outcome.repaired.plan = true;
      const repair = await repairOnce(plan, messages, planRepairNote(failures), ask, (p) =>
        // A repair with no items gave up on what the first list found: it fails too.
        p.items.length ? checkPlan(p, ctx) : [{ gate: "count", message: "" }],
      );
      plan = repair.value;
      failures = repair.failures;
      if (failures.length) {
        outcome.failures.push(...gatesOf(failures));
        return "empty";
      }
    }
    return plan.items;
  } catch (error) {
    return stopFor(error, input, "match-plan");
  }
}

/**
 * Each item's passages, searched by code: its own words, then its terms;
 * careful items not at all. The items are searched at once, each its own.
 */
async function retrieve(
  planned: MatchPlan["items"],
  input: MatchInput,
  outcome: MatchOutcome,
): Promise<{ items: MatchItem[]; passages: Map<number, SynthItem["passages"]> }> {
  const search = async (query: string) => {
    outcome.searches++;
    const { hits } = await hybridSearch(input.corpus, query, {
      config: input.config,
      reading: input.language,
      limit: MATCH_PASSAGES,
      spend: { record: input.persist ?? true, calls: outcome.searchCalls },
    });
    return hits;
  };
  const found = await Promise.all(
    planned.map(async (item, i) => {
      const text = item.text.trim();
      const careful = carefulOf(text);
      let hits = careful ? [] : await search(text);
      const terms = item.terms.map((t) => t.trim()).filter(Boolean);
      if (!careful && !hits.length && terms.length) hits = await search(terms.join(" "));
      const searched: MatchItem = {
        n: i + 1,
        text,
        priority: item.priority,
        careful,
        hits: hits.map((h) => h.id),
      };
      return { item: searched, hits };
    }),
  );
  const passages = new Map<number, SynthItem["passages"]>(
    found
      .filter(({ hits }) => hits.length)
      .map(({ item, hits }) => [
        item.n,
        hits.map((h) => ({
          id: h.id,
          title: h.title,
          snippet: h.snippet.replace(/\s+/g, " ").trim(),
          ...(h.related?.length ? { related: h.related } : {}),
        })),
      ]),
  );
  return { items: found.map(({ item }) => item), passages };
}

/** The rows: one structured call, verified; one repair; what still fails becomes not-published. */
async function synthesize(
  input: MatchInput,
  ctx: PlanCheckContext,
  items: MatchItem[],
  passages: Map<number, SynthItem["passages"]>,
  outcome: MatchOutcome,
): Promise<MatchStop | null> {
  const sent = items.filter((item) => passages.has(item.n));
  const serverRows = (): MatchRow[] =>
    items.map((item) => ({
      n: item.n,
      status: "not-published",
      summary: "",
      cites: [],
      downgraded: false,
    }));
  if (!sent.length) {
    outcome.rows = serverRows();
    return null;
  }
  const deep = structuredChain(input.deep ?? []);
  const chain = deep.length ? deep : structuredChain(input.lite);
  if (!chain.length) return "unavailable";

  const rowsCtx: RowsCheckContext = {
    ...ctx,
    corpus: input.corpus,
    sent: new Map(sent.map((item) => [item.n, new Set(passages.get(item.n)!.map((p) => p.id))])),
    resident: new Set(
      coreView(input.corpus.documents, input.language, input.corpus.layout).resident.map(
        (d) => d.id,
      ),
    ),
  };
  const ask = structuredAsk<MatchSynthesis>({
    chain,
    schema: synthSchema,
    instructions: `${synthInstructions(input.kind, input.language)}\n\n${input.corpus.core[input.language]}`,
    call: SYNTH_CALL,
    trace: input.trace,
    config: input.config,
    abortSignal: input.abortSignal,
    onFailover: input.onFailover,
    beforeModelCall: input.beforeModelCall,
  });
  const fencedItems = wrapVisitor(
    sent.map((item) => `${item.n}. (${item.priority}) ${item.text}`).join("\n"),
    input.language,
  );
  const request = synthPrompt(
    input.kind,
    fencedItems,
    sent.map((item) => ({ n: item.n, passages: passages.get(item.n)! })),
    wrapVisitor(input.brief, input.language),
  );
  const messages: ModelMessage[] = [{ role: "user", content: request }];

  input.onStep?.({ step: "write", items: sent.length });
  let out: MatchSynthesis;
  try {
    out = await ask(messages);
  } catch (error) {
    // No rows to show: "nothing published" would be untrue when nothing was checked.
    stopFor(error, input, "match-synthesize");
    return "unavailable";
  }
  input.onStep?.({ step: "check" });
  let failures = checkRows(out, rowsCtx);
  if (failures.length) {
    outcome.failures.push(...gatesOf(failures));
    outcome.repaired.rows = true;
    input.onStep?.({ step: "write", items: sent.length, repair: true });
    const summaryNote = checkSummary(out.summary, settleRows(out, failures, rowsCtx), rowsCtx);
    try {
      const repair = await repairOnce(
        out,
        messages,
        rowsRepairNote([...failures, ...summaryNote]),
        ask,
        (o) => checkRows(o, rowsCtx),
      );
      out = repair.value;
      failures = repair.failures;
      if (failures.length) outcome.failures.push(...gatesOf(failures));
    } catch (error) {
      // The repair could not be had: the first rows stand, each failing one not-published.
      stopFor(error, input, "match-repair");
    }
    input.onStep?.({ step: "check" });
  }
  const settled = settleRows(out, failures, rowsCtx);
  const summaryFailures = checkSummary(out.summary, settled, rowsCtx);
  outcome.failures.push(...gatesOf(summaryFailures));
  outcome.summary = summaryFailures.length || !out.summary.trim() ? null : out.summary.trim();
  const byItem = new Map(settled.map((row) => [row.n, row]));
  outcome.rows = serverRows().map((row) => byItem.get(row.n) ?? row);
  return null;
}

/**
 * A match, start to end, with no stream: what the route streams and the evals
 * grade. An outage of the plan or the rows stops it with its line; the
 * visitor gets the hand-off either way.
 */
export async function runMatch(input: MatchInput): Promise<MatchOutcome> {
  const outcome: MatchOutcome = {
    kind: input.kind,
    language: input.language,
    items: [],
    rows: [],
    summary: null,
    repaired: { plan: false, rows: false },
    failures: [],
    injection: looksLikeInjection(input.brief),
    searches: 0,
    searchCalls: [],
  };
  const ctx: PlanCheckContext = {
    kind: input.kind,
    language: input.language,
    brief: input.brief,
    guard: matchGuard(input.corpus, input.config),
  };
  input.onStep?.({ step: "plan" });
  const planned = await planItems(input, ctx, outcome);
  if (typeof planned === "string") return { ...outcome, stop: planned };

  input.onStep?.({ step: "search", items: planned.length });
  const { items, passages } = await retrieve(planned, input, outcome);
  outcome.items = items;
  const stop = await synthesize(input, ctx, items, passages, outcome);
  return stop ? { ...outcome, rows: [], stop } : outcome;
}
