/**
 * The copilot's skills (plan phase 27): the drafts, the editor's verdicts on
 * them, and the Assistant → Copilot view of how often each version's drafts
 * are kept. The server holds no text, only ids and word counts.
 */

/** A draft from the copilot; `suggestionId` names it in the verdict the editor reports. */
export interface CopilotDraft {
  text: string;
  model: string;
  /** Absent when no model wrote it, it found no answer, or an older API answered. */
  suggestionId?: string;
  /** What the draft still fails after its repairs: it needs the admin's eye (plan phase 28). */
  needsReview?: string[];
  /** The explored skills' other drafts (search description, tighten); `text` is the top pick. */
  alternatives?: { text: string; lead: string | null; needsReview?: string[] }[];
  lead?: string | null;
  /** A second model's reading of a translation, and whether it was revised. */
  critic?: { revised: boolean; notes: string[] };
}

/** A verdict as the API takes it (`POST /admin/ai/copilot/outcomes`). */
export type DraftVerdict =
  | { id: string; outcome: "kept"; pick?: number }
  | { id: string; outcome: "edited"; distance: number; pick?: number }
  | { id: string; outcome: "discarded"; distance: number | null };

export interface SkillVersionStats {
  version: string;
  current: boolean;
  uses: number;
  kept: number;
  edited: number;
  discarded: number;
  abstained: number;
  waiting: number;
  repaired: number;
  needsEye: number;
  alternativesKept: number;
  revised: number;
  decided: number;
  /** Kept as they were or edited, of those decided. */
  keepRate: number | null;
  editRate: number | null;
  /** In words. */
  medianEdit: number | null;
  flagged: boolean;
  first: string | null;
  last: string | null;
}

export interface CopilotSkill {
  id: string;
  description: string;
  whenToUse: string;
  models: "text" | "vision";
  version: string;
  gates: string[];
  /** The leads it explores (plan phase 28), when it has them. */
  leads: string[];
  /** Whether a second model reads its drafts (for some inputs). */
  critic: boolean;
  /** The instructions the version sends, on a sample. */
  template: string;
  /** The copilot's drafts, per version. */
  versions: SkillVersionStats[];
  /**
   * The agents' drafts (plan phases 29–31), counted apart: decided when you
   * decide a proposal. Absent from an older API.
   */
  agent?: SkillVersionStats[];
}

export interface CopilotSkillsView {
  rules: { keepFloor: number; minimumDecided: number };
  skills: CopilotSkill[];
}

const NAMES: Record<string, string> = {
  translate: "Translate",
  tighten: "Tighten",
  seo: "Search description",
  "faq-question": "FAQ question",
  "faq-answer": "FAQ answer",
  alt: "Alt text",
  describe: "Image description",
};

export const skillName = (id: string): string => NAMES[id] ?? id;

export function percent(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)} %`;
}

/** What a version's numbers amount to, in a line: flagged, too few to say, or its keep rate. */
export function verdictLine(stats: SkillVersionStats, rules: CopilotSkillsView["rules"]): string {
  if (stats.flagged) {
    return `Kept ${percent(stats.keepRate)} of the time over ${stats.decided} decided drafts: under ${percent(rules.keepFloor)}.`;
  }
  if (stats.decided < rules.minimumDecided) {
    return `${stats.decided} of the ${rules.minimumDecided} decided drafts a rate needs.`;
  }
  return `Kept ${percent(stats.keepRate)} of the time over ${stats.decided} decided drafts.`;
}

export function medianEdit(stats: SkillVersionStats): string {
  if (stats.medianEdit === null) return "–";
  const words = Math.round(stats.medianEdit);
  return `${words} ${words === 1 ? "word" : "words"}`;
}

export const modelsLabel = (models: CopilotSkill["models"]): string =>
  models === "vision" ? "A model that reads images (Gemini's)" : "Any model of the copilot's chain";

const LEADS: Record<string, string> = {
  outcome: "outcome first",
  problem: "problem first",
  stack: "how it was built",
  order: "same order",
  strongest: "strongest point first",
  shortest: "shortest",
};

export const leadName = (id: string | null): string => (id ? (LEADS[id] ?? id) : "another way");

/** A draft as an editor offers it: the drafts to choose from, and the notes on each. */
export interface DraftOffer {
  drafts: { text: string; lead: string | null; notes: string[] }[];
  /** The draft in the field now. */
  chosen: number;
}

/**
 * The offer a draft makes: its own notes (what it still fails, what a second
 * reading changed, or found and could not fix) and its alternatives'; null
 * when there is nothing to show beside the field (one clean draft).
 */
export function draftOffer(draft: CopilotDraft): DraftOffer | null {
  const notes = (needsReview?: string[]) =>
    needsReview?.length ? [`Needs your eye: ${needsReview.join("; ")}.`] : [];
  const readNotes = (read: CopilotDraft["critic"]): string[] => {
    if (!read?.notes.length) return [];
    if (read.revised) return [`A second reading changed it: ${read.notes.join(" ")}`];
    return [`A second reading found: ${read.notes.join(" ")} Its revision was not kept.`];
  };
  const critic = readNotes(draft.critic);
  const drafts = [
    { text: draft.text, lead: draft.lead ?? null, notes: [...notes(draft.needsReview), ...critic] },
    ...(draft.alternatives ?? []).map((alt) => ({
      text: alt.text,
      lead: alt.lead,
      notes: notes(alt.needsReview),
    })),
  ];
  return drafts.length > 1 || drafts[0]!.notes.length ? { drafts, chosen: 0 } : null;
}

const GATES: Record<string, string> = {
  length: "within the limit",
  "min-length": "long enough",
  bare: "no preamble or quotes",
  language: "in the right language",
  tags: "the same tags",
  numbers: "the same numbers",
  links: "the same links",
  code: "the same code",
  ratio: "a sensible length",
  shorter: "shorter",
  "no-image-of": "no “image of”",
  answer: "80 words, or no answer",
  cited: "cites its documents",
  grounded: "figures from its documents",
  question: "one question on one line",
  instruction: "no order to the assistant",
};

/** A skill's checks, in words. */
export const gateNames = (ids: readonly string[]): string =>
  ids.length ? ids.map((id) => GATES[id] ?? id).join(", ") : "None";

/** How a version's drafts were made: repaired, flagged, alternatives kept, revised. */
export function checksLine(
  stats: SkillVersionStats,
  skill: Pick<CopilotSkill, "leads" | "critic">,
): string {
  const parts = [
    `${stats.repaired} repaired`,
    `${stats.needsEye} needed your eye`,
    ...(skill.leads.length ? [`${stats.alternativesKept} kept from an alternative`] : []),
    ...(skill.critic ? [`${stats.revised} revised by a second reading`] : []),
  ];
  return `Of ${stats.uses} drafts: ${parts.join(", ")}.`;
}
