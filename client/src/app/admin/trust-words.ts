import { apiWords } from "./api-words";
import { changeWords } from "./assistant-settings";
import type { AuditRow, TrustEntry } from "./assistant-types";
import { featureLabel } from "./spending";
import { subjectLabel } from "./trust";

/**
 * Trust's rules in words (plan 5, U19): who may do what, and the audit log, as Settings shows them.
 * The registry's own text, code paths and all, stays the server's: "Show where it is enforced"
 * reads it whole. Apart from `trust.ts`, which the layout's pulse loads, so these words load with
 * the Assistant only.
 */

/** What each registered action does, by its name in the registry (`server/src/ask/trust.ts`). */
const ACTIONS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    search_portfolio: "Searches the published portfolio",
    get_document: "Reads a published document",
    list_projects: "Lists the published projects",
    get_resume: "Fetches the published CV",
    suggest_followups: "Suggests follow-up questions",
    navigate: "Opens a page of this site",
    handoff_contact: "Hands the visitor to the contact form",
    "ask.forget": "Forgets the visitor's conversation, after their yes",
    "answer.repair": "Repairs an answer that came out empty or broken",
    "tour.plan": "Plans a tour of the site",
    "match.plan": "Lists what to check in a brief, for Match a brief",
    "match.synthesize": "Writes a match's rows from the published work",
    "copilot.suggest": "Drafts a field's text in an editor",
    "insights.summarize": "Groups visitor questions into topics",
    "run.eval": "Runs the evals",
    "run.pairwise": "Compares two answerers",
    "run.judge": "Judges reviewed visitor answers",
    "trust.demote": "Takes a model or the deep route out of the visitors' service",
    "embeddings.backfill": "Embeds the published content, for search by meaning",
    "corpus.tiers": "Suggests which documents the assistant reads first",
    "journal.diagnose": "Diagnoses a failed answer",
    "journal.replay": "Replays a failed answer's question on both chains",
    "insights.auto": "Runs insights by itself when failures rise",
    "lesson.propose": "Proposes a lesson from the journal",
    "judge.nightly": "Judges the day's visitor answers at night",
    "lesson.retire": "Retires a lesson that stopped helping",
    "agent.propose": "Drafts changes to the content",
    "agent.apply": "Applies a content draft you accepted",
    "faq.propose": "Drafts an FAQ proposal",
    "webmcp.list_pages": "Lists the published pages",
    "webmcp.open_page": "Opens a page of this site in the visitor's tab",
    "webmcp.ask_portfolio": "Asks the assistant a question, as the visitor",
    "webmcp.match_brief": "Matches a brief, as the visitor",
    "webmcp.contact": "Fills the contact form; the visitor sends it",
    publish: "Publishes the draft",
  }),
);

/**
 * An action in words. An outside agent's MCP tools are the assistant's reads.
 * shortcut: an action the server adds later shows its name until it gets words here.
 */
export function actionWords(action: string): string {
  const own = action.startsWith("mcp.") ? action.slice(4) : action;
  return ACTIONS.get(own) ?? action;
}

const ACTORS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    assistant: "The visitors' assistant",
    visitor: "The visitor",
    system: "The server",
    copilot: "The copilot",
    insights: "Insights",
    run: "A run you start",
    agent: "An agent",
    admin: "You",
  }),
);

/** Who acts: an outside agent says how it reaches the site. */
export function actorWords(entry: Pick<TrustEntry, "action" | "actor">): string {
  if (entry.actor === "external") {
    return entry.action.startsWith("webmcp.")
      ? "The visitor's browser agent"
      : "An outside agent, over MCP";
  }
  return ACTORS.get(entry.actor) ?? entry.actor;
}

const APPROVERS: Record<TrustEntry["approver"], string> = {
  none: "Nobody",
  visitor: "The visitor",
  admin: "You",
};

export const approverWords = (approver: TrustEntry["approver"]): string => APPROVERS[approver];

/** What an audit row records, as a sentence's start ("Changed the settings"). */
const DONE: ReadonlyMap<string, string> = new Map(
  Object.entries({
    "settings.update": "Changed the settings",
    "trust.check": "Ran the trust check",
    demote: "Took out of the visitors' service",
    reinstate: "Put back in the visitors' service",
    answer: "Flagged an answer",
    "run.spend": "Stopped a paid run",
    "agent.apply": "Applied a content draft",
    "agent.reject": "Rejected a content draft",
    "agent.revert": "Reverted a content draft",
    "faq.accept": "Accepted an FAQ proposal",
    "faq.reject": "Rejected an FAQ proposal",
    "lesson.retire": "Retired a lesson",
    "learning.check": "Measured the lessons",
    "judge.nightly": "Ran the nightly judge",
    "corpus.tiers": "Changed what the assistant reads first",
  }),
);

/** An audit row's action in words, refused ones as such. */
export function auditAction(row: Pick<AuditRow, "action" | "decision">): string {
  if (row.decision === "denied") {
    if (row.action === "demote") {
      return "Kept in the visitors' service";
    }
    if (row.action === "judge.nightly") {
      return "Did not run the nightly judge";
    }
  }
  return DONE.get(row.action) ?? row.action;
}

/** Targets the action already names. */
const SELF = new Set(["settings", "trust", "learning", "corpus"]);

/**
 * What an audit row acted on: a model or a route in words, an id as itself (`id`, shown as a
 * value), or null when the action names it already.
 */
export function auditTarget(target: string): { text: string; id: boolean } | null {
  if (SELF.has(target)) {
    return null;
  }
  return /^(?:model|route|feature):/.test(target)
    ? { text: subjectLabel(target), id: false }
    : { text: target, id: true };
}

const OUTCOMES: Record<AuditRow["decision"], string> = {
  allowed: "Done",
  denied: "Refused",
  asked: "Asked",
};

export const outcomeWords = (decision: AuditRow["decision"]): string => OUTCOMES[decision];

/**
 * Why, in words: a settings row's "key before → after" (`fenceChanges`) and a stopped run's
 * "<feature> run stopped before <item>: <code>" (`runs/paid.ts`) are read; the rest is the
 * server's own sentence.
 */
export function auditReason(row: Pick<AuditRow, "action" | "reason">): string {
  if (row.action === "settings.update") {
    return row.reason
      .split("; ")
      .map((part) => settingChange(part) ?? part)
      .join("; ");
  }
  const stopped = /^(\w+) run stopped before (.+): ([a-z_]+)$/.exec(row.reason);
  if (row.action === "run.spend" && stopped) {
    const [, feature, item, code] = stopped;
    return `${featureLabel(feature)} stopped before ${item}. ${apiWords(code)}`;
  }
  return row.reason;
}

/** "featureCaps.eval null → 0.5" in words, or null when it is not one of those. */
function settingChange(part: string): string | null {
  const change = /^(\S+) (.+) → (.+)$/.exec(part);
  if (!change) {
    return null;
  }
  const [, key, before, after] = change;
  try {
    return changeWords(key, JSON.parse(before), JSON.parse(after));
  } catch {
    return null;
  }
}
