/**
 * Perception as the Overview shows it (plan phase 16): what the assistant
 * reads and how it uses it, and the corpus tiers. The shapes mirror
 * `server/src/ask/perception.ts` and `GET /admin/assistant/perception`.
 */

export type Locale = "en" | "de";

export interface StepCache {
  steps: number;
  input: number;
  cached: number;
  hits: number;
}

export interface CorpusTiers {
  promoted: string[];
  demoted: string[];
}

export interface TierSuggestion {
  id: string;
  title: string;
  fetched: number;
  cited: number;
  why: string;
}

/** The measures over a set of answers: all of them, or those that read one layout. */
export interface PerceptionSlice {
  answers: number;
  cache: { first: StepCache; later: StepCache };
  fetches: { whole: number; rest: number; handle: number; unknown: number };
  rereadRatio: number | null;
  tokens: {
    input: number;
    output: number;
    inputPerAnswer: number | null;
    helpful: number;
    perHelpful: number | null;
  };
  usdPerAnswer: number | null;
}

export type CoreLayout = "both" | "locale";

export interface PerceptionView extends PerceptionSlice {
  days: number;
  healthyReread: number;
  /** Before plan phase 16 (`both`: one core with both languages) and after (`locale`). */
  byLayout: Record<CoreLayout, PerceptionSlice>;
  localeMix: { page: Locale; reading: Locale | null; answers: number }[];
  documents: { id: string; fetched: number; cited: number }[];
  coreTokens: Record<Locale, number> | null;
  rules: { promoteShare: number; promoteMinAnswers: number; demoteMinAnswers: number };
  limits: { promoted: number; demoted: number };
  tiers: CorpusTiers;
  suggestions: {
    promote: TierSuggestion[];
    demote: TierSuggestion[];
    considered: TierSuggestion[];
  };
  titles: Record<string, string>;
  /** Searches that led to a citation, by meaning too or by words alone (plan phase 18). */
  search?: Record<"semantic" | "words", { answers: number; converted: number }>;
  /** How each tool fares over the window (plan phase 21, `tool-metrics.ts`). */
  tools?: { answers: number; tools: ToolStats[] };
  /** Sessions the conversation window trimmed, and rephrases after (plan phase 22). */
  window?: {
    sessions: number;
    sessionsTrimmed: number;
    afterTrim: { answers: number; rephrased: number };
    otherwise: { answers: number; rephrased: number };
  };
  /**
   * Answers asked on a case study or a post against the rest (visitor plan V8);
   * among them, those about a section, a code block or a selection (V9).
   */
  pages?: {
    pageAware: AnswerGroup & { promoted: number };
    /** Absent from an API before V9. */
    focused?: AnswerGroup & { verified: number };
    rest: AnswerGroup;
  };
}

/** A group of answers: the rounds they took, how soon they started, how many helped. */
export interface AnswerGroup {
  answers: number;
  /** Model calls per answer. */
  rounds: number | null;
  /** The server's time to the first token, p50. */
  ttftP50Ms: number | null;
  /** The helpful share. */
  helpful: number | null;
}

/** "3 answers · 1.4 rounds · first token 1.1 s · 67 % helpful", a note after the count. */
function groupLine(group: AnswerGroup, note = ""): string {
  const rounds = group.rounds === null ? "–" : group.rounds.toFixed(1);
  const first = group.ttftP50Ms === null ? "–" : `${(group.ttftP50Ms / 1000).toFixed(1)} s`;
  const answers = `${group.answers} ${group.answers === 1 ? "answer" : "answers"}${note}`;
  return `${answers} · ${rounds} rounds · first token ${first} · ${percent(group.helpful)} helpful`;
}

/**
 * "Asked on a case study or post: 3 answers (1 with its text) · 1.5 rounds · …;
 * about a section, code or selection: 1 answer (1 on the page) · …; elsewhere:
 * 40 answers · …", or null before any page-aware answer.
 */
export function pagesLine(view: PerceptionView): string | null {
  const p = view.pages;
  if (!p?.pageAware.answers) return null;
  const promoted = ` (${p.pageAware.promoted} with its text)`;
  const parts = [`Asked on a case study or post: ${groupLine(p.pageAware, promoted)}`];
  if (p.focused?.answers) {
    const held = ` (${p.focused.verified} on the page)`;
    parts.push(`about a section, code or selection: ${groupLine(p.focused, held)}`);
  }
  parts.push(`elsewhere: ${groupLine(p.rest)}`);
  return parts.join("; ");
}

/**
 * "Conversation window: 2 of 40 sessions trimmed (5 %); rephrased after a
 * trim 1 of 3 (33 %), otherwise 2 of 37 (5 %)", or null before any session.
 */
export function windowLine(view: PerceptionView): string | null {
  const w = view.window;
  if (!w?.sessions) return null;
  const trimmed = `${w.sessionsTrimmed} of ${w.sessions} sessions trimmed (${percent(w.sessionsTrimmed, w.sessions)})`;
  if (!w.afterTrim.answers) return `Conversation window: ${trimmed}`;
  const after = `${w.afterTrim.rephrased} of ${w.afterTrim.answers} (${percent(w.afterTrim.rephrased, w.afterTrim.answers)})`;
  const other = `${w.otherwise.rephrased} of ${w.otherwise.answers} (${percent(w.otherwise.rephrased, w.otherwise.answers)})`;
  return `Conversation window: ${trimmed}; rephrased after a trim ${after}, otherwise ${other}`;
}

export type ToolOutcomeName =
  | "ok"
  | "not_found"
  | "not_allowed"
  | "no_hits"
  | "duplicate"
  | "budget_exhausted"
  | "error"
  | "cut-off";

export interface ToolStats {
  name: string;
  calls: number;
  callsPerAnswer: number | null;
  outcomes: Partial<Record<ToolOutcomeName, number>>;
  /** Of the calls that returned documents, the share whose answer cited one; null otherwise. */
  citedAfter: number | null;
}

export interface ToolRow {
  name: string;
  perAnswer: string;
  notFound: string;
  notAllowed: string;
  noHits: string;
  repeated: string;
  overBudget: string;
  cited: string;
}

/** Each tool's calls per answer, the share of its calls by outcome, and what got cited. */
export function toolRows(view: PerceptionView): ToolRow[] {
  return (view.tools?.tools ?? []).map((t) => {
    const share = (outcome: ToolOutcomeName) => percent(t.outcomes[outcome] ?? 0, t.calls);
    return {
      name: t.name,
      perAnswer: t.callsPerAnswer === null ? "–" : t.callsPerAnswer.toFixed(2),
      notFound: share("not_found"),
      notAllowed: share("not_allowed"),
      noHits: share("no_hits"),
      repeated: share("duplicate"),
      overBudget: share("budget_exhausted"),
      cited: percent(t.citedAfter),
    };
  });
}

export type Tier = "promoted" | "demoted";

const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

/** A share as a whole percentage, or a dash with nothing to divide by. */
export function percent(part: number | null, whole = 1): string {
  if (part === null || !whole) return "–";
  return `${Math.round((part / whole) * 100)} %`;
}

/** The cached share of a set of steps. */
export function cacheShare(steps: StepCache): string {
  return steps.input ? percent(steps.cached, steps.input) : "–";
}

/** "English page, English core: 12 · German page, one core (before): 3". */
export function localeMixLine(mix: PerceptionView["localeMix"]): string {
  return mix
    .map((m) => {
      const core = m.reading ? `${LANGUAGE[m.reading]} core` : "one core (before)";
      return `${LANGUAGE[m.page]} page, ${core}: ${m.answers}`;
    })
    .join(" · ");
}

/** The tier a document has now, if any. */
export function tierOf(tiers: CorpusTiers, id: string): Tier | null {
  if (tiers.promoted.includes(id)) return "promoted";
  return tiers.demoted.includes(id) ? "demoted" : null;
}

/** The tiers with `id` moved to `tier`, or out of both with null; the lists keep their order. */
export function withTier(tiers: CorpusTiers, id: string, tier: Tier | null): CorpusTiers {
  const without = {
    promoted: tiers.promoted.filter((x) => x !== id),
    demoted: tiers.demoted.filter((x) => x !== id),
  };
  if (tier) without[tier] = [...without[tier], id];
  return without;
}

export interface DocumentRow {
  id: string;
  title: string;
  fetched: string;
  cited: string;
  tier: Tier | null;
}

/** The most-used documents: their fetch and citation shares, and their tier. */
export function documentRows(view: PerceptionView, limit = 10): DocumentRow[] {
  return view.documents.slice(0, limit).map((d) => ({
    id: d.id,
    title: view.titles[d.id] ?? "",
    fetched: percent(d.fetched, view.answers),
    cited: percent(d.cited, view.answers),
    tier: tierOf(view.tiers, d.id),
  }));
}

/** The windows the page offers, in days. */
export const WINDOWS = [7, 30, 90] as const;

export interface LayoutRow {
  layout: CoreLayout;
  label: string;
  answers: number;
  inputPerAnswer: string;
  usdPerAnswer: string;
  cached: string;
  reread: string;
  perHelpful: string;
}

const whole = (value: number | null) =>
  value === null ? "–" : Math.round(value).toLocaleString("en-US");

/** Before and after side by side: the plan's gate compares cost and cached share. */
export function layoutRows(view: PerceptionView): LayoutRow[] {
  const labels: Record<CoreLayout, string> = {
    both: "One core, both languages (before)",
    locale: "A core per language (after)",
  };
  return (["both", "locale"] as const).map((layout) => {
    const s = view.byLayout[layout];
    return {
      layout,
      label: labels[layout],
      answers: s.answers,
      inputPerAnswer: whole(s.tokens.inputPerAnswer),
      usdPerAnswer: s.usdPerAnswer === null ? "–" : `$${s.usdPerAnswer.toFixed(5)}`,
      cached: `${cacheShare(s.cache.first)} / ${cacheShare(s.cache.later)}`,
      reread: percent(s.rereadRatio),
      perHelpful: whole(s.tokens.perHelpful),
    };
  });
}

/** "By meaning: 4 of 6 led to a citation · By words alone: 2 of 5 …", or null without searches. */
export function searchLine(search: PerceptionView["search"]): string | null {
  if (!search || !(search.semantic.answers + search.words.answers)) return null;
  const part = (label: string, s: { answers: number; converted: number }) =>
    s.answers ? `${label}: ${s.converted} of ${s.answers} led to a citation` : null;
  return [part("By meaning", search.semantic), part("By words alone", search.words)]
    .filter(Boolean)
    .join(" · ");
}

/** The re-read ratio against the book's healthy ceiling (a heuristic). */
export function rereadVerdict(view: PerceptionView): "healthy" | "high" | null {
  if (view.rereadRatio === null) return null;
  return view.rereadRatio < view.healthyReread ? "healthy" : "high";
}
