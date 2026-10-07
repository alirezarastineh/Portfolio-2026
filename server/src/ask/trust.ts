import type { ModelEntry } from "./models/registry.js";

/**
 * Who may do what (plan phase 14). Every model-driven action has a trust
 * level, set per action type: L0 suggests and a human approves each one, L1
 * acts and is reviewed (its effect is reversible), L2 acts within bounds, L3
 * acts alone (nothing here), and "human" is never done by a model. The levels
 * are enforced in code, at the place each entry names; `trust.spec.ts` holds
 * the code to them (every tool registered, publish out of every agent's
 * reach). Trust moves over time: the monitor (trust-monitor.ts) demotes a
 * model or the deep route on the evidence below, and only the admin
 * reinstates.
 */

export type TrustLevel = "L0" | "L1" | "L2" | "L3" | "human";

export interface TrustEntry {
  /** What is done: a tool's name, or a feature's action. */
  action: string;
  /** Who does it. */
  actor: "assistant" | "copilot" | "insights" | "run" | "agent" | "system" | "admin";
  level: TrustLevel;
  /** Who approves each one: nobody (it acts within bounds), the visitor, the admin. */
  approver: "none" | "visitor" | "admin";
  /** Where the level is enforced. */
  enforcement: string;
  /** Whether its effect can be undone. */
  reversible: boolean;
  /** False for an action a later phase builds: its level is decided now. */
  built: boolean;
}

const READS = "tools.ts: reads the published corpus; nothing writes";

export const TRUST_REGISTRY: readonly TrustEntry[] = [
  ...(["search_portfolio", "get_document", "list_projects", "get_resume"] as const).map(
    (action): TrustEntry => ({
      action,
      actor: "assistant",
      level: "L2",
      approver: "none",
      enforcement: READS,
      reversible: true,
      built: true,
    }),
  ),
  {
    action: "suggest_followups",
    actor: "assistant",
    level: "L2",
    approver: "none",
    enforcement: "tools.ts: validated questions; the visitor picks one or none",
    reversible: true,
    built: true,
  },
  {
    action: "navigate",
    actor: "assistant",
    level: "L1",
    approver: "none",
    enforcement: "tools.ts allowedPath: this site's pages only; the visitor can go back",
    reversible: true,
    built: true,
  },
  {
    action: "handoff_contact",
    actor: "assistant",
    level: "L0",
    approver: "visitor",
    enforcement:
      "The tool only acknowledges; the terminal asks yes or no (ask.store.ts answerHandoff), and the visitor sends the prefilled form",
    reversible: false,
    built: true,
  },
  {
    action: "copilot.suggest",
    actor: "copilot",
    level: "L0",
    approver: "admin",
    enforcement:
      "admin.ts copilotRequest returns text; the editor keeps it only on the admin's Save",
    reversible: true,
    built: true,
  },
  {
    action: "insights.summarize",
    actor: "insights",
    level: "L2",
    approver: "none",
    enforcement:
      "insights.ts: reads the redacted questions of 30 days, fenced as `insights`; writes the run to ai_insight_snapshots (topics with example questions), pruned within 60 days of the run",
    reversible: true,
    built: true,
  },
  ...(["eval", "pairwise", "judge"] as const).map((kind): TrustEntry => ({
    action: `run.${kind}`,
    actor: "run",
    level: "L2",
    approver: "admin",
    enforcement:
      kind === "judge"
        ? "runs/routes.ts: started by the admin, or nightly (`judge.nightly`); fenced per item (runs/paid.ts); writes only ai_messages.judge, with a judge that already answers visitors"
        : "runs/routes.ts: started by the admin; fenced per item (runs/paid.ts); fixture data only",
    reversible: true,
    built: true,
  })),
  {
    action: "trust.demote",
    actor: "system",
    level: "L2",
    approver: "none",
    enforcement: "trust-monitor.ts: the rules below, audited; only the admin reinstates",
    reversible: true,
    built: true,
  },
  {
    action: "embeddings.backfill",
    actor: "system",
    level: "L2",
    approver: "none",
    enforcement:
      "embeddings.ts backfillEmbeddings: only where the migrations ran (index.ts), with the deploy's flag and the admin's switch; fenced per batch as `embeddings`; writes only ai_embeddings, derived from published text",
    reversible: true,
    built: true,
  },
  {
    action: "corpus.tiers",
    actor: "system",
    level: "L0",
    approver: "admin",
    enforcement:
      "perception.ts suggests from 30 days of fetches and citations, no model involved; the admin applies each (perception-routes.ts), audited",
    reversible: true,
    built: true,
  },
  {
    action: "journal.diagnose",
    actor: "system",
    level: "L0",
    approver: "admin",
    enforcement:
      "journal.ts: no model; reads the answer, its snapshot and today's corpus, and proposes an entry the admin edits, accepts or retires (journal-routes.ts); writes only ai_journal, no visitor text",
    reversible: true,
    built: true,
  },
  {
    action: "journal.replay",
    actor: "run",
    level: "L2",
    approver: "admin",
    enforcement:
      "runs/replay-work.ts: started and confirmed by the admin; fenced per chain as `agent` (off until switched on); the question goes only to chains that already answer visitors; writes only usage and, once every chain has answered, the entry's replay and analysis (never a field the admin edited, never an entry fixed or retired)",
    reversible: true,
    built: true,
  },
  {
    action: "insights.auto",
    actor: "system",
    level: "L2",
    approver: "none",
    enforcement:
      "learning-monitor.ts: only when the adaptive trigger fires (failures rose, 10 new answers since the last run); fenced as `autoInsights` (off until switched on, its own cap); writes only ai_insight_snapshots, pruned within 60 days of the run",
    reversible: true,
    built: true,
  },
  {
    action: "lesson.propose",
    actor: "admin",
    level: "L0",
    approver: "admin",
    enforcement:
      "lessons-routes.ts: the admin's words, kept only when corroborated (3 decided journal entries, or an unanswered insight topic of 5 questions); never reaches the prompt or an answer",
    reversible: true,
    built: true,
  },
  {
    action: "judge.nightly",
    actor: "system",
    level: "L2",
    approver: "none",
    enforcement:
      "nightly-judge.ts: a judge run over the previous day's sample and flagged answers, at most 40; fenced as `nightlyJudge` (off until switched on, its own cap; an answer projected to cross it, by the dearest of this night and the last ones, is not started); writes only ai_messages.judge",
    reversible: true,
    built: true,
  },
  {
    action: "lesson.retire",
    actor: "system",
    level: "L2",
    approver: "none",
    enforcement:
      "learning-monitor.ts: below 0.5 effectiveness after 5 applications, audited; the admin reopens it, and it is measured again from then",
    reversible: true,
    built: true,
  },
  {
    action: "agent.propose",
    actor: "agent",
    level: "L0",
    approver: "admin",
    enforcement: "Plan phase 29: proposals only; the admin applies each one",
    reversible: true,
    built: false,
  },
  {
    action: "agent.apply",
    actor: "agent",
    level: "L1",
    approver: "admin",
    enforcement: "Plan phase 30: writes drafts, reversible from `before`; never publishes",
    reversible: true,
    built: false,
  },
  {
    action: "publish",
    actor: "admin",
    level: "human",
    approver: "admin",
    enforcement:
      "routes/admin.ts behind the admin's session; no agent module imports a publish write (trust.spec.ts)",
    reversible: true,
    built: true,
  },
];

/** The evidence a demotion needs. */
export const TRUST_RULES = {
  /** A chat model's mean judged faithfulness must stay at or above this. */
  faithfulnessFloor: 0.8,
  /** Over its latest judged visitor answers… */
  judgedWindow: 50,
  /** …given at least this many. */
  judgedMinimum: 20,
  /** The deep route's share of failed answers must stay at or below this… */
  deepErrorCeiling: 0.2,
  /** …over its latest answers, given this many. */
  deepWindow: 30,
} as const;

/** What the monitor concluded about one subject, and on what evidence. */
export interface Verdict {
  /** `model:<id>` or `route:deep`. */
  subject: string;
  verdict: "demote" | "keep" | "too-little";
  /** The measure (faithfulness, or the failed share); null without enough evidence. */
  value: number | null;
  /** How many answers it rests on. */
  n: number;
  evidence: string;
}

/** A chat model's verdict from its judged faithfulness scores, newest first. */
export function faithfulnessVerdict(subject: string, scores: readonly number[]): Verdict {
  const recent = scores.slice(0, TRUST_RULES.judgedWindow);
  const n = recent.length;
  if (n < TRUST_RULES.judgedMinimum) {
    return {
      subject,
      verdict: "too-little",
      value: null,
      n,
      evidence: `${n} judged answers; ${TRUST_RULES.judgedMinimum} needed`,
    };
  }
  const mean = recent.reduce((sum, score) => sum + score, 0) / n;
  return {
    subject,
    verdict: mean < TRUST_RULES.faithfulnessFloor ? "demote" : "keep",
    value: mean,
    n,
    evidence: `faithfulness ${mean.toFixed(2)} over ${n} judged answers (floor ${TRUST_RULES.faithfulnessFloor})`,
  };
}

/**
 * The deep route's verdict from its answers' finish reasons, newest first. An
 * aborted answer (the visitor left) says nothing about the route.
 */
export function errorRateVerdict(subject: string, finishReasons: readonly string[]): Verdict {
  const counted = finishReasons.filter((r) => r !== "aborted").slice(0, TRUST_RULES.deepWindow);
  const n = counted.length;
  if (n < TRUST_RULES.deepWindow) {
    return {
      subject,
      verdict: "too-little",
      value: null,
      n,
      evidence: `${n} answers; ${TRUST_RULES.deepWindow} needed`,
    };
  }
  const failed = counted.filter((r) => r.startsWith("error:")).length;
  const rate = failed / n;
  return {
    subject,
    verdict: rate > TRUST_RULES.deepErrorCeiling ? "demote" : "keep",
    value: rate,
    n,
    evidence: `${failed} of ${n} answers failed (${Math.round(rate * 100)} %; ceiling ${TRUST_RULES.deepErrorCeiling * 100} %)`,
  };
}

export const modelSubject = (id: string) => `model:${id}`;
export const DEEP_ROUTE = "route:deep";

/**
 * A chain without its demoted models, but never an empty one: when every
 * model is demoted, visitors keep the chain (the monitor refuses such a
 * demotion; this guards against a configuration that changed since).
 */
export function withoutDemoted(
  chain: readonly ModelEntry[],
  demoted: ReadonlySet<string>,
): ModelEntry[] {
  const kept = chain.filter((entry) => !demoted.has(modelSubject(entry.id)));
  return kept.length ? kept : [...chain];
}
