import type { AssistantHealth, AuditRow, TrustLevel, TrustRules } from "./assistant-types";

/**
 * Trust in the admin (plan phase 14): who may do what, what the monitor took
 * out of the visitors' service, and what needs a person. Pure, so the Trust
 * tab, the Overview and the pulse share it.
 */

const LEVELS: Record<TrustLevel, string> = {
  L0: "suggests; a person approves each one",
  L1: "acts, reversibly; reviewed after",
  L2: "acts within bounds",
  L3: "acts alone",
  human: "people only",
};

export const levelLabel = (level: TrustLevel): string => LEVELS[level];

/** "model:gemini-x" → "the model gemini-x", "route:deep" → "the deep route". */
export function subjectLabel(subject: string): string {
  if (subject === "route:deep") return "the deep route";
  if (subject.startsWith("model:")) return `the model ${subject.slice(6)}`;
  return subject;
}

/** The demotion rules in a sentence. */
export function rulesLine(rules: TrustRules): string {
  const ceiling = Math.round(rules.deepErrorCeiling * 100);
  return (
    `A model is demoted when its judged faithfulness falls below ${rules.faithfulnessFloor} ` +
    `over its last ${rules.judgedWindow} judged answers (given ${rules.judgedMinimum}); ` +
    `the deep route when more than ${ceiling} % of its last ${rules.deepWindow} answers failed.`
  );
}

/** What needs a person, in a sentence, or null when nothing does. */
export function trustAlert(trust: AssistantHealth["trust"]): string | null {
  if (!trust) return null;
  const parts: string[] = [];
  if (trust.alerts) parts.push(trust.alerts === 1 ? "1 alert" : `${trust.alerts} alerts`);
  if (trust.demoted.length === 1)
    parts.push(`${subjectLabel(trust.demoted[0]!.subject)} is demoted`);
  else if (trust.demoted.length > 1) parts.push(`${trust.demoted.length} demotions`);
  return parts.length ? `${parts.join(" and ")}: see the Trust tab` : null;
}

const ACTIONS: Partial<Record<string, string>> = {
  "trust.check": "trust check",
  demote: "demotion",
  reinstate: "reinstated",
  answer: "answer",
  "run.spend": "run stopped",
  "settings.update": "settings changed",
};

/** An audit row's action in words. */
export const actionLabel = (row: Pick<AuditRow, "action" | "decision">): string => {
  const label = ACTIONS[row.action] ?? row.action;
  return row.action === "demote" && row.decision === "denied" ? "demotion refused" : label;
};
