import type { Locale } from "../content/locale";
import { formatMonth } from "../content/period";
import type { AppContent } from "../content/schema";
import { fmt } from "../i18n/interpolate";
import type { AskCopy, Counted } from "./ask-copy";
import type { AskAbout } from "./ask-launcher.service";
import type { AnswerMetadata, AnswerReceipt, FailoverStatus } from "./ask-types";

/**
 * The answer's receipt, its trace's steps, its sources' rows and the failover line (visitor
 * plan V12), from what the server sends: the receipt's counts and codes, each
 * source's kind and date, the transient status. Only the fields named below
 * are ever read, so whatever a newer server adds stays off the screen until
 * this code names it.
 */

/** A record's own value for a key the server sent, never one from its prototype. */
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** A count in its words. */
export function counted(n: number, forms: Counted): string {
  if (n === 0) return forms.none;
  return n === 1 ? forms.one : fmt(forms.many, { n });
}

/**
 * Whether the receipt shows without being asked for: on a careful topic,
 * after a removed reference, a repair, a move to the thorough model, or a
 * match row the check took back (visitor plan V20). Otherwise it waits
 * behind `stats` or "how was this answered?".
 */
export function receiptAlways(receipt: AnswerReceipt | undefined): boolean {
  return (
    !!receipt &&
    (!!receipt.careful ||
      receipt.removed > 0 ||
      !!receipt.repair ||
      !!receipt.escalation ||
      (receipt.match?.downgraded ?? 0) > 0)
  );
}

/** A match's clause (visitor plan V20): its rows, and those the check took back. */
function matchClause(receipt: AnswerReceipt, copy: AskCopy["receipt"]): string {
  const match = receipt.match;
  if (!match) return "";
  const rows = counted(match.rows, copy.match.rows);
  return match.downgraded > 0
    ? `${rows}, ${counted(match.downgraded, copy.match.downgraded)}`
    : rows;
}

/** The case study's or post's name for a page's document id (`project:atlas@en`), if the site has it. */
export function pageTitle(id: string, content: AppContent): string | null {
  const match = /^(project|post):([^@]+)@/.exec(id);
  if (!match) return null;
  const [, kind, slug] = match;
  if (kind === "project") return content.projects.find((p) => p.slug === slug)?.name ?? null;
  return content.posts.find((p) => p.slug === slug)?.title ?? null;
}

/** What a lookup read: a page's title, an entry's organisation, else its kind in words. */
function documentName(id: string, content: AppContent, docs: AskCopy["trace"]["docs"]): string {
  const page = pageTitle(id, content);
  if (page) return page;
  const [, kind = "", key] = /^([a-z-]+)(?::([^@]+))?@/.exec(id) ?? [];
  const org = kind === "experience" && content.experiences.find((e) => e.id === key)?.org.name;
  return org || (own(docs, kind) ?? id);
}

/**
 * A tool call as a line of the answer's trace (plan 4 U11), in plain words; none for what has its
 * own place on screen (follow-ups, the hand-off). `inspect` keeps the calls themselves.
 */
export function toolStep(
  name: string,
  input: Record<string, unknown>,
  copy: AskCopy["trace"],
  content: AppContent,
): string | null {
  const str = (key: string) => (typeof input[key] === "string" ? input[key] : "");
  switch (name) {
    case "search_portfolio":
      return fmt(copy.search, { q: str("query") });
    case "get_document":
      return fmt(copy.read, { title: documentName(str("id"), content, copy.docs) });
    case "list_projects": {
      const q = str("text");
      return q ? fmt(copy.listAbout, { q }) : copy.list;
    }
    case "get_resume":
      return fmt(copy.read, { title: copy.docs.cv });
    case "navigate":
      return fmt(copy.open, { to: str("to") });
    default:
      return null;
  }
}

/** Which model answered: the move to the thorough one and why, or the route it took. */
function modelClause(meta: AnswerMetadata, copy: AskCopy["receipt"]): string {
  const why = meta.receipt?.escalation ? own(copy.escalation, meta.receipt.escalation) : undefined;
  if (why) return fmt(copy.escalated, { why });
  if (!meta.route) return "";
  return meta.route === "deep" ? copy.thorough : copy.fast;
}

/**
 * What the visitor pointed at: a section or code block by the label their
 * question showed, a selection by what it is (never by their words again),
 * and anything the page lacks as not found.
 */
function focusClause(
  focus: AnswerReceipt["focus"],
  copy: AskCopy["receipt"],
  label: string | undefined,
): string {
  if (!focus) return "";
  if (!focus.verified) return own(copy.focusMissing, focus.kind) ?? "";
  if (focus.kind === "selection") return copy.focus.selection;
  const said = own(copy.focus, focus.kind);
  if (!said) return "";
  return label ? fmt(said, { label }) : said.replace(/:? ?\{label\}/, "");
}

function repairClause(repair: AnswerReceipt["repair"], copy: AskCopy["receipt"]): string {
  if (!repair) return "";
  return repair.by === "fixed-line" ? copy.repair.fixed : (own(copy.repair, repair.reason) ?? "");
}

/** The receipt line's clauses, in the order it reads them; none without a receipt. */
export function receiptClauses(
  meta: AnswerMetadata | undefined,
  copy: AskCopy["receipt"],
  context: { pageTitle?: string | null; about?: AskAbout } = {},
): string[] {
  const receipt = meta?.receipt;
  if (!receipt) return [];
  const level = receipt.level === "plain" || receipt.level === "expert" ? receipt.level : null;
  return [
    modelClause(meta, copy),
    counted(receipt.lookups, copy.lookups),
    counted(receipt.sources, copy.sources),
    receipt.removed > 0 ? counted(receipt.removed, copy.removed) : "",
    receipt.careful ? copy.careful : "",
    receipt.page ? fmt(copy.page, { title: context.pageTitle ?? receipt.page }) : "",
    focusClause(receipt.focus, copy, context.about?.label),
    level ? fmt(copy.level, { level }) : "",
    repairClause(receipt.repair, copy),
    matchClause(receipt, copy),
  ].filter(Boolean);
}

/** The words while a failover keeps the visitor waiting: the second model, then any after it. */
export function failoverLine(
  status: Pick<FailoverStatus, "position" | "of">,
  copy: AskCopy["failover"],
): string {
  return fmt(status.position <= 2 ? copy.first : copy.next, {
    position: status.position,
    of: status.of,
  });
}

/** What a source's row adds to its title: the month it last changed. */
export function sourceFacts(
  providerMetadata: unknown,
  locale: Locale,
  copy: Pick<AskCopy, "updated">,
): { updated: string | null } {
  const facts = (providerMetadata as { portfolio?: { updated?: unknown } } | null)?.portfolio;
  const date = typeof facts?.updated === "string" ? facts.updated : "";
  return {
    updated: /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? fmt(copy.updated, { date: formatMonth(date, locale) })
      : null,
  };
}
