import type { Skill } from "./skill.js";

/**
 * The skills' table (plan phase 27): per version, what the admin did with its
 * drafts. A draft counts once it is decided (kept as it was, edited,
 * discarded); one that abstained (nothing to keep) or still waits for a
 * verdict counts in no rate. The book's deprecation by success rate becomes a
 * flag the admin sees, not an eviction: the cutoffs are operating examples,
 * not universal thresholds.
 */
export const SKILL_RULES = {
  /** A version whose drafts stay (as they were or edited) less often than this… */
  keepFloor: 0.5,
  /** …over at least this many decided drafts is flagged. */
  minimumDecided: 10,
} as const;

/** One skill version's drafts from one source, counted (skills/uses.ts `useAggregates`). */
export interface UseAggregate {
  skill: string;
  version: string;
  /** The admin's copilot, or an agent's proposals (decided when the admin decides those). */
  source: "copilot" | "agent";
  uses: number;
  kept: number;
  edited: number;
  discarded: number;
  abstained: number;
  waiting: number;
  /** Drafts repaired after a gate failed (plan phase 28). */
  repaired: number;
  /** Drafts returned still failing a gate: they needed the admin's eye. */
  needsEye: number;
  /** Drafts kept (as they were or edited) that were one of the alternatives. */
  alternativesKept: number;
  /** Translations the critic had revised. */
  revised: number;
  /** The median edit of the edited drafts, in words. */
  medianEdit: number | null;
  first: string | null;
  last: string | null;
}

export interface VersionStats extends Omit<UseAggregate, "skill" | "source"> {
  current: boolean;
  decided: number;
  /** Drafts that stayed, as they were or edited, of those decided. */
  keepRate: number | null;
  /** Drafts the admin edited, of those decided. */
  editRate: number | null;
  flagged: boolean;
}

export interface SkillView {
  id: string;
  description: string;
  whenToUse: string;
  models: "text" | "vision";
  version: string;
  gates: readonly string[];
  /** The leads it explores (best-of-N), when it has them. */
  leads: readonly string[];
  /** Whether a second model reads its drafts (for some inputs). */
  critic: boolean;
  template: string;
  /** The copilot's drafts: the current version first (zeros when unused), then the older ones by last use. */
  versions: VersionStats[];
  /**
   * The agents' drafts (plan phases 29–31), counted apart: decided when the
   * admin decides a proposal, not in an editor. The versions they used, the
   * current one first, then by last use; empty when none.
   */
  agent: VersionStats[];
}

export function versionStats(
  use: Omit<UseAggregate, "skill" | "source">,
  current: boolean,
): VersionStats {
  const decided = use.kept + use.edited + use.discarded;
  const keepRate = decided ? (use.kept + use.edited) / decided : null;
  return {
    version: use.version,
    uses: use.uses,
    kept: use.kept,
    edited: use.edited,
    discarded: use.discarded,
    abstained: use.abstained,
    waiting: use.waiting,
    repaired: use.repaired,
    needsEye: use.needsEye,
    alternativesKept: use.alternativesKept,
    revised: use.revised,
    medianEdit: use.medianEdit,
    first: use.first,
    last: use.last,
    current,
    decided,
    keepRate,
    editRate: decided ? use.edited / decided : null,
    flagged:
      decided >= SKILL_RULES.minimumDecided &&
      keepRate !== null &&
      keepRate < SKILL_RULES.keepFloor,
  };
}

const unused = (version: string): Omit<UseAggregate, "skill" | "source"> => ({
  version,
  uses: 0,
  kept: 0,
  edited: 0,
  discarded: 0,
  abstained: 0,
  waiting: 0,
  repaired: 0,
  needsEye: 0,
  alternativesKept: 0,
  revised: 0,
  medianEdit: null,
  first: null,
  last: null,
});

export function skillTable(
  skills: readonly Skill[],
  aggregates: readonly UseAggregate[],
): SkillView[] {
  const byLastUse = (a: UseAggregate, b: UseAggregate) =>
    (b.last ?? "").localeCompare(a.last ?? "");
  return skills.map((skill) => {
    const own = aggregates.filter((a) => a.skill === skill.id && a.source === "copilot");
    const current = own.find((a) => a.version === skill.version) ?? unused(skill.version);
    const older = own.filter((a) => a.version !== skill.version).sort(byLastUse);
    const agents = aggregates.filter((a) => a.skill === skill.id && a.source === "agent");
    const agentNow = agents.filter((a) => a.version === skill.version);
    const agentBefore = agents.filter((a) => a.version !== skill.version).sort(byLastUse);
    return {
      id: skill.id,
      description: skill.description,
      whenToUse: skill.whenToUse,
      models: skill.models,
      version: skill.version,
      gates: skill.gates,
      leads: skill.leads,
      critic: skill.critic,
      template: skill.template,
      versions: [versionStats(current, true), ...older.map((a) => versionStats(a, false))],
      agent: [
        ...agentNow.map((a) => versionStats(a, true)),
        ...agentBefore.map((a) => versionStats(a, false)),
      ],
    };
  });
}
