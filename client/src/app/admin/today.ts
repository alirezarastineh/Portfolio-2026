import type { MediaReconcile, MessageRow } from "./admin-api.service";
import { isOpen, type Proposal } from "./agent";
import type { ReviewQueue } from "./assistant-types";
import { isOpenProposal, type FaqProposal } from "./faq-proposals";
import type { JournalView } from "./journal";
import type { LessonsView } from "./lessons";
import { typedAt } from "./recovery.service";
import { relativeTime } from "./relative-time";

/** One thing that waits for you: words, when, and the one place that settles it. */
export interface TodayRow {
  words: string;
  /** A value: "1 hour ago", "22:14", "2026-W40"; empty when it has none. */
  when: string;
  /** Where the row leads, as a word. */
  action: string;
  link: string;
  query?: Record<string, string>;
  /** A sign beside the words: it costs your account (warn) or a visitor (error) now. */
  sign?: "warn" | "error";
}

/** What Today knows; null where a source has not answered (no row, not a guess). */
export interface TodayFacts {
  totpOff: boolean;
  reconcile: MediaReconcile | null;
  /** The assistant's state in words (`assistantAlert`): the rail says the same. */
  alert: string | null;
  /** The alert is about trust (an alert or a demotion): the Trust tab settles it. */
  trust: boolean;
  messages: MessageRow[] | null;
  /** The newest copy of each page kept in this browser, newest first. */
  copies: { page: string; href: string; at: number }[];
  reviews: ReviewQueue | null;
  proposals: Proposal[] | null;
  faq: FaqProposal[] | null;
  journal: JournalView | null;
  lessons: LessonsView | null;
}

/** "1 new message", "2 new messages". */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The newest one's time ("1 hour ago"): lists come newest first. */
const newest = (items: readonly { createdAt: string }[], now: number) =>
  items[0] ? relativeTime(items[0].createdAt, now) : "";

const assistant = (view: string) => ({ link: "/admin/assistant", query: { view } });

/**
 * Today's "Needs you", ordered by what ignoring a row costs: your account, then what a
 * visitor meets now (broken images, failing answers), a person waiting for a reply, your own
 * typed work, then the queues that wait for a decision. Each count is the one its screen shows.
 */
export function needsYou(facts: TodayFacts, now = Date.now()): TodayRow[] {
  const rows: TodayRow[] = [];
  const { reconcile, messages, reviews, proposals, faq, journal, lessons } = facts;

  if (facts.totpOff) {
    rows.push({
      words: "Two-factor authentication is off: your password alone signs in to this admin.",
      when: "",
      action: "Turn it on",
      link: "/admin/account",
      sign: "warn",
    });
  }
  if (reconcile && (reconcile.missingFiles.length || reconcile.orphanFiles.length)) {
    const parts = [
      reconcile.missingFiles.length
        ? count(reconcile.missingFiles.length, "record without a file", "records without a file")
        : "",
      reconcile.orphanFiles.length
        ? count(reconcile.orphanFiles.length, "file without a record", "files without a record")
        : "",
    ].filter(Boolean);
    rows.push({
      words: `Media and database are out of step: ${parts.join(", ")}.`,
      when: "",
      action: "Media",
      link: "/admin/media",
      sign: "error",
    });
  }
  if (facts.alert) {
    rows.push({
      words: facts.alert,
      when: "",
      ...(facts.trust
        ? { action: "Trust", ...assistant("trust") }
        : { action: "Assistant", link: "/admin/assistant" }),
      sign: "error",
    });
  }
  const fresh = (messages ?? []).filter((m) => m.status === "new");
  if (fresh.length) {
    rows.push({
      words: count(fresh.length, "new message", "new messages"),
      when: newest(fresh, now),
      action: "Inbox",
      link: "/admin/inbox",
      query: { filter: "new" },
    });
  }
  for (const copy of facts.copies) {
    rows.push({
      words: `Unsaved edits in ${copy.page}, kept in this browser`,
      when: typedAt(copy.at),
      action: "Open",
      link: copy.href,
    });
  }
  // The Reviews tab's own sum: "1 of 3 reviewed".
  const unreviewed = reviews ? Math.max(0, reviews.stats.queued - reviews.stats.reviewed) : 0;
  if (reviews && unreviewed) {
    rows.push({
      words: `${unreviewed} of ${count(reviews.stats.queued, "answer", "answers")} still to review this week`,
      when: reviews.week,
      action: "Reviews",
      ...assistant("reviews"),
    });
  }
  const drafts = (proposals ?? []).filter(isOpen);
  if (drafts.length) {
    rows.push({
      words: count(drafts.length, "draft from the content agent", "drafts from the content agent"),
      when: newest(drafts, now),
      action: "Content agent",
      link: "/admin/agent",
    });
  }
  const faqOpen = (faq ?? []).filter(isOpenProposal);
  if (faqOpen.length) {
    rows.push({
      words: count(faqOpen.length, "FAQ proposal", "FAQ proposals"),
      when: newest(faqOpen, now),
      action: "FAQ",
      ...assistant("faq"),
    });
  }
  // The Journal tab's counts ("Proposed 1"); the newest of each, by its status.
  if (journal?.counts.proposed) {
    rows.push({
      words: count(journal.counts.proposed, "journal entry proposed", "journal entries proposed"),
      when: newest(
        journal.entries.filter((e) => e.status === "proposed"),
        now,
      ),
      action: "Journal",
      ...assistant("journal"),
    });
  }
  if (lessons?.counts.proposed) {
    rows.push({
      words: count(lessons.counts.proposed, "lesson proposed", "lessons proposed"),
      when: newest(
        lessons.lessons.filter((l) => l.status === "proposed"),
        now,
      ),
      action: "Journal",
      ...assistant("journal"),
    });
  }
  return rows;
}

/**
 * A row of Today's lists: words, when, the action; two lines on a phone. One link or button,
 * so the whole row is the target. Shared by Needs you and Before launch.
 */
export const TODAY_ROW =
  "grid w-full min-h-9 grid-cols-[minmax(0,1fr)_9rem_6.5rem] items-center gap-x-4 border-b border-border py-1.5 pl-3 pr-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:-outline-offset-2 pointer-coarse:min-h-11 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-y-0.5 max-sm:py-2";
