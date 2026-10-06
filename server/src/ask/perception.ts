import type { Locale } from "../content/schema.js";
import type { CorpusDocument } from "./corpus/build.js";
import {
  baseId,
  coreLimit,
  coreView,
  MAX_DEMOTED,
  MAX_PROMOTED,
  type CoreLayout,
  type CorpusTiers,
} from "./corpus/render.js";
import { capsOf } from "./models/registry.js";
import type { AnswerTrace } from "./trace.js";

/**
 * Perception, measured (plan phase 16): what the assistant was given to read
 * and what it did with it. The book's three signals: the re-read ratio (a
 * `get_document` for a document the core already held whole), tokens per
 * good outcome, and placement; plus the cached share, split into an answer's
 * first step and its later ones (which re-send the same prefix seconds
 * later), and how often each document is fetched and cited. Each measure is
 * also split by the layout the answer read (one core with both languages
 * before plan phase 16, a core per language after), so before and after
 * compare in one window. Pure: the admin route loads the rows and the
 * snapshots they name, and works out `helpful`; ids, counts, tokens and
 * dollars only.
 */

/** One visitor answer, as the measures read it. */
export interface PerceptionRow {
  id: string;
  /** The page's locale. */
  locale: Locale;
  tokens: { input: number; output: number };
  usd: number;
  citedIds: readonly string[];
  trace: AnswerTrace | null;
  /** The snapshot key of the corpus it read; null before snapshots. */
  corpusKey: string | null;
  /** outcomes.ts's helpful, worked out by the route. */
  helpful: boolean;
}

/**
 * How a fetched document sat in the core the answer read: `whole` (a re-read:
 * the core had all of it), `rest` (the core held it cut short), `handle` (a
 * line in the other language's list), `unknown` (no snapshot to tell, or an id
 * the snapshot has no document for).
 */
export type FetchKind = "whole" | "rest" | "handle" | "unknown";

export interface StepCache {
  steps: number;
  input: number;
  cached: number;
  /** Steps with any cached tokens at all. */
  hits: number;
}

export interface DocumentAccess {
  id: string;
  /** Answers that fetched it with `get_document`. */
  fetched: number;
  /** Answers that cited it. */
  cited: number;
}

/** The measures over a set of answers. */
export interface PerceptionSlice {
  answers: number;
  cache: { first: StepCache; later: StepCache };
  fetches: Record<FetchKind, number>;
  /** whole / (whole + rest + handle); null with nothing classified. */
  rereadRatio: number | null;
  tokens: {
    input: number;
    output: number;
    inputPerAnswer: number | null;
    helpful: number;
    /** (input + output) / helpful answers: tokens per good outcome. */
    perHelpful: number | null;
  };
  /** Dollars per answer, as logged. */
  usdPerAnswer: number | null;
}

export interface Perception extends PerceptionSlice {
  /** The same measures for the answers that read each layout: before (`both`) and after (`locale`). */
  byLayout: Record<CoreLayout, PerceptionSlice>;
  /** Answers by the page's locale and the language their core was in (null: from before). */
  localeMix: { page: Locale; reading: Locale | null; answers: number }[];
  documents: DocumentAccess[];
  /**
   * Search → cited (plan phase 18): answers that searched, and those that cited a
   * document a search returned; by meaning too (`semantic`) or BM25 alone.
   */
  search: Record<"semantic" | "words", { answers: number; converted: number }>;
}

/** The healthy re-read ratio's ceiling, a heuristic from the book (tunable). */
export const REREAD_HEALTHY = 0.05;

const emptyCache = (): StepCache => ({ steps: 0, input: 0, cached: 0, hits: 0 });

interface Tally {
  answers: number;
  cache: { first: StepCache; later: StepCache };
  fetches: Record<FetchKind, number>;
  input: number;
  output: number;
  helpful: number;
  usd: number;
}

const newTally = (): Tally => ({
  answers: 0,
  cache: { first: emptyCache(), later: emptyCache() },
  fetches: { whole: 0, rest: 0, handle: 0, unknown: 0 },
  input: 0,
  output: 0,
  helpful: 0,
  usd: 0,
});

function slice(t: Tally): PerceptionSlice {
  const classified = t.fetches.whole + t.fetches.rest + t.fetches.handle;
  return {
    answers: t.answers,
    cache: t.cache,
    fetches: t.fetches,
    rereadRatio: classified ? t.fetches.whole / classified : null,
    tokens: {
      input: t.input,
      output: t.output,
      inputPerAnswer: t.answers ? t.input / t.answers : null,
      helpful: t.helpful,
      perHelpful: t.helpful ? (t.input + t.output) / t.helpful : null,
    },
    usdPerAnswer: t.answers ? t.usd / t.answers : null,
  };
}

/** The id a `get_document` call asked for, from the trace's redacted input. */
export function requestedId(input: string): string | null {
  try {
    const parsed = JSON.parse(input) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    // Cut at 300 characters: the id comes first, so read it as text.
    return /"id":"([^"]{1,160})"/.exec(input)?.[1] ?? null;
  }
}

/** What the trace's redaction (log.ts) leaves of a run of seven or more digits. */
const REDACTED_NUMBER = "[number]";
const escapeRegex = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** The document a request names, as `get_document` resolves it: exact, the reading language, the other. */
export function resolveRequested(
  documents: readonly CorpusDocument[],
  raw: string,
  reading: Locale,
): CorpusDocument | undefined {
  const other = reading === "en" ? "de" : "en";
  if (!raw.includes(REDACTED_NUMBER)) {
    const id = raw.trim().replace(/^\[\^?|\]$/g, "");
    const base = baseId(id);
    return (
      documents.find((d) => d.id === id) ??
      documents.find((d) => d.id === `${base}@${reading}`) ??
      documents.find((d) => d.id === `${base}@${other}`)
    );
  }
  // A long digit run in the id (a UUID's tail) was redacted: match it back, if only one fits.
  const id = raw.trim();
  const wanted = /@(en|de)$/.exec(id)?.[1] as Locale | undefined;
  const matches = documents.filter((d) => namesDocument(id, d.id));
  for (const locale of [wanted ?? reading, wanted ? null : other]) {
    const inLocale = matches.filter((d) => d.locale === locale);
    if (inLocale.length === 1) return inLocale[0];
  }
  return undefined;
}

/**
 * Whether a requested id, as the trace keeps it (a long digit run redacted),
 * names the document `id`, in either language.
 */
export function namesDocument(requested: string, id: string): boolean {
  const raw = requested.trim();
  // Not unbracketed when redacted: the `]` would be the redaction's own.
  if (!raw.includes(REDACTED_NUMBER)) return baseId(raw.replace(/^\[\^?|\]$/g, "")) === baseId(id);
  const digits = String.raw`[\d\s()./-]+`;
  const pattern = escapeRegex(baseId(raw)).replaceAll(escapeRegex(REDACTED_NUMBER), digits);
  return new RegExp(`^${pattern}$`).test(baseId(id));
}

/** Where `doc` sat in the core read in `reading`, laid out as `layout`. */
export function fetchKind(
  documents: readonly CorpusDocument[],
  doc: CorpusDocument,
  reading: Locale,
  layout: CoreLayout,
): Exclude<FetchKind, "unknown"> {
  if (coreView(documents, reading, layout).handles.some((d) => d.id === doc.id)) return "handle";
  const limit = coreLimit(doc, layout);
  return limit !== undefined && doc.text.length > limit ? "rest" : "whole";
}

type SearchSides = Record<"semantic" | "words", { answers: number; converted: number }>;
type MixEntry = { page: Locale; reading: Locale | null; answers: number };

interface PerceptionAccum {
  overall: Tally;
  byLayout: Record<CoreLayout, Tally>;
  fetchedBy: Map<string, Set<string>>;
  citedBy: Map<string, Set<string>>;
  mix: Map<string, MixEntry>;
  search: SearchSides;
}

function noteAccess(map: Map<string, Set<string>>, id: string, answer: string): void {
  const set = map.get(id) ?? new Set<string>();
  set.add(answer);
  map.set(id, set);
}

function addRowToTallies(tallies: readonly Tally[], row: PerceptionRow): void {
  for (const t of tallies) {
    t.answers++;
    t.input += row.tokens.input;
    t.output += row.tokens.output;
    t.usd += row.usd;
    if (row.helpful) t.helpful++;
  }
}

function tallyCacheSteps(tallies: readonly Tally[], row: PerceptionRow): void {
  const steps = (row.trace?.steps ?? []).filter((s) => s.model !== null);
  for (const [i, step] of steps.entries()) {
    if (!step.tokens || !capsOf(step.model!).caching) continue;
    for (const t of tallies) {
      const bucket = i === 0 ? t.cache.first : t.cache.later;
      bucket.steps++;
      bucket.input += step.tokens.input;
      bucket.cached += step.tokens.cached;
      if (step.tokens.cached > 0) bucket.hits++;
    }
  }
}

/** An answer searched by meaning if any of its searches did; it converted if it cited a hit. */
function tallySearchConversion(search: SearchSides, row: PerceptionRow): void {
  const searches = (row.trace?.steps ?? []).flatMap((s) =>
    s.tools.filter((t) => t.name === "search_portfolio" && t.hits),
  );
  if (!searches.length) return;
  const side = searches.some((t) => t.semantic) ? search.semantic : search.words;
  side.answers++;
  const cited = new Set(row.citedIds);
  if (searches.some((t) => t.hits!.some((id) => cited.has(id)))) side.converted++;
}

function classifyFetch(
  tool: { name: string; outcome?: string; input: string },
  documents: readonly CorpusDocument[] | undefined,
  readIn: Locale,
  layout: CoreLayout,
): { kind: FetchKind; id: string | null } | null {
  if (tool.name !== "get_document" || tool.outcome !== "ok") return null;
  const raw = requestedId(tool.input);
  const doc = raw && documents ? resolveRequested(documents, raw, readIn) : undefined;
  return {
    kind: doc && documents ? fetchKind(documents, doc, readIn, layout) : "unknown",
    id: doc?.id ?? raw,
  };
}

function tallyDocumentFetches(
  tallies: readonly Tally[],
  fetchedBy: Map<string, Set<string>>,
  row: PerceptionRow,
  documents: readonly CorpusDocument[] | undefined,
  readIn: Locale,
  layout: CoreLayout,
): void {
  for (const step of row.trace?.steps ?? []) {
    for (const tool of step.tools) {
      const fetch = classifyFetch(tool, documents, readIn, layout);
      if (!fetch) continue;
      for (const t of tallies) t.fetches[fetch.kind]++;
      if (fetch.id) noteAccess(fetchedBy, fetch.id, row.id);
    }
  }
}

function accumulateRow(
  row: PerceptionRow,
  snapshots: ReadonlyMap<string, readonly CorpusDocument[]>,
  accum: PerceptionAccum,
): void {
  const reading = row.trace?.core?.locale ?? null;
  // Answers from before per-language cores (no core in their trace) read one core with both languages.
  const layout: CoreLayout = row.trace?.core?.layout ?? "both";
  const tallies = [accum.overall, accum.byLayout[layout]];
  const key = `${row.locale}/${reading ?? "-"}`;
  const entry = accum.mix.get(key) ?? { page: row.locale, reading, answers: 0 };
  entry.answers++;
  accum.mix.set(key, entry);

  addRowToTallies(tallies, row);
  for (const id of new Set(row.citedIds)) noteAccess(accum.citedBy, id, row.id);
  tallyCacheSteps(tallies, row);
  tallySearchConversion(accum.search, row);
  tallyDocumentFetches(
    tallies,
    accum.fetchedBy,
    row,
    row.corpusKey ? snapshots.get(row.corpusKey) : undefined,
    reading ?? row.locale,
    layout,
  );
}

function documentAccessList(
  fetchedBy: Map<string, Set<string>>,
  citedBy: Map<string, Set<string>>,
): DocumentAccess[] {
  const ids = new Set([...fetchedBy.keys(), ...citedBy.keys()]);
  return [...ids]
    .map((id) => ({
      id,
      fetched: fetchedBy.get(id)?.size ?? 0,
      cited: citedBy.get(id)?.size ?? 0,
    }))
    .sort((a, b) => b.fetched - a.fetched || b.cited - a.cited || a.id.localeCompare(b.id));
}

export function measurePerception(
  rows: readonly PerceptionRow[],
  snapshots: ReadonlyMap<string, readonly CorpusDocument[]>,
): Perception {
  const accum: PerceptionAccum = {
    overall: newTally(),
    byLayout: { both: newTally(), locale: newTally() },
    fetchedBy: new Map(),
    citedBy: new Map(),
    mix: new Map(),
    search: {
      semantic: { answers: 0, converted: 0 },
      words: { answers: 0, converted: 0 },
    },
  };

  for (const row of rows) accumulateRow(row, snapshots, accum);

  return {
    ...slice(accum.overall),
    byLayout: { both: slice(accum.byLayout.both), locale: slice(accum.byLayout.locale) },
    localeMix: [...accum.mix.values()].sort((a, b) => b.answers - a.answers),
    documents: documentAccessList(accum.fetchedBy, accum.citedBy),
    search: accum.search,
  };
}

/** When the data supports a tier (the book's Hierarchical Retention: tiers from access). */
export const TIER_RULES = {
  /** Promote a document fetched in more than this share of answers… */
  promoteShare: 0.2,
  /** …once there are at least this many answers. */
  promoteMinAnswers: 20,
  /** Cut a project, post or CV shorter once this many answers never fetched nor cited it. */
  demoteMinAnswers: 200,
} as const;

const DEMOTABLE = new Set(["project", "post", "cv"]);

export interface TierSuggestion {
  id: string;
  title: string;
  fetched: number;
  cited: number;
  /** Why, in numbers. */
  why: string;
}

export interface TierSuggestions {
  promote: TierSuggestion[];
  demote: TierSuggestion[];
  /** Looked at and not suggested, and why: the near misses and the floors. */
  considered: TierSuggestion[];
}

const percent = (share: number) => `${(share * 100).toFixed(0)} %`;

/**
 * Suggestions for today's corpus from the window's access counts. A
 * suggestion is never applied here: the admin applies it (L0), and promotion
 * stays human as since plan phase 14.
 */
export function suggestTiers(
  perception: Pick<Perception, "answers" | "documents">,
  documents: readonly CorpusDocument[],
  tiers: CorpusTiers,
): TierSuggestions {
  const { answers } = perception;
  const access = new Map(perception.documents.map((d) => [d.id, d]));
  const suggestions: TierSuggestions = { promote: [], demote: [], considered: [] };
  const entry = (d: CorpusDocument, why: string): TierSuggestion => ({
    id: d.id,
    title: d.title,
    fetched: access.get(d.id)?.fetched ?? 0,
    cited: access.get(d.id)?.cited ?? 0,
    why,
  });

  const room = MAX_PROMOTED - tiers.promoted.length;
  const candidates = documents
    .filter((d) => !tiers.promoted.includes(d.id) && (access.get(d.id)?.fetched ?? 0) > 0)
    .map((d) => ({ d, share: access.get(d.id)!.fetched / Math.max(answers, 1) }))
    .sort((a, b) => b.share - a.share || a.d.id.localeCompare(b.d.id));
  for (const { d, share } of candidates) {
    const fetched = `fetched in ${percent(share)} of ${answers} answers`;
    if (answers < TIER_RULES.promoteMinAnswers) {
      suggestions.considered.push(
        entry(d, `${fetched}; promotion needs ${TIER_RULES.promoteMinAnswers} answers`),
      );
    } else if (share <= TIER_RULES.promoteShare) {
      suggestions.considered.push(
        entry(d, `${fetched}; promotion needs more than ${percent(TIER_RULES.promoteShare)}`),
      );
    } else if (suggestions.promote.length >= room) {
      suggestions.considered.push(entry(d, `${fetched}; at most ${MAX_PROMOTED} are promoted`));
    } else {
      suggestions.promote.push(entry(d, fetched));
    }
  }

  const unused = documents.filter(
    (d) =>
      DEMOTABLE.has(d.kind) &&
      !tiers.promoted.includes(d.id) &&
      !tiers.demoted.includes(d.id) &&
      !access.has(d.id),
  );
  if (unused.length && answers < TIER_RULES.demoteMinAnswers) {
    suggestions.considered.push({
      id: "*",
      title: `${unused.length} documents never fetched nor cited`,
      fetched: 0,
      cited: 0,
      why: `${answers} answers; clipping harder needs ${TIER_RULES.demoteMinAnswers}`,
    });
  } else {
    const room = MAX_DEMOTED - tiers.demoted.length;
    for (const d of unused.slice(0, Math.max(room, 0))) {
      suggestions.demote.push(entry(d, `never fetched nor cited in ${answers} answers`));
    }
  }
  return suggestions;
}
