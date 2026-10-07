import type { Locale } from "../content/schema.js";
import { NOT_IN_PORTFOLIO } from "./answer-patterns.js";
import type { CorpusDocument } from "./corpus/build.js";
import { baseId, coreView, heldText, type CoreLayout } from "./corpus/render.js";
import { CorpusSearch } from "./corpus/search.js";
import { FAITHFUL_AT } from "./evals/calibration.js";
import { FUNCTION_WORDS } from "./history-window.js";
import { requestedId, resolveRequested } from "./perception.js";
import { routeQuestion } from "./router.js";
import { UNDER_SERVED } from "./router-report.js";
import type { AnswerTrace, TraceStep } from "./trace.js";

/**
 * The failure journal's investigator (plan phase 24): why a visitor's answer
 * went wrong, found by experiment rather than by feel. The book's loop
 * (Iterative Hypothesis Testing, OHEAR): observe the answer first (its trace,
 * checks and attempts, and the corpus it read); hold seven hypotheses at
 * once; run the experiments the environment allows (the corpus, its search,
 * the core the answer read); count the evidence for and against each; and
 * propose an entry in the book's form (Failure Journals: context, error, fix,
 * transferable heuristic) for a person to accept or not. No model takes part:
 * a fluent explanation is not evidence. A replay (the question answered
 * again, paid, runs/replay-work.ts) adds evidence when the admin runs one.
 *
 * Pure. Nothing it returns holds visitor text: ids, counts, flags, models,
 * and a question's words only where a document of the corpus has them too,
 * in the document's spelling. The journal outlives the answers' 90 days.
 */

export const HYPOTHESES = [
  "content-missing",
  "retrieval-miss",
  "context-unused",
  "degraded-model",
  "language",
  "under-routed",
  "infrastructure",
] as const;
export type HypothesisId = (typeof HYPOTHESES)[number];

export const HYPOTHESIS_TITLES: Record<HypothesisId, string> = {
  "content-missing": "Content missing",
  "retrieval-miss": "Retrieval miss",
  "context-unused": "Context clipped or unused",
  "degraded-model": "Degraded model",
  language: "Language",
  "under-routed": "Under-routed",
  infrastructure: "Infrastructure",
};

/** What went wrong, most telling first: an entry's category is the first one present. */
export const SYMPTOMS = [
  "failed",
  "leak",
  "unknown",
  "invented-citation",
  "empty",
  "uncited",
  "unfaithful",
  "language",
  "max-rounds",
  "degraded",
  "blocked",
  "thumbs-down",
  "rephrased",
  "aborted",
] as const;
export type Symptom = (typeof SYMPTOMS)[number];
/** `reported`: no symptom the system saw; the admin's own call. */
export type Category = Symptom | "reported";

export const FIX_TYPES = [
  "content",
  "faq",
  "prompt",
  "routing",
  "retrieval",
  "model",
  "infra",
] as const;
export type FixType = (typeof FIX_TYPES)[number];

export const JOURNAL_STATUSES = ["proposed", "accepted", "fixed", "retired"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export type Experiment =
  | "locate"
  | "live"
  | "position"
  | "reads"
  | "searches"
  | "question-search"
  | "citation"
  | "partial-reads"
  | "model"
  | "language"
  | "routing"
  | "infrastructure"
  | "replay";

export interface Evidence {
  experiment: Experiment;
  /** For the hypothesis, or against it. */
  supports: boolean;
  /** What was observed: ids, counts, flags, models and corpus words only. */
  observation: string;
}

export interface HypothesisResult {
  id: HypothesisId;
  evidence: Evidence[];
  supporting: number;
  contradicting: number;
  /** Supporting over all its evidence, 0.5 with none: a count, not a probability. */
  ratio: number;
}

/**
 * Where the document holding the fact sat in the core the answer read: a
 * one-line `handle`, held `whole`, cut short with the matched words before
 * the cut (`held`) or one of them only past it (`rest`), or cut short with no
 * word matched to place (`clipped`: a document the admin named).
 */
export type Position = "whole" | "held" | "rest" | "clipped" | "handle";

export interface Located {
  id: string;
  /** Named by the admin rather than found by its words. */
  named: boolean;
  /** The share of the question's word weight the document holds (0–1). */
  coverage: number;
  /** The question's words it holds, in the document's spelling. */
  words: string[];
  /** Of those, the ones only past the core's cut. */
  pastCut: string[];
  position: Position;
  /** Characters the core held of it (0 for a handle), and its length. */
  held: number;
  length: number;
}

/** The context the answer failed in (the book's first field): ids and flags only. */
export interface DiagnosisContext {
  /** The page's language, and the language of the core the answer read. */
  locale: Locale;
  reading: Locale;
  layout: CoreLayout;
  route: string;
  model: string | null;
  finishReason: string;
  steps: number;
  tools: string[];
  corpusKey: string | null;
  /** Whether the experiments read the answer's own corpus or, without a snapshot, today's. */
  corpus: "snapshot" | "live";
  promptVersion: string;
  traced: boolean;
}

export interface Proposal {
  rootCause: string;
  fixType: FixType | null;
  fix: string;
  fixRef: string | null;
  heuristic: string;
}

export interface JournalDiagnosis {
  v: 1;
  symptoms: Symptom[];
  context: DiagnosisContext;
  located: Located | null;
  /** A document of today's corpus that has what the answer's corpus did not. */
  addedSince: string | null;
  /** Best first. */
  hypotheses: HypothesisResult[];
  /** The leading hypothesis, or null when no hypothesis has more evidence for than against. */
  leading: HypothesisId | null;
  /** Experiments that could not run, and why. */
  untested: string[];
  /** What would separate the leading hypotheses: the loop's revise step. */
  next: string[];
  proposal: Proposal;
  /** Whether a replay's outcomes are part of the evidence. */
  replayed: boolean;
}

/** One chain's replay of the question: outcomes only, never the answer's text. */
export interface ReplayResult {
  chain: "lite" | "deep";
  model: string | null;
  finishReason: string;
  /** Written, with words or an action, and not "it isn't there". */
  answered: boolean;
  unknown: boolean;
  cited: string[];
  flags: string[];
  usd: number;
  /** No model answered, or not in time: it says nothing about the question. */
  unavailable: boolean;
}

export interface ReplayRecord {
  runId: string;
  at: string;
  /** Today's corpus, which the replay answered from. */
  corpusKey: string;
  results: ReplayResult[];
}

/** One visitor answer, as the row and its session hold it. */
export interface DiagnosisAnswer {
  id: string;
  /** The page's language. */
  locale: Locale;
  /** The redacted question: read, never stored. */
  question: string;
  /** The answer's excerpt: read for "it isn't there", never stored. */
  answer: string;
  citedIds: readonly string[];
  toolCalls: readonly string[];
  model: string | null;
  route: string;
  finishReason: string;
  ttftMs: number | null;
  totalMs: number;
  flags: readonly string[];
  /** Whether the checks ran on it (rows from before plan phase 6 have none). */
  checked: boolean;
  feedback: 1 | -1 | null;
  faithfulness: number | null;
  /** The visitor asked again within two minutes (outcomes.ts). */
  rephrased: boolean;
  promptVersion: string;
  corpusKey: string | null;
  attempts: readonly { model: string; outcome: string; ms: number }[];
  trace: AnswerTrace | null;
}

export interface DiagnosisInput {
  answer: DiagnosisAnswer;
  /** The documents the answer read (its snapshot); null when they were not kept. */
  snapshot: readonly CorpusDocument[] | null;
  /** Today's documents; null when today's corpus could not be built. */
  live: readonly CorpusDocument[] | null;
  /** The projects' names, for the router's "two projects" reason. */
  projectNames: readonly string[];
  /** The document the admin names as holding the answer. */
  expected?: string | null;
  replay?: ReplayRecord | null;
}

/** A document holds the fact when it has this share of the question's word weight. */
export const LOCATED_SHARE = 0.6;
/** The documents looked at: the first of the search's ranking. */
const CANDIDATES = 8;
const MAX_WORDS = 12;
/** An aborted answer whose first token came later than this was left for the infrastructure. */
const SLOW_FIRST_TOKEN_MS = 10_000;
/** The root cause the proposal writes: its evidence, cut to this. */
const ROOT_CAUSE_CHARS = 600;

const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };
const NOT_THERE = new RegExp(NOT_IN_PORTFOLIO, "i");

/** Symptoms about what an answer said, where using the corpus better would have helped. */
const CONTENT_SYMPTOMS = new Set<Category>([
  "unknown",
  "unfaithful",
  "thumbs-down",
  "rephrased",
  "reported",
]);

/** Attempt outcomes that are the infrastructure's, not a configuration's choice. */
const INFRA_OUTCOMES = new Set([
  "rate-limited",
  "server-error",
  "client-error",
  "network",
  "timeout",
  "skipped-open",
]);

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const count = (n: number) => n.toLocaleString("en-GB");
const percent = (share: number) => `${Math.round(share * 100)} %`;
const sameDocument = (a: string, b: string) => baseId(a) === baseId(b);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What the visitor asked about: words of 3 characters or more, no function words, at most 12. */
export function contentWords(question: string): string[] {
  const words: string[] = [];
  for (const word of tokens(question.replaceAll(/\[(?:email|number)\]/g, " "))) {
    if (word.length < 3 || FUNCTION_WORDS.has(word) || words.includes(word)) continue;
    words.push(word);
    if (words.length === MAX_WORDS) break;
  }
  return words;
}

/** Inflections stripped to compare words, longest first (English and German). */
const ENDINGS = [
  "ungen",
  "ments",
  "ings",
  "ions",
  "ment",
  "ung",
  "ing",
  "ion",
  "ers",
  "ed",
  "es",
  "en",
  "em",
  "er",
  "ly",
  "e",
  "s",
];

/**
 * A word's stem: up to three inflections off, the longest first, always
 * keeping 3 characters; -ies and -ied become -y. Light by design: it joins
 * `relocating` and `relocation`, `Kündigungsfrist` and `Kündigungsfristen`,
 * and keeps a word inside a longer one apart ("Atlas" is not "Atlassian").
 */
export function stem(word: string): string {
  let w = word;
  for (let pass = 0; pass < 3; pass++) {
    if (w.length > 4 && /ie[sd]$/.test(w)) {
      w = `${w.slice(0, -3)}y`;
      continue;
    }
    const ending = ENDINGS.find((e) => w.endsWith(e) && w.length - e.length >= 3);
    if (!ending) break;
    w = w.slice(0, -ending.length);
  }
  return w;
}

/** The same word, perhaps inflected: equal, or the same stem. */
export function sameWord(a: string, b: string): boolean {
  return a === b || stem(a) === stem(b);
}

/** A text's words by stem, each in the text's own spelling (its first). */
type Vocabulary = ReadonlyMap<string, string>;

function vocabularyOf(text: string): Vocabulary {
  const words = new Map<string, string>();
  for (const token of tokens(text)) {
    const s = stem(token);
    if (!words.has(s)) words.set(s, token);
  }
  return words;
}

/** The text's spelling of `word`, inflected; undefined when the text lacks it. */
const matchIn = (vocabulary: Vocabulary, word: string): string | undefined =>
  vocabulary.get(stem(word));

interface Indexed {
  doc: CorpusDocument;
  vocabulary: Vocabulary;
}

interface Coverage {
  share: number;
  /** Per question word, the document's spelling of it, or undefined. */
  matches: (string | undefined)[];
}

/** Everything the experiments read, worked out once. */
interface Scene {
  answer: DiagnosisAnswer;
  documents: readonly CorpusDocument[];
  corpus: "snapshot" | "live";
  indexed: Indexed[];
  search: CorpusSearch;
  reading: Locale;
  layout: CoreLayout;
  handles: ReadonlySet<string>;
  words: string[];
  weights: number[];
  symptoms: Symptom[];
  category: Category;
  /** An answer was written: it did not fail, stop for the filter, or lose its visitor. */
  written: boolean;
  steps: readonly TraceStep[];
}

type Finding = { h: HypothesisId; e: Evidence };

const finding = (
  h: HypothesisId,
  experiment: Experiment,
  supports: boolean,
  observation: string,
): Finding => ({ h, e: { experiment, supports, observation } });

function index(documents: readonly CorpusDocument[]): Indexed[] {
  return documents.map((doc) => ({ doc, vocabulary: vocabularyOf(`${doc.title}\n${doc.text}`) }));
}

/**
 * A word's weight, `ln((N + 1) / (df + 1)) + 1`: a word every document has
 * (the owner's name) counts little, a word none has counts most.
 */
function weightsOf(words: readonly string[], indexed: readonly Indexed[]): number[] {
  return words.map((word) => {
    const df = indexed.filter((d) => matchIn(d.vocabulary, word) !== undefined).length;
    return Math.log((indexed.length + 1) / (df + 1)) + 1;
  });
}

function coverageOf(d: Indexed, words: readonly string[], weights: readonly number[]): Coverage {
  const matches = words.map((word) => matchIn(d.vocabulary, word));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const held = matches.reduce((sum, m, i) => (m === undefined ? sum : sum + weights[i]!), 0);
  return { share: total ? held / total : 0, matches };
}

export function symptomsOf(answer: DiagnosisAnswer): Symptom[] {
  const flags = new Set(answer.flags);
  const present: Record<Symptom, boolean> = {
    failed: answer.finishReason.startsWith("error"),
    leak: flags.has("leak"),
    unknown: NOT_THERE.test(answer.answer),
    "invented-citation": flags.has("invented-citation"),
    empty: flags.has("empty"),
    uncited: flags.has("uncited"),
    unfaithful: answer.faithfulness !== null && answer.faithfulness < FAITHFUL_AT,
    language: flags.has("language"),
    "max-rounds": flags.has("max-rounds"),
    degraded: flags.has("degraded"),
    blocked: flags.has("blocked"),
    "thumbs-down": answer.feedback === -1,
    rephrased: answer.rephrased,
    aborted: answer.finishReason === "aborted",
  };
  return SYMPTOMS.filter((s) => present[s]);
}

function observe(input: DiagnosisInput): Scene {
  const { answer } = input;
  const documents = input.snapshot ?? input.live;
  if (!documents) throw new Error("diagnose: neither the answer's corpus nor today's");
  const reading = answer.trace?.core?.locale ?? answer.locale;
  // Answers from before per-language cores (no core in their trace) read one core with both.
  const layout = answer.trace?.core?.layout ?? "both";
  const indexed = index(documents);
  const words = contentWords(answer.question);
  const symptoms = symptomsOf(answer);
  return {
    answer,
    documents,
    corpus: input.snapshot ? "snapshot" : "live",
    indexed,
    search: new CorpusSearch([...documents]),
    reading,
    layout,
    handles: new Set(coreView(documents, reading, layout).handles.map((d) => d.id)),
    words,
    weights: weightsOf(words, indexed),
    symptoms,
    category: symptoms[0] ?? "reported",
    written:
      !answer.finishReason.startsWith("error") &&
      answer.finishReason !== "aborted" &&
      !answer.flags.includes("blocked"),
    steps: answer.trace?.steps ?? [],
  };
}

/** Where `doc` sat in the core the answer read, and which matched words lay past the cut. */
function place(
  scene: Scene,
  doc: CorpusDocument,
  matches: readonly (string | undefined)[],
): Pick<Located, "position" | "pastCut" | "held" | "length"> {
  const length = doc.text.length;
  if (scene.handles.has(doc.id)) return { position: "handle", pastCut: [], held: 0, length };
  const held = heldText(doc, scene.layout);
  if (held.length >= length) return { position: "whole", pastCut: [], held: length, length };
  const before = vocabularyOf(`${doc.title}\n${held}`);
  const after = vocabularyOf(doc.text.slice(held.length));
  const pastCut: string[] = [];
  let matched = 0;
  scene.words.forEach((word, i) => {
    if (matches[i] === undefined) return;
    matched++;
    const later = matchIn(before, word) === undefined ? matchIn(after, word) : undefined;
    if (later !== undefined && !pastCut.includes(later)) pastCut.push(later);
  });
  if (!matched) return { position: "clipped", pastCut: [], held: held.length, length };
  return { position: pastCut.length ? "rest" : "held", pastCut, held: held.length, length };
}

interface Search {
  located: Located | null;
  /** The best document looked at, when none held enough. */
  closest: { id: string; share: number; words: string[] } | null;
}

/** The fact's document: the first of the search's ranking holding 60 % of the word weight. */
function findFact(scene: Scene, indexed: readonly Indexed[], search: CorpusSearch): Search {
  const byId = new Map(indexed.map((d) => [d.doc.id, d]));
  const candidates: Indexed[] = [];
  for (const chunk of search.rank(scene.words.join(" "), undefined, scene.reading)) {
    const d = byId.get(chunk.slice(0, chunk.lastIndexOf("#")));
    if (!d || candidates.includes(d)) continue;
    candidates.push(d);
    if (candidates.length === CANDIDATES) break;
  }
  const weights = weightsOf(scene.words, indexed);
  let closest: Search["closest"] = null;
  for (const d of candidates) {
    const coverage = coverageOf(d, scene.words, weights);
    const words = coverage.matches.filter((m): m is string => m !== undefined);
    if (coverage.share >= LOCATED_SHARE) {
      return {
        located: {
          id: d.doc.id,
          named: false,
          coverage: coverage.share,
          words,
          ...place(scene, d.doc, coverage.matches),
        },
        closest: null,
      };
    }
    if (!closest || coverage.share > closest.share) {
      closest = { id: d.doc.id, share: coverage.share, words };
    }
  }
  return { located: null, closest };
}

function named(scene: Scene, id: string): Located | null {
  const doc = resolveRequested(scene.documents, id, scene.reading);
  if (!doc) return null;
  const d = scene.indexed.find((x) => x.doc.id === doc.id)!;
  const coverage = coverageOf(d, scene.words, scene.weights);
  return {
    id: doc.id,
    named: true,
    coverage: coverage.share,
    words: coverage.matches.filter((m): m is string => m !== undefined),
    ...place(scene, doc, coverage.matches),
  };
}

const wordList = (words: readonly string[]) => (words.length ? ` (${words.join(", ")})` : "");

/** H1, and the fact's place for the experiments after it. */
function locateFact(
  scene: Scene,
  input: DiagnosisInput,
  findings: Finding[],
  untested: string[],
): { located: Located | null; addedSince: string | null } {
  const n = scene.words.length;
  if (input.expected) {
    const located = named(scene, input.expected);
    if (located) {
      findings.push(
        finding(
          "content-missing",
          "locate",
          false,
          `Named as the document that holds the answer: ${located.id}, with ${located.words.length} of the question's ${n} content words${wordList(located.words)}`,
        ),
      );
      return { located, addedSince: null };
    }
  }
  if (!n) {
    untested.push("The question has no content words to look for.");
    return { located: null, addedSince: null };
  }

  const { located, closest } = findFact(scene, scene.indexed, scene.search);
  if (located) {
    findings.push(
      finding(
        "content-missing",
        "locate",
        false,
        `${located.id} holds ${located.words.length} of the question's ${n} content words${wordList(located.words)}, ${percent(located.coverage)} of their weight`,
      ),
    );
    return { located, addedSince: null };
  }
  findings.push(
    finding(
      "content-missing",
      "locate",
      true,
      closest?.words.length
        ? `No document holds most of the question's words: the closest, ${closest.id}, has ${closest.words.length} of ${n}${wordList(closest.words)}, ${percent(closest.share)} of their weight`
        : `No document holds any of the question's ${n} content words`,
    ),
  );
  return { located: null, addedSince: liveFact(scene, input, findings, untested) };
}

/** Whether today's corpus has what the answer's did not: the content may be in now. */
function liveFact(
  scene: Scene,
  input: DiagnosisInput,
  findings: Finding[],
  untested: string[],
): string | null {
  if (scene.corpus === "live") return null;
  if (!input.live) {
    untested.push("Today's corpus could not be read: nothing was compared with it.");
    return null;
  }
  const indexed = index(input.live);
  const { located } = findFact(scene, indexed, new CorpusSearch([...input.live]));
  if (!located) return null;
  findings.push(
    finding(
      "content-missing",
      "live",
      true,
      `Today's corpus has it: ${located.id} holds ${located.words.length} of the question's ${scene.words.length} content words${wordList(located.words)}; the answer's corpus did not`,
    ),
  );
  return located.id;
}

/** H3 (and H2): where the fact sat in the core the answer read. */
function positionFindings(scene: Scene, located: Located): Finding[] {
  const { id, held, length } = located;
  const cut = `The core held ${id} cut at ${count(held)} of ${count(length)} characters`;
  const inContext = finding(
    "retrieval-miss",
    "position",
    false,
    `Nothing had to be retrieved: ${id} was in context`,
  );
  switch (located.position) {
    case "handle":
      return [
        finding(
          "context-unused",
          "position",
          true,
          `${id} was one line in the ${LANGUAGE[scene.reading]} core (a handle): its text was one get_document away`,
        ),
      ];
    case "whole":
      return [
        finding(
          "context-unused",
          "position",
          true,
          `The core held ${id} whole: its text was in context`,
        ),
        inContext,
      ];
    case "held":
      return [
        finding(
          "context-unused",
          "position",
          true,
          `${cut}, with the matching words before the cut`,
        ),
        inContext,
      ];
    case "rest": {
      const verb = plural(located.pastCut.length, "lies", "lie");
      return [
        finding(
          "context-unused",
          "position",
          true,
          `${cut}; ${located.pastCut.join(", ")} ${verb} past the cut`,
        ),
      ];
    }
    case "clipped":
      return [finding("context-unused", "position", true, cut)];
  }
}

/** The steps' calls of a tool, numbered from 1. */
function calls(scene: Scene, names: readonly string[]) {
  return scene.steps.flatMap((step, i) =>
    step.tools.filter((t) => names.includes(t.name)).map((tool) => ({ tool, step: i + 1 })),
  );
}

/** Whether a `get_document` or `get_resume` call read the located document. */
function readsIt(scene: Scene, tool: { name: string; input: string }, located: Located): boolean {
  if (tool.name === "get_resume") {
    const doc = scene.documents.find((d) => d.id === located.id);
    return doc?.kind === "cv";
  }
  const raw = requestedId(tool.input);
  const doc = raw ? resolveRequested(scene.documents, raw, scene.reading) : undefined;
  return !!doc && sameDocument(doc.id, located.id);
}

interface Fetches {
  /** The step that fetched it, if one did. */
  read?: { step: number };
  /** The step whose fetch of it the answer's document budget refused. */
  refused?: { step: number };
}

/** Whether, and where, the answer fetched the fact's document. */
function fetchesOf(scene: Scene, located: Located): Fetches {
  const fetches = calls(scene, ["get_document", "get_resume"]).filter(({ tool }) =>
    readsIt(scene, tool, located),
  );
  return {
    read: fetches.find(({ tool }) => tool.outcome === "ok"),
    refused: fetches.find(({ tool }) => tool.outcome === "budget_exhausted"),
  };
}

/** H3 and H2: whether the answer fetched the fact's document. */
function readFindings(located: Located, { read, refused }: Fetches): Finding[] {
  if (read) {
    return [
      finding(
        "context-unused",
        "reads",
        true,
        `It fetched ${located.id} (step ${read.step}): the whole text was in context`,
      ),
      finding("retrieval-miss", "reads", false, `It fetched ${located.id}: retrieval reached it`),
    ];
  }
  if (refused) {
    return [
      finding(
        "context-unused",
        "reads",
        true,
        `Its fetch of ${located.id} was refused (step ${refused.step}): the answer's document budget was spent`,
      ),
    ];
  }
  if (located.position === "whole" || located.position === "held") return [];
  return [finding("context-unused", "reads", true, `It never fetched ${located.id}`)];
}

/** H2: what the answer's own searches returned, and what the question's words would. */
function searchFindings(scene: Scene, located: Located, untested: string[]): Finding[] {
  const found: Finding[] = [];
  const searches = calls(scene, ["search_portfolio"]);
  const withHits = searches.filter(({ tool }) => tool.hits);
  if (searches.length && !withHits.length) {
    untested.push("Its trace keeps no search hits (an answer from before plan phase 18).");
  }
  const hit = withHits
    .map(({ tool, step }) => ({
      step,
      rank: tool.hits!.findIndex((id) => sameDocument(id, located.id)),
    }))
    .find(({ rank }) => rank >= 0);
  if (hit) {
    found.push(
      finding(
        "retrieval-miss",
        "searches",
        false,
        `Its search (step ${hit.step}) returned ${located.id} at rank ${hit.rank + 1}`,
      ),
    );
    return found;
  }
  if (withHits.length) {
    const documents = new Set(withHits.flatMap(({ tool }) => tool.hits!)).size;
    found.push(
      finding(
        "retrieval-miss",
        "searches",
        true,
        `Its ${withHits.length} ${plural(withHits.length, "search", "searches")} returned ${documents} ${plural(documents, "document", "documents")}, never ${located.id}`,
      ),
    );
  }
  if (!scene.words.length) return found;

  const hits = scene.search.search(scene.words.join(" "), { locale: scene.reading });
  const rank = hits.findIndex((h) => sameDocument(h.id, located.id));
  const doc = scene.documents.find((d) => d.id === located.id);
  if (rank < 0) {
    const other =
      doc && doc.locale !== scene.reading
        ? ` (the search prefers ${LANGUAGE[scene.reading]} documents)`
        : "";
    found.push(
      finding(
        "retrieval-miss",
        "question-search",
        true,
        `A search for the question's words does not return ${located.id}${other}`,
      ),
    );
  } else if (!searches.length) {
    found.push(
      finding(
        "retrieval-miss",
        "question-search",
        false,
        `A search for the question's words returns ${located.id} at rank ${rank + 1}: a search would have found it`,
      ),
    );
  } else if (withHits.length) {
    found.push(
      finding(
        "retrieval-miss",
        "question-search",
        true,
        `A search for the question's words returns ${located.id} at rank ${rank + 1}; its own queries did not`,
      ),
    );
  }
  return found;
}

const FELL_SHORT: Partial<Record<Category, string>> = {
  unknown: "said it isn't there",
  unfaithful: "was judged unfaithful",
  "thumbs-down": "got a thumbs-down",
  rephrased: "was asked again",
};

/** "Almost working": the right document cited, the answer still wrong. */
function citationFindings(scene: Scene, located: Located): Finding[] {
  if (!CONTENT_SYMPTOMS.has(scene.category)) return [];
  if (!scene.answer.citedIds.some((id) => sameDocument(id, located.id))) return [];
  const observation = `It cited ${located.id}, the document that holds the answer, and still ${FELL_SHORT[scene.category] ?? "fell short"}`;
  return [
    finding("content-missing", "citation", false, observation),
    finding("retrieval-miss", "citation", false, observation),
    finding("context-unused", "citation", true, observation),
  ];
}

/**
 * "Almost working" with the fact not placed: the answer cited a document it
 * read only in part (the core cut it short, or held it as a one-line handle,
 * and the answer never fetched it). The fact may sit in the part it never
 * read, which is evidence for clipped context, and leaves the fact's absence
 * unproven. A document the core held whole proves nothing either way.
 */
function partialReads(scene: Scene): { findings: Finding[]; partial: Located | null } {
  if (!CONTENT_SYMPTOMS.has(scene.category)) return { findings: [], partial: null };
  for (const cited of scene.answer.citedIds) {
    const doc = resolveRequested(scene.documents, cited, scene.reading);
    if (!doc) continue;
    const placed = place(scene, doc, []);
    if (placed.position === "whole") continue;
    const partial: Located = { id: doc.id, named: false, coverage: 0, words: [], ...placed };
    if (fetchesOf(scene, partial).read) continue;
    const read =
      placed.position === "handle"
        ? "had only its one-line handle"
        : `read only its first ${count(placed.held)} of ${count(placed.length)} characters`;
    const observation = `It cited ${doc.id} but ${read}, and never fetched the rest`;
    return {
      partial,
      findings: [
        finding("context-unused", "partial-reads", true, observation),
        finding(
          "content-missing",
          "partial-reads",
          false,
          `${observation}: the fact's absence is not established`,
        ),
      ],
    };
  }
  return { findings: [], partial: null };
}

function passedOverText(step: TraceStep): string {
  return step.passedOver.map((p) => `${p.model} (${p.outcome})`).join(", ");
}

/** H4: who answered, and whether the model's own output gave it away. */
function modelFindings(scene: Scene): Finding[] {
  const { answer, steps } = scene;
  const found: Finding[] = [];
  if (steps.length) {
    steps.forEach((step, i) => {
      if (step.model && step.passedOver.length) {
        found.push(
          finding(
            "degraded-model",
            "model",
            true,
            `Step ${i + 1}: ${passedOverText(step)} passed over; ${step.model} answered`,
          ),
        );
      }
    });
    const answerOnly = steps.find((s) => s.model && s.answerOnly);
    if (answerOnly) {
      found.push(
        finding(
          "degraded-model",
          "model",
          true,
          `An answer-only model answered (${answerOnly.model}, no tools)`,
        ),
      );
    }
  } else {
    const passed = answer.attempts.filter((a) => a.outcome !== "ok");
    if (passed.length && answer.model) {
      const skipped = passed.map((a) => `${a.model} (${a.outcome})`).join(", ");
      found.push(
        finding(
          "degraded-model",
          "model",
          true,
          `${skipped} passed over; ${answer.model} answered`,
        ),
      );
    } else if (answer.flags.includes("degraded")) {
      found.push(
        finding(
          "degraded-model",
          "model",
          true,
          "Flagged degraded: a fallback or an answer-only model answered",
        ),
      );
    }
  }
  if (answer.flags.includes("empty")) {
    found.push(finding("degraded-model", "model", true, "Flagged empty: no words and no action"));
  }
  if (answer.flags.includes("invented-citation")) {
    found.push(
      finding(
        "degraded-model",
        "model",
        true,
        "It cited a document that does not exist (removed before the visitor saw it)",
      ),
    );
  }
  const answered = steps.length ? steps.every((s) => s.model !== null) : answer.model !== null;
  if (!found.length && answered && answer.model && (steps.length || answer.attempts.length)) {
    found.push(
      finding(
        "degraded-model",
        "model",
        false,
        `The chain's first model, ${answer.model}, answered every step`,
      ),
    );
  }
  return found;
}

/** Whether `doc` has no version in the language the answer was in. */
function onlyInOtherLanguage(scene: Scene, doc: CorpusDocument): boolean {
  return (
    doc.locale !== scene.reading &&
    !scene.documents.some((d) => d.locale === scene.reading && sameDocument(d.id, doc.id))
  );
}

/** H5: the language the answer was in, and the language the fact is in. */
function languageFindings(scene: Scene, located: Located | null): Finding[] {
  const found: Finding[] = [];
  if (scene.answer.flags.includes("language")) {
    found.push(
      finding(
        "language",
        "language",
        true,
        "Flagged language: the answer was not in the visitor's language",
      ),
    );
  }
  // Only for an answer that was written: one that failed says nothing about its language.
  const doc = located && scene.written && scene.documents.find((d) => d.id === located.id);
  if (doc && onlyInOtherLanguage(scene, doc)) {
    found.push(
      finding(
        "language",
        "language",
        true,
        `${doc.id} exists only in ${LANGUAGE[doc.locale]}; the answer was in ${LANGUAGE[scene.reading]}`,
      ),
    );
  }
  if (!found.length && scene.answer.checked && scene.written) {
    found.push(
      finding(
        "language",
        "language",
        false,
        "The answer was in the visitor's language (no language flag)",
      ),
    );
  }
  return found;
}

const SIGNAL_TEXT: Record<string, string> = {
  uncited: "flagged uncited",
  empty: "flagged empty",
  "invented-citation": "flagged for an invented citation",
  "max-rounds": "out of rounds",
};

function escalationObservation(escalation?: { step: number; reason: string }): string {
  if (!escalation) return "It moved to the deep chain";
  return `It moved to the deep chain at step ${escalation.step + 1} (${escalation.reason})`;
}

function falseSimpleSignals(answer: DiagnosisAnswer): string[] {
  const signals: string[] = [];
  for (const f of answer.flags) {
    if ((UNDER_SERVED as readonly string[]).includes(f)) {
      signals.push(SIGNAL_TEXT[f]!);
    }
  }
  if (answer.feedback === -1) signals.push("a thumbs-down");
  if (answer.rephrased) signals.push("asked again");
  return signals;
}

/** H6: how the router sent it, and the signs that the lite route under-served it. */
function routingFindings(scene: Scene, projectNames: readonly string[]): Finding[] {
  const { answer } = scene;
  const trace = answer.trace;
  if (answer.route === "deep") {
    return [finding("under-routed", "routing", false, "The deep chain answered (route deep)")];
  }
  if (trace?.escalation || answer.route.includes("deep")) {
    return [finding("under-routed", "routing", false, escalationObservation(trace?.escalation))];
  }
  if (answer.route !== "lite") return [];

  const found: Finding[] = [];
  const decision = routeQuestion(answer.question, {
    forceDeep: false,
    deepAllowed: true,
    projectNames,
  });
  const reason = trace?.routing?.reason ?? decision.reason;
  if (trace?.routing?.reason.includes("deep-off")) {
    found.push(
      finding(
        "under-routed",
        "routing",
        true,
        `The router wanted the deep route (${reason}), but it was closed`,
      ),
    );
  } else if (!trace?.routing && decision.route === "deep") {
    found.push(
      finding(
        "under-routed",
        "routing",
        true,
        `Today's router sends it deep (${decision.reason}); it was answered lite`,
      ),
    );
  }
  const lookup = (trace?.routing ?? decision).lookup === true;
  const shortOnContent =
    CONTENT_SYMPTOMS.has(scene.category) ||
    (UNDER_SERVED as readonly string[]).includes(scene.category);
  if (lookup && shortOnContent) {
    found.push(
      finding(
        "under-routed",
        "routing",
        true,
        "Answered in the lookup tier, with minimal thinking",
      ),
    );
  }
  const signals = falseSimpleSignals(answer);
  if (signals.length) {
    found.push(
      finding(
        "under-routed",
        "routing",
        true,
        `A false-simple candidate: kept lite, then ${signals.join(", ")}`,
      ),
    );
  }
  if (!found.length) {
    found.push(
      finding(
        "under-routed",
        "routing",
        false,
        `Nothing in the question asked for the deep route (${reason})`,
      ),
    );
  }
  return found;
}

/** H7: whether the answer failed in the providers or the plumbing rather than in itself. */
function infrastructureFindings(scene: Scene): Finding[] {
  const { answer, steps } = scene;
  const found: Finding[] = [];
  const infra = (outcome: string) => INFRA_OUTCOMES.has(outcome);
  if (answer.finishReason.startsWith("error")) {
    found.push(
      finding("infrastructure", "infrastructure", true, `It finished with ${answer.finishReason}`),
    );
  }
  steps.forEach((step, i) => {
    if (step.model === null) {
      found.push(
        finding(
          "infrastructure",
          "infrastructure",
          true,
          `Step ${i + 1}: no model could answer (${passedOverText(step)})`,
        ),
      );
      return;
    }
    const failed = step.passedOver.filter((p) => infra(p.outcome));
    if (failed.length) {
      const failures = failed
        .map((p) => `${p.model} ${p.outcome} after ${count(p.ms)} ms`)
        .join("; ");
      found.push(finding("infrastructure", "infrastructure", true, `Step ${i + 1}: ${failures}`));
    }
  });
  if (!steps.length) {
    const failed = answer.attempts.filter((a) => infra(a.outcome));
    if (failed.length) {
      found.push(
        finding(
          "infrastructure",
          "infrastructure",
          true,
          failed.map((a) => `${a.model} ${a.outcome} after ${count(a.ms)} ms`).join("; "),
        ),
      );
    }
  }
  if (answer.flags.includes("blocked")) {
    found.push(
      finding("infrastructure", "infrastructure", true, "The provider's content filter stopped it"),
    );
  }
  if (answer.finishReason === "aborted") {
    if (answer.ttftMs === null) {
      found.push(
        finding(
          "infrastructure",
          "infrastructure",
          true,
          `The visitor left after ${count(answer.totalMs)} ms with no first token`,
        ),
      );
    } else if (answer.ttftMs > SLOW_FIRST_TOKEN_MS) {
      found.push(
        finding(
          "infrastructure",
          "infrastructure",
          true,
          `The first token took ${count(answer.ttftMs)} ms; the visitor left`,
        ),
      );
    }
  }
  if (answer.finishReason === "length") {
    found.push(
      finding("infrastructure", "infrastructure", true, "It stopped at the output token limit"),
    );
  }
  if (!found.length && scene.written) {
    found.push(
      finding(
        "infrastructure",
        "infrastructure",
        false,
        `Every step finished normally (${answer.finishReason})`,
      ),
    );
  }
  return found;
}

const succeeded = (r: ReplayResult, located: Located | null) =>
  r.answered && (located ? r.cited.some((id) => sameDocument(id, located.id)) : r.cited.length > 0);

/**
 * The replay's evidence: the question answered again on today's corpus by
 * each chain alone; a chain with no model answering is no evidence (noted).
 * The lite chain is the one visitors' answers start on, so it decides whether
 * the failure repeats: answering now, it points to a passing outage, or to
 * the content added since. The deep chain answering where the lite does not
 * points to the route. Both failing alike clears the model, the route and
 * the infrastructure. "Almost working" counts against: a chain that cites the
 * fact's document and still fails says the model was not the cause (and, the
 * deep chain, not the route either).
 */
export function replayFindings(
  replay: ReplayRecord,
  located: Located | null,
  addedSince: string | null,
  /** The chain that answered the visitor: deep for an answer routed or moved there. */
  visitorChain: ReplayResult["chain"] = "lite",
): { findings: Finding[]; untested: string[] } {
  const untested: string[] = [];
  const results = replay.results.filter((r) => {
    if (r.unavailable)
      untested.push(`The replay on the ${r.chain} chain found no model answering.`);
    return !r.unavailable;
  });
  const ok = (r: ReplayResult | undefined) => !!r && succeeded(r, located);
  const replayed: Replayed = {
    own: results.find((r) => r.chain === visitorChain),
    other: results.find((r) => r.chain !== visitorChain),
    visitorChain,
    ok,
  };
  return {
    findings: [
      ...almostAnswered(results, located, visitorChain, ok),
      ...repeated(replayed, addedSince, untested),
    ],
    untested,
  };
}

interface Replayed {
  /** The visitor's chain answering again, and the other chain. */
  own?: ReplayResult;
  other?: ReplayResult;
  visitorChain: ReplayResult["chain"];
  ok: (r: ReplayResult | undefined) => boolean;
}

/**
 * "Almost working" counts against: a chain that cites the fact's document and
 * still fails says the model was not the cause, and the deep chain, for an
 * answer routed lite, that the route was not either.
 */
function almostAnswered(
  results: readonly ReplayResult[],
  located: Located | null,
  visitorChain: ReplayResult["chain"],
  ok: Replayed["ok"],
): Finding[] {
  const found: Finding[] = [];
  for (const r of results) {
    if (!located || ok(r) || !r.cited.some((id) => sameDocument(id, located.id))) continue;
    const observation = `Replayed on the ${r.chain} chain, ${r.model ?? "a model"} cited ${located.id} and still ${r.unknown ? "said it isn't there" : "fell short"}`;
    found.push(
      finding("context-unused", "replay", true, observation),
      finding("degraded-model", "replay", false, observation),
    );
    if (r.chain === "deep" && visitorChain === "lite") {
      found.push(finding("under-routed", "replay", false, observation));
    }
  }
  return found;
}

/**
 * Whether the failure repeats, decided by the chain that answered the
 * visitor: answering now, a passing outage (or the content added since).
 * Failing again, the other chain tells the rest: on a lite answer, the deep
 * chain answering points to the route; on a deep answer, the lite chain
 * answering points to the model that answered.
 */
function notRepeatedFinding(who: string, addedSince: string | null): Finding {
  if (addedSince) {
    return finding(
      "content-missing",
      "replay",
      true,
      `Replayed today, ${who} it, now that ${addedSince} has it`,
    );
  }
  return finding(
    "infrastructure",
    "replay",
    true,
    `Replayed today, ${who} it: the failure did not repeat`,
  );
}

function otherSucceededFinding(
  own: ReplayResult,
  other: ReplayResult,
  visitorChain: ReplayResult["chain"],
): Finding[] {
  if (visitorChain === "lite") {
    return [
      finding(
        "under-routed",
        "replay",
        true,
        `Replayed today, the deep chain answers it (${other.model}); the lite chain does not (${own.model})`,
      ),
    ];
  }
  return [
    finding(
      "degraded-model",
      "replay",
      true,
      `Replayed today, the lite chain answers it (${other.model}); the deep chain, which answered the visitor, does not (${own.model})`,
    ),
  ];
}

function ownReplayed(
  { own, other, visitorChain, ok }: Replayed & { own: ReplayResult },
  addedSince: string | null,
): Finding[] {
  if (ok(own)) {
    const who = other && ok(other) ? "both chains answer" : `the ${own.chain} chain answers`;
    return [notRepeatedFinding(who, addedSince)];
  }
  if (other && ok(other)) {
    return otherSucceededFinding(own, other, visitorChain);
  }
  if (other) {
    const same = "Replayed today, both chains fail it";
    return [
      finding("degraded-model", "replay", false, `${same}: not the model`),
      ...(visitorChain === "lite"
        ? [finding("under-routed", "replay", false, `${same}: not the route`)]
        : []),
      finding("infrastructure", "replay", false, `${same}: not a passing outage`),
    ];
  }
  return [
    finding(
      "infrastructure",
      "replay",
      false,
      `Replayed today, the ${own.chain} chain fails it again: not a passing outage`,
    ),
  ];
}

function onlyOtherReplayed(
  other: ReplayResult,
  visitorChain: ReplayResult["chain"],
  ok: Replayed["ok"],
  untested: string[],
): Finding[] {
  if (visitorChain === "lite" && !ok(other)) {
    const too = "Replayed today, the deep chain fails it too";
    return [
      finding("degraded-model", "replay", false, `${too}: not the model`),
      finding("under-routed", "replay", false, `${too}: not the route`),
    ];
  }
  untested.push(
    visitorChain === "lite"
      ? "Only the deep chain answered the replay: with no lite answer to compare, it says nothing about the route."
      : "Only the lite chain answered the replay: the deep chain, which answered the visitor, had no model answering.",
  );
  return [];
}

/**
 * Whether the failure repeats, decided by the chain that answered the
 * visitor: answering now, a passing outage (or the content added since).
 * Failing again, the other chain tells the rest: on a lite answer, the deep
 * chain answering points to the route; on a deep answer, the lite chain
 * answering points to the model that answered.
 */
function repeated(replayed: Replayed, addedSince: string | null, untested: string[]): Finding[] {
  const { own, other, visitorChain, ok } = replayed;
  if (own) {
    return ownReplayed({ own, other, visitorChain, ok }, addedSince);
  }
  if (other) {
    return onlyOtherReplayed(other, visitorChain, ok, untested);
  }
  return [];
}

function rank(findings: readonly Finding[]): HypothesisResult[] {
  return HYPOTHESES.map((id, order) => {
    const evidence = findings.filter((f) => f.h === id).map((f) => f.e);
    const supporting = evidence.filter((e) => e.supports).length;
    return {
      order,
      result: {
        id,
        evidence,
        supporting,
        contradicting: evidence.length - supporting,
        ratio: evidence.length ? supporting / evidence.length : 0.5,
      },
    };
  })
    .sort(
      (a, b) =>
        b.result.ratio - a.result.ratio ||
        b.result.supporting - a.result.supporting ||
        a.order - b.order,
    )
    .map(({ result }) => result);
}

const HEURISTICS = {
  "content-missing":
    "When visitors ask for something the portfolio never says, the gap is content, not the assistant: answer it once in the FAQ or on a page, and keep the honest 'not in the portfolio' until then.",
  "retrieval-miss":
    "When the visitors' words differ from the document's, a word search misses it: put the common wording into the document, or search by meaning.",
  clipped:
    "A fact past a document's cut is one fetch away, and models rarely take it: keep what visitors ask about in a document's first part, or hold the document whole.",
  unused:
    "When the document is in context and the answer still misses it, the instructions are the problem: freeze the answer as a case and test the prompt change on it.",
  "degraded-model":
    "A fallback model answers worse than the first choice: judge a failure by the model that wrote it, and fix the chain before the content.",
  translate:
    "A fact published in one language only is half-published: translate the documents visitors ask about.",
  language:
    "An answer in the wrong language fails the visitor whatever it says: test the language instruction on the frozen case before changing content.",
  "under-routed":
    "Under-serving a hard question costs more than over-serving an easy one: when a lite answer fails on a question the deep chain answers, route that kind of question deep.",
  infrastructure:
    "An answer that failed in the infrastructure says nothing about the content: retry, and look at the providers, before changing anything else.",
} as const;

/** The first model that failed in the infrastructure, else the one that answered. */
function failingModel(scene: Scene): string | null {
  for (const step of scene.steps) {
    const failed = step.passedOver.find((p) => INFRA_OUTCOMES.has(p.outcome));
    if (failed) return failed.model;
  }
  return (
    scene.answer.attempts.find((a) => INFRA_OUTCOMES.has(a.outcome))?.model ?? scene.answer.model
  );
}

function propose(
  scene: Scene,
  leading: HypothesisResult | null,
  located: Located | null,
  addedSince: string | null,
  fetched: boolean,
  /** A cited document read only in part, when the fact was not placed. */
  partial: Located | null,
): Proposal {
  if (!leading) return { rootCause: "", fixType: null, fix: "", fixRef: null, heuristic: "" };
  const evidence = leading.evidence.filter((e) => e.supports).map((e) => e.observation);
  const cause = `${HYPOTHESIS_TITLES[leading.id]}: ${evidence.join("; ")}.`;
  const rootCause =
    cause.length > ROOT_CAUSE_CHARS ? `${cause.slice(0, ROOT_CAUSE_CHARS - 1)}…` : cause;
  const id = located?.id ?? null;
  const reading = LANGUAGE[scene.reading];

  switch (leading.id) {
    case "content-missing":
      return {
        rootCause,
        fixType: "faq",
        fix: addedSince
          ? `Already added since: ${addedSince} has it in today's corpus. Freeze the answer as a case so it stays answered.`
          : "Add an FAQ entry (or a page) that answers it.",
        fixRef: addedSince,
        heuristic: HEURISTICS["content-missing"],
      };
    case "retrieval-miss":
      return {
        rootCause,
        fixType: "retrieval",
        fix: `Turn on search by meaning (Settings → Spending), or add the visitors' wording to ${id ?? "the document"}.`,
        fixRef: id,
        heuristic: HEURISTICS["retrieval-miss"],
      };
    case "context-unused": {
      const where = located ?? partial;
      const clipped = !!where && !fetched && ["rest", "clipped", "handle"].includes(where.position);
      if (clipped && where.position === "handle") {
        return {
          rootCause,
          fixType: "content",
          fix: `Promote ${where.id} (Overview → Perception holds it whole), or make sure its ${reading} version says it too.`,
          fixRef: where.id,
          heuristic: HEURISTICS.clipped,
        };
      }
      if (clipped) {
        return {
          rootCause,
          fixType: "content",
          fix: `Promote ${where.id} (Overview → Perception holds it whole), or move the fact before the cut at ${count(where.held)} characters.`,
          fixRef: where.id,
          heuristic: HEURISTICS.clipped,
        };
      }
      return {
        rootCause,
        fixType: "prompt",
        fix: "Freeze the answer as an eval case and test a prompt change on it (the eval gate decides).",
        fixRef: null,
        heuristic: HEURISTICS.unused,
      };
    }
    case "degraded-model":
      return {
        rootCause,
        fixType: "model",
        fix: `Look at the chain and its fallbacks (Settings, Trust): ${scene.answer.model ?? "no model"} answered instead of the first choice.`,
        fixRef: scene.answer.model,
        heuristic: HEURISTICS["degraded-model"],
      };
    case "language": {
      const doc = located && scene.documents.find((d) => d.id === located.id);
      if (doc && onlyInOtherLanguage(scene, doc)) {
        return {
          rootCause,
          fixType: "content",
          fix: `Translate ${doc.id} into ${reading}.`,
          fixRef: doc.id,
          heuristic: HEURISTICS.translate,
        };
      }
      return {
        rootCause,
        fixType: "prompt",
        fix: "Freeze the answer as an eval case and test the language instruction on it.",
        fixRef: null,
        heuristic: HEURISTICS.language,
      };
    }
    case "under-routed":
      return {
        rootCause,
        fixType: "routing",
        fix: "Freeze the answer as a case and replay it on the deep chain (`--suite production --on deep`); if deep answers, widen the router's deep patterns.",
        fixRef: null,
        heuristic: HEURISTICS["under-routed"],
      };
    case "infrastructure":
      return {
        rootCause,
        fixType: "infra",
        fix: "Check the providers (Overview: fallbacks; Trust: alerts), the timeouts and the quota, and retry before changing anything.",
        fixRef: failingModel(scene),
        heuristic: HEURISTICS.infrastructure,
      };
  }
}

const REPLAY_TESTS = new Set<HypothesisId>(["degraded-model", "under-routed", "infrastructure"]);

/** The loop's revise step: what would separate the leading hypotheses. */
function nextSteps(
  scene: Scene,
  ranked: readonly HypothesisResult[],
  leading: HypothesisResult | null,
  located: Located | null,
  replayed: boolean,
): string[] {
  const next: string[] = [];
  if (!located && scene.words.length) {
    next.push(
      "Nothing in the corpus holds most of the question's words. If the portfolio says it in other words, name the document that holds it and diagnose again: a word search cannot tell a gap from a synonym.",
    );
  }
  const [first, second] = ranked;
  const level =
    !!first &&
    !!second &&
    first.ratio > 0.5 &&
    first.ratio === second.ratio &&
    first.supporting === second.supporting;
  if (level) {
    next.push(
      `${HYPOTHESIS_TITLES[first.id]} and ${HYPOTHESIS_TITLES[second.id]} are level: the evidence does not separate them yet.`,
    );
  }
  if (!leading) {
    next.push(
      "No hypothesis has more evidence for than against: name the document that holds the answer, or replay it.",
    );
  }
  const close = ranked.filter((h) => h.supporting > 0 && first && first.ratio - h.ratio <= 0.1);
  if (!replayed && (!leading || close.some((h) => REPLAY_TESTS.has(h.id)))) {
    next.push("Replay it on both chains (paid) to test the model, the route and a passing outage.");
  }
  return next;
}

/**
 * H1–H3, on how the answer used the corpus: where the fact sat, whether the
 * answer fetched and searched for it, and whether it cited it; with the fact
 * not placed, a cited document it read only in part. None of it applies to an
 * answer that was not written. Returns that partly read document, if any.
 */
function useOfCorpus(
  scene: Scene,
  located: Located | null,
  fetches: Fetches,
  findings: Finding[],
  untested: string[],
): Located | null {
  if (!scene.written) {
    if (located) {
      untested.push(
        `The answer was not written (${scene.answer.finishReason}): the experiments on its use of the corpus do not apply.`,
      );
    }
    return null;
  }
  if (!located) {
    if (!scene.answer.trace) return null;
    const reads = partialReads(scene);
    findings.push(...reads.findings);
    return reads.partial;
  }
  findings.push(...positionFindings(scene, located));
  if (scene.answer.trace) findings.push(...readFindings(located, fetches));
  // Searching mattered only for a fact the core did not hold.
  const inContext = located.position === "whole" || located.position === "held";
  if (scene.answer.trace && !inContext) findings.push(...searchFindings(scene, located, untested));
  findings.push(...citationFindings(scene, located));
  return null;
}

/** Observe, hypothesize, experiment, analyze, revise: the diagnosis of one answer. */
export function diagnose(input: DiagnosisInput): JournalDiagnosis {
  const scene = observe(input);
  const findings: Finding[] = [];
  const untested: string[] = [];
  if (scene.corpus === "live") {
    untested.push("The answer's corpus was not kept: the experiments read today's corpus.");
  }
  if (!input.answer.trace) {
    untested.push(
      "No trace (an answer from before traces were kept): the experiments on its steps could not run.",
    );
  }

  const { located, addedSince } = locateFact(scene, input, findings, untested);
  const fetches = located && input.answer.trace ? fetchesOf(scene, located) : {};
  const partial = useOfCorpus(scene, located, fetches, findings, untested);
  findings.push(
    ...modelFindings(scene),
    ...languageFindings(scene, located),
    ...routingFindings(scene, input.projectNames),
    ...infrastructureFindings(scene),
  );
  if (input.replay) {
    // The chain that answered the visitor: the deep one for an answer routed or moved there.
    const visitorChain = input.answer.route.includes("deep") ? "deep" : "lite";
    const replay = replayFindings(input.replay, located, addedSince, visitorChain);
    findings.push(...replay.findings);
    untested.push(...replay.untested);
  }

  const hypotheses = rank(findings);
  const top = hypotheses[0]!;
  const leading = top.ratio > 0.5 && top.supporting > 0 ? top : null;
  const trace = input.answer.trace;
  return {
    v: 1,
    symptoms: scene.symptoms,
    context: {
      locale: input.answer.locale,
      reading: scene.reading,
      layout: scene.layout,
      route: input.answer.route,
      model: input.answer.model,
      finishReason: input.answer.finishReason,
      steps: trace?.steps.length ?? 0,
      tools: [...input.answer.toolCalls],
      corpusKey: input.answer.corpusKey,
      corpus: scene.corpus,
      promptVersion: input.answer.promptVersion,
      traced: !!trace,
    },
    located,
    addedSince,
    hypotheses,
    leading: leading?.id ?? null,
    untested,
    next: nextSteps(scene, hypotheses, leading, located, !!input.replay),
    proposal: propose(scene, leading, located, addedSince, !!fetches.read, partial),
    replayed: !!input.replay,
  };
}

/** The entry's category: the diagnosis's first symptom, or the admin's own call. */
export function categoryOf(diagnosis: Pick<JournalDiagnosis, "symptoms">): Category {
  return diagnosis.symptoms[0] ?? "reported";
}

/**
 * Where an entry may go from each status: accepted once the admin agrees,
 * fixed once the fix is linked, retired when it no longer holds; a retired
 * entry can be reopened.
 */
export const TRANSITIONS: Record<JournalStatus, readonly JournalStatus[]> = {
  proposed: ["accepted", "retired"],
  accepted: ["fixed", "retired"],
  fixed: ["retired"],
  retired: ["proposed"],
};

/** "Be careful" is not a lesson: a heuristic says when and why, in this many words or more. */
export const HEURISTIC_MIN_WORDS = 8;

export interface DecidedFields {
  rootCause: string;
  heuristic: string;
  fixType: FixType | null;
  fixRef: string | null;
  caseId: string | null;
}

/**
 * Why an entry cannot stand as accepted or fixed: a root cause and a
 * heuristic to accept, and a fix (its type, and what it is or the case that
 * tests it) to call it fixed. Null when it can, or for another status.
 */
export function decisionProblem(
  status: JournalStatus,
  fields: DecidedFields,
): "missing_root_cause" | "vague_heuristic" | "missing_fix" | null {
  if (status !== "accepted" && status !== "fixed") return null;
  if (!fields.rootCause.trim()) return "missing_root_cause";
  if (fields.heuristic.trim().split(/\s+/).filter(Boolean).length < HEURISTIC_MIN_WORDS) {
    return "vague_heuristic";
  }
  if (status === "fixed" && (!fields.fixType || (!fields.fixRef?.trim() && !fields.caseId))) {
    return "missing_fix";
  }
  return null;
}

/** One chain's answer as the replay keeps it: the outcome, never the text. */
export function replayResultOf(
  chain: ReplayResult["chain"],
  outcome: {
    text: string;
    finishReason: string;
    citedIds: readonly string[];
    toolNames: readonly string[];
    model: string | null;
    flags: readonly string[];
    usd: number;
  },
  unavailable: boolean,
): ReplayResult {
  const unknown = NOT_THERE.test(outcome.text);
  const failed = outcome.finishReason.startsWith("error") || outcome.finishReason === "aborted";
  const acted = outcome.toolNames.some((n) => n === "navigate" || n === "handoff_contact");
  return {
    chain,
    model: outcome.model,
    finishReason: outcome.finishReason,
    answered: !unavailable && !failed && !unknown && (!!outcome.text.trim() || acted),
    unknown,
    cited: [...outcome.citedIds],
    flags: [...outcome.flags],
    usd: outcome.usd,
    unavailable,
  };
}
