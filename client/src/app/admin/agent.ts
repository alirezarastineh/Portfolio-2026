import type { Locale } from "../content/schema";
import { apiWords } from "./api-words";
import type { RunRow } from "./assistant-types";
import { statusWord } from "./eval-runs";
import { REFUSALS } from "./journal";
import { relativeTime } from "./relative-time";

/**
 * The content agent as the Agent page reads it (plan phases 29–30): its runs,
 * its proposals and the admin's decisions on them. Pure, so the page stays thin.
 */

export const CONTENT_GOALS = ["translations", "alt", "seo"] as const;
export type ContentGoal = (typeof CONTENT_GOALS)[number];

export const GOAL_NAMES: Record<ContentGoal, string> = {
  translations: "Translations",
  alt: "Alt text",
  seo: "Search descriptions",
};

/** A content run's limits, as the server takes them (`ask/agent/content-work.ts`). */
export const RUN_LIMITS = {
  items: { min: 1, max: 100, default: 20 },
  usd: { min: 0.01, max: 1, default: 0.05 },
} as const;

export type ProposalStatus =
  "proposed" | "needs_you" | "accepted" | "rejected" | "applied" | "reverted" | "stale";

/** A draft for one gap in the content (`ai_proposals`), never written there until applied. */
export interface Proposal {
  id: string;
  createdAt: string;
  updatedAt: string;
  runId: string | null;
  goal: ContentGoal;
  kind: "section" | "project" | "experience" | "skill" | "post" | "media";
  entityId: string;
  field: string;
  locale: Locale;
  /** "Atlas · Hook (DE)". */
  label: string;
  before: string;
  /** Null when there is no draft (its notes say why). */
  after: string | null;
  skill: string;
  version: string;
  useId: string | null;
  flags: string[];
  notes: string[];
  status: ProposalStatus;
  decidedAt: string | null;
  appliedAt: string | null;
  revertedAt: string | null;
  /** Its field no longer holds `before`: applying it would turn it stale. */
  changed?: boolean;
}

/** A content run's summary (`content-work.ts` `summaryOf`). */
export interface ContentSummary {
  proposed: number;
  needsYou: number;
  stale: number;
}

const STATUS_NAMES: Record<ProposalStatus, string> = {
  proposed: "Proposed",
  needs_you: "Needs you",
  accepted: "Accepted",
  rejected: "Rejected",
  applied: "Applied",
  reverted: "Reverted",
  stale: "Stale",
};

export const statusName = (status: ProposalStatus): string => STATUS_NAMES[status];

/** Waiting for the admin: drafted, or drafted with a check still failing, or not drafted. */
export const isOpen = (p: Pick<Proposal, "status">): boolean =>
  p.status === "proposed" || p.status === "needs_you";

/** The filters the page offers, `open` first, and the statuses each asks the server for. */
export const PROPOSAL_FILTERS = [
  { id: "open", label: "Open", statuses: ["proposed", "needs_you"] },
  { id: "applied", label: "Applied", statuses: ["applied"] },
  { id: "rejected", label: "Rejected", statuses: ["rejected"] },
  { id: "reverted", label: "Reverted", statuses: ["reverted"] },
  { id: "stale", label: "Stale", statuses: ["stale"] },
  { id: "all", label: "All", statuses: [] },
] as const satisfies readonly {
  id: string;
  label: string;
  statuses: readonly ProposalStatus[];
}[];
export type ProposalFilter = (typeof PROPOSAL_FILTERS)[number]["id"];

/** The statuses a filter lists; none for all of them. */
export const filterStatuses = (filter: ProposalFilter): readonly ProposalStatus[] =>
  PROPOSAL_FILTERS.find((f) => f.id === filter)?.statuses ?? [];

/** The proposals a filter shows: the server lists them, and a decision made here moves one out. */
export function filterProposals(
  proposals: readonly Proposal[],
  filter: ProposalFilter,
): Proposal[] {
  if (filter === "all") {
    return [...proposals];
  }
  if (filter === "open") {
    return proposals.filter((p) => isOpen(p));
  }
  return proposals.filter((p) => p.status === filter);
}

/** What a proposal changes, and where: "Atlas" and "Hook (DE)" of "Atlas · Hook (DE)". */
export function splitLabel(label: string): { entity: string; field: string } {
  const at = label.lastIndexOf(" · ");
  return at < 0
    ? { entity: label, field: "" }
    : { entity: label.slice(0, at), field: label.slice(at + 3) };
}

/** Proposals grouped by what they change, in the order they come. */
export function groupProposals(
  proposals: readonly Proposal[],
): { entity: string; proposals: Proposal[] }[] {
  const groups = new Map<string, Proposal[]>();
  for (const proposal of proposals) {
    const { entity } = splitLabel(proposal.label);
    groups.set(entity, [...(groups.get(entity) ?? []), proposal]);
  }
  return [...groups].map(([entity, items]) => ({ entity, proposals: items }));
}

/** A content run, among the runs (`kind` agent, `task` content). */
export const isContentRun = (run: Pick<RunRow, "kind" | "params">): boolean =>
  run.kind === "agent" && run.params["task"] === "content";

/** Its summary's counts, when it has them (a run's summary is typed for the evals'). */
export function runSummary(run: { readonly summary: unknown }): ContentSummary | null {
  const s = run.summary;
  if (typeof s !== "object" || s === null || !("proposed" in s) || typeof s.proposed !== "number") {
    return null;
  }
  const needsYou = "needsYou" in s && typeof s.needsYou === "number" ? s.needsYou : 0;
  const stale = "stale" in s && typeof s.stale === "number" ? s.stale : 0;
  return { proposed: s.proposed, needsYou, stale };
}

/** "3 proposed, 1 needs you, 2 stale". */
export function summaryLine(summary: ContentSummary): string {
  const parts = [`${summary.proposed} proposed`, `${summary.needsYou} need you`];
  if (summary.stale) {
    parts.push(`${summary.stale} stale`);
  }
  return parts.join(", ");
}

/** A run's cost: cents, so four places under a dollar. */
export const runCost = (usd: number): string => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;

const LIST = new Intl.ListFormat("en-GB", { type: "conjunction" });
const upperFirst = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** A run's goals as the server stored them, the ones this page knows. */
function goalsOf(run: Pick<RunRow, "params">): ContentGoal[] {
  const stored: unknown = run.params["goals"];
  const list: unknown[] = Array.isArray(stored) ? stored : [];
  return list.flatMap((goal) => CONTENT_GOALS.find((known) => known === goal) ?? []);
}

/** "translations, alt text and search descriptions". */
export const goalsWords = (goals: readonly ContentGoal[]): string =>
  LIST.format(goals.map((goal) => GOAL_NAMES[goal].toLowerCase()));

/** A run in the runs' one vocabulary (`statusWord`): "Stopped: alt text, started 2 days ago." */
export function runLine(
  run: Pick<RunRow, "status" | "params" | "startedAt" | "createdAt">,
  now = Date.now(),
): string {
  const goals = goalsWords(goalsOf(run));
  const what = goals ? `${upperFirst(statusWord(run))}: ${goals}` : upperFirst(statusWord(run));
  const when = run.startedAt
    ? `started ${relativeTime(run.startedAt, now)}`
    : `asked ${relativeTime(run.createdAt, now)}`;
  return `${what}, ${when}.`;
}

/** "12 of 20 items, $0.0412: 12 proposed, 0 need you." */
export function itemsLine(
  run: Pick<RunRow, "progress" | "usd"> & { readonly summary: unknown },
): string {
  const { done, total } = run.progress;
  const summary = runSummary(run);
  const drafted = summary ? `: ${summaryLine(summary)}` : "";
  return `${done} of ${total} ${total === 1 ? "item" : "items"}, ${runCost(run.usd)}${drafted}.`;
}

/** Start's question: what a run drafts, and the limit it stops at. */
export function startQuestion(
  goals: readonly ContentGoal[],
  items: number,
  usd: number,
): { title: string; description: string } {
  return {
    title: `Draft up to ${items} ${items === 1 ? "item" : "items"}?`,
    description: `${upperFirst(goalsWords(goals))} for the content's gaps, as proposals you decide. The run stops at its limit, $${usd.toFixed(2)}, and spends under Admin agents' switch and cap (Settings, under Spending).`,
  };
}

/** Resume's question: the items left, and the run's own limit against what it spent. */
export function resumeWords(run: Pick<RunRow, "params" | "progress" | "usd">): string {
  const left = Math.max(0, run.progress.total - run.progress.done);
  const stored = run.params["maxUsd"];
  const limit = typeof stored === "number" ? stored : RUN_LIMITS.usd.default;
  const items = left === 1 ? "item left is" : "items left are";
  return `Its ${left} ${items} drafted. It stops at its limit, $${limit.toFixed(2)}, of which ${runCost(run.usd)} is spent, and spends under Admin agents' cap.`;
}

/** The server's refusals and errors on this page, in words. */
const AGENT_WORDS: Record<string, string> = {
  ...REFUSALS,
  nothing_to_do: "Nothing to draft: the content has no gaps for these goals.",
  no_chain: "The copilot has no model in this deploy.",
  stale: "Its field changed since the draft, so nothing was overwritten: it is stale now.",
  not_open: "It was decided already, here or in another tab.",
  no_text: "There is no draft: edit it and write the text first.",
  not_applied: "Only an applied proposal can be reverted.",
  changed_since: "Its field changed since it was applied: change it in its editor.",
  invalid_input: "The text does not fit the field.",
  not_found: "That proposal is gone.",
  failed: "It failed on the server and nothing was written: try it again.",
  // The request itself; the rest as everywhere (`api-words.ts`).
  http_404: "This API does not know the content agent yet: deploy the API first.",
};

export const agentWords = (code: string): string => AGENT_WORDS[code] ?? apiWords(code);

/** Why Apply is a stop on an open proposal: its field changed since the draft, or it has none. */
export function applyStop(p: Pick<Proposal, "changed" | "after">): string | null {
  if (p.changed) {
    return "Its field changed since the draft: it cannot be applied. Reject it, or write the field in its editor.";
  }
  return p.after === null ? agentWords("no_text") : null;
}

/** Why a run did not start, in words: its limits, when they are what the server refused. */
export const startWords = (code: string): string =>
  code === "invalid_input"
    ? `The run's limits are out of range: ${RUN_LIMITS.items.min}–${RUN_LIMITS.items.max} items, $${RUN_LIMITS.usd.min}–$${RUN_LIMITS.usd.max}.`
    : agentWords(code);

/** A run's cancel and resume refused (`runs/routes.ts`), in words. */
const RUN_WORDS: Record<string, string> = {
  not_found: "That run is gone.",
  not_cancellable: "That run has ended: there is nothing to cancel.",
  not_resumable: "That run cannot be resumed: only a failed, interrupted or cancelled one can.",
};

export const runWords = (code: string): string => RUN_WORDS[code] ?? agentWords(code);

/** A problem with a text, as the API sends it (a zod issue, its bounds included). */
export interface TextIssue {
  message: string;
  code?: string;
  maximum?: unknown;
  minimum?: unknown;
}

/**
 * Why the field refused a text, in words: its length, or what it must keep
 * (a site-copy leaf's token: "must contain {i}").
 */
export function textWords(issues: readonly TextIssue[] | undefined): string {
  const issue = issues?.[0];
  const refused = "The text does not fit the field";
  if (!issue) {
    return `${refused}.`;
  }
  if (issue.code === "too_big" && typeof issue.maximum === "number") {
    return `${refused}: at most ${issue.maximum} characters.`;
  }
  if (issue.code === "too_small" && typeof issue.minimum === "number") {
    return `${refused}: at least ${issue.minimum} ${issue.minimum === 1 ? "character" : "characters"}.`;
  }
  return `${refused}: ${issue.message.replace(/\.$/, "")}.`;
}

/** A field's text as a reader sees it: tags out, the common entities decoded. */
export function plainText(value: string): string {
  return value
    .replaceAll(/<[^<>]{0,1000}>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/g, " ")
    .trim();
}
