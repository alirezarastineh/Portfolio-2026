import type { Locale } from "../content/schema";
import type { RunRow } from "./assistant-types";

/**
 * The failure journal in the admin (plan phase 24; `server/src/ask/journal.ts`):
 * why a visitor's answer failed, as Diagnose worked it out (seven hypotheses,
 * the evidence for and against each), and what the admin decided. Shapes and
 * pure helpers, so the Journal tab and the Conversations button share them.
 */

export type HypothesisId =
  | "content-missing"
  | "retrieval-miss"
  | "context-unused"
  | "degraded-model"
  | "language"
  | "under-routed"
  | "infrastructure";

export type JournalStatus = "proposed" | "accepted" | "fixed" | "retired";
export type FixType = "content" | "faq" | "prompt" | "routing" | "retrieval" | "model" | "infra";
export type Position = "whole" | "held" | "rest" | "clipped" | "handle";

export interface Evidence {
  experiment: string;
  supports: boolean;
  /** Ids, counts, flags, models and the corpus's own words: no visitor text. */
  observation: string;
}

export interface Hypothesis {
  id: HypothesisId;
  evidence: Evidence[];
  supporting: number;
  contradicting: number;
  /** Supporting over all its evidence, 0.5 with none: a count, not a probability. */
  ratio: number;
}

export interface Located {
  id: string;
  named: boolean;
  coverage: number;
  words: string[];
  pastCut: string[];
  position: Position;
  held: number;
  length: number;
}

export interface Proposal {
  rootCause: string;
  fixType: FixType | null;
  fix: string;
  fixRef: string | null;
  heuristic: string;
}

export interface Diagnosis {
  v: 1;
  symptoms: string[];
  context: {
    locale: Locale;
    reading: Locale;
    layout: "locale" | "both";
    route: string;
    model: string | null;
    finishReason: string;
    steps: number;
    tools: string[];
    corpusKey: string | null;
    corpus: "snapshot" | "live";
    promptVersion: string;
    traced: boolean;
  };
  located: Located | null;
  addedSince: string | null;
  /** Best first. */
  hypotheses: Hypothesis[];
  leading: HypothesisId | null;
  untested: string[];
  next: string[];
  proposal: Proposal;
  replayed: boolean;
}

export interface ReplayOutcome {
  chain: "lite" | "deep";
  model: string | null;
  finishReason: string;
  answered: boolean;
  unknown: boolean;
  cited: string[];
  flags: string[];
  usd: number;
  unavailable: boolean;
}

export interface JournalEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageIds: string[];
  /** The error: the answer's first symptom, or `reported`. */
  category: string;
  diagnosis: Diagnosis;
  rootCause: string;
  fixType: FixType | null;
  fix: string;
  fixRef: string | null;
  heuristic: string;
  /** The regression case: an eval case frozen from the answer. */
  caseId: string | null;
  status: JournalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  replay: { runId: string; at: string; corpusKey: string; results: ReplayOutcome[] } | null;
  /** Its first answer while that is kept (90 days); null once pruned. */
  message: { id: string; question: string; createdAt: string; citedIds: string[] } | null;
}

export interface JournalView {
  entries: JournalEntry[];
  counts: Record<JournalStatus, number>;
}

export type JournalPatch = Partial<
  Pick<JournalEntry, "status" | "rootCause" | "fixType" | "fix" | "fixRef" | "caseId" | "heuristic">
>;

export const HYPOTHESES: Record<HypothesisId, { code: string; title: string; hint: string }> = {
  "content-missing": {
    code: "H1",
    title: "Content missing",
    hint: "The portfolio does not say it.",
  },
  "retrieval-miss": {
    code: "H2",
    title: "Retrieval miss",
    hint: "It is there, but no search brought it up.",
  },
  "context-unused": {
    code: "H3",
    title: "Context clipped or unused",
    hint: "The answer had it, or was one fetch away, and did not use it.",
  },
  "degraded-model": {
    code: "H4",
    title: "Degraded model",
    hint: "A fallback or a weaker model answered.",
  },
  language: {
    code: "H5",
    title: "Language",
    hint: "The answer's language, or the fact's, got in the way.",
  },
  "under-routed": {
    code: "H6",
    title: "Under-routed",
    hint: "The lite route kept a question the deep route should have taken.",
  },
  infrastructure: {
    code: "H7",
    title: "Infrastructure",
    hint: "A provider, a timeout or a limit failed it.",
  },
};

export const FIX_TYPES: { id: FixType; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "faq", label: "FAQ entry" },
  { id: "prompt", label: "Prompt" },
  { id: "routing", label: "Routing" },
  { id: "retrieval", label: "Retrieval" },
  { id: "model", label: "Model chain" },
  { id: "infra", label: "Infrastructure" },
];

export const STATUSES: { id: JournalStatus; label: string }[] = [
  { id: "proposed", label: "Proposed" },
  { id: "accepted", label: "Accepted" },
  { id: "fixed", label: "Fixed" },
  { id: "retired", label: "Retired" },
];

export const statusLabel = (status: JournalStatus): string =>
  STATUSES.find((s) => s.id === status)?.label ?? status;

const SYMPTOMS: Record<string, string> = {
  failed: "failed",
  leak: "leak",
  unknown: "didn't know",
  "invented-citation": "invented citation",
  empty: "empty",
  uncited: "uncited",
  unfaithful: "unfaithful",
  language: "wrong language",
  "max-rounds": "out of rounds",
  degraded: "fallback answered",
  blocked: "blocked",
  "thumbs-down": "thumbs down",
  rephrased: "asked again",
  aborted: "visitor left",
  reported: "reported",
};

export const symptomLabel = (symptom: string): string => SYMPTOMS[symptom] ?? symptom;

/** "H3 Context clipped or unused". */
export const hypothesisName = (id: HypothesisId): string =>
  `${HYPOTHESES[id].code} ${HYPOTHESES[id].title}`;

/** "2 for, 0 against · 1.00", or "untested": a count, not a probability. */
export function ratioLine(h: Pick<Hypothesis, "supporting" | "contradicting" | "ratio">): string {
  if (!h.supporting && !h.contradicting) return "untested";
  return `${h.supporting} for, ${h.contradicting} against · ${h.ratio.toFixed(2)}`;
}

/** The diagnosis in one line: the leading hypothesis, or that none leads. */
export function leadingLine(d: Pick<Diagnosis, "hypotheses" | "leading">): string {
  const leading = d.leading && d.hypotheses.find((h) => h.id === d.leading);
  return leading
    ? `${hypothesisName(leading.id)} · ${ratioLine(leading)}`
    : "Undetermined: no hypothesis has more evidence for than against";
}

const POSITIONS: Record<Position, string> = {
  whole: "held whole in the core",
  held: "cut short in the core, the matching words before the cut",
  rest: "cut short in the core, a matching word only past the cut",
  clipped: "cut short in the core",
  handle: "one line in the core (a handle in the other language)",
};

/** Where the fact sat: "project:long@en (named by you): cut short …, at 2,394 of 3,512". */
export function locatedLine(located: Located): string {
  const who = located.named ? " (named by you)" : "";
  const size =
    located.position === "whole" || located.position === "handle"
      ? ""
      : `, at ${located.held.toLocaleString("en-GB")} of ${located.length.toLocaleString("en-GB")} characters`;
  return `${located.id}${who}: ${POSITIONS[located.position]}${size}`;
}

function replayOutcome(r: ReplayOutcome): string {
  const citing = r.cited.length ? `, citing ${r.cited.join(", ")}` : "";
  if (r.answered) return `answered${citing || ", citing nothing"}`;
  if (r.unknown) return `said it isn't there${citing}`;
  return `failed (${r.finishReason})`;
}

/** One line per replayed chain: who answered, and how it went. */
export function replayLines(results: readonly ReplayOutcome[]): string[] {
  return results.map((r) =>
    r.unavailable
      ? `${r.chain}: no model answered`
      : `${r.chain}: ${r.model ?? "a model"} ${replayOutcome(r)}`,
  );
}

/** Where an entry may go from its status (the server's `TRANSITIONS`). */
export const NEXT: Record<JournalStatus, readonly JournalStatus[]> = {
  proposed: ["accepted", "retired"],
  accepted: ["fixed", "retired"],
  fixed: ["retired"],
  retired: ["proposed"],
};

/** "Be careful" is not a lesson. */
export const HEURISTIC_MIN_WORDS = 8;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Why the entry cannot stand as accepted or fixed, in the server's terms
 * (`decisionProblem`), said for the admin; null when it can.
 */
export function decisionProblem(
  status: JournalStatus,
  fields: Pick<JournalEntry, "rootCause" | "heuristic" | "fixType" | "fixRef" | "caseId">,
): string | null {
  if (status !== "accepted" && status !== "fixed") return null;
  if (!fields.rootCause.trim()) return "Write the root cause first.";
  if (words(fields.heuristic) < HEURISTIC_MIN_WORDS) {
    return `The heuristic needs at least ${HEURISTIC_MIN_WORDS} words: when it applies, and why.`;
  }
  if (status === "fixed" && (!fields.fixType || (!fields.fixRef?.trim() && !fields.caseId))) {
    return "Name the fix (its type, and what it is) or freeze a regression case first.";
  }
  return null;
}

/** The server's refusals, said for the admin. */
export const REFUSALS: Record<string, string> = {
  not_found: "This answer is gone (pruned after 90 days) or is not a visitor's.",
  unknown_document: "No document with that id was in the answer's corpus.",
  corpus_unavailable: "Neither the answer's corpus nor today's could be read.",
  bad_transition: "An entry cannot move there from its status.",
  missing_root_cause: "Write the root cause first.",
  vague_heuristic: `The heuristic needs at least ${HEURISTIC_MIN_WORDS} words.`,
  missing_fix: "Name the fix or freeze a regression case first.",
  unknown_case: "That eval case does not exist.",
  feature_off: "Admin agents are switched off: Settings → Spending.",
  cap_reached: "Admin agents reached their daily cap.",
  reserve_reached: "Today's spend reached the share kept for visitors.",
  assistant_resting: "Today's budget is spent.",
  already_running: "Another paid run is going; try once it ends.",
  answer_gone: "The answer was pruned: there is no question left to replay.",
  not_replayable: "A fixed or retired entry is not replayed.",
  no_chain: "No chain is configured to replay on.",
};

export const refusal = (code: string): string => REFUSALS[code] ?? code;

/** Runs a resume picks up (runs/runner.ts). */
const RESUMABLE = new Set<RunRow["status"]>(["failed", "interrupted", "cancelled"]);

/**
 * Each entry's newest replay (a run of kind `agent`, newest first in the list),
 * when it stopped short; a newer one that finished or runs supersedes it.
 */
export function stoppedReplays(runs: readonly RunRow[]): Record<string, RunRow> {
  const newest = new Map<string, RunRow>();
  for (const run of runs) {
    const entry = run.kind === "agent" ? run.params["entry"] : undefined;
    if (typeof entry === "string" && !newest.has(entry)) newest.set(entry, run);
  }
  return Object.fromEntries([...newest].filter(([, run]) => RESUMABLE.has(run.status)));
}
