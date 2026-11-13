import { describe, expect, it } from "vitest";

import type { MessageRow } from "./admin-api.service";
import type { Proposal } from "./agent";
import type { ReviewQueue } from "./assistant-types";
import type { FaqProposal } from "./faq-proposals";
import type { JournalView } from "./journal";
import type { LessonsView } from "./lessons";
import { needsYou, type TodayFacts } from "./today";

const HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString();

const mail = (status: MessageRow["status"]) => ({ status, createdAt: HOUR_AGO }) as MessageRow;
const proposal = (status: Proposal["status"]) => ({ status, createdAt: HOUR_AGO }) as Proposal;
const faq = (status: FaqProposal["status"]) => ({ status, createdAt: HOUR_AGO }) as FaqProposal;
const reviews = (queued: number, reviewed: number) =>
  ({ week: "2026-W40", stats: { answers: 12, queued, reviewed } }) as ReviewQueue;

/** Nothing waits anywhere, every source answered. */
const NONE: TodayFacts = {
  totpOff: false,
  reconcile: { missingFiles: [], orphanFiles: [], totalAssets: 0, totalBytes: 0 },
  alert: null,
  trust: false,
  messages: [mail("read")],
  copies: [],
  reviews: reviews(0, 0),
  proposals: [],
  faq: [],
  journal: { entries: [], counts: { proposed: 0, accepted: 0, fixed: 0, retired: 0 } },
  lessons: { lessons: [], counts: { proposed: 0, active: 0, retired: 0 } },
};

/** Something in every queue. */
const ALL: TodayFacts = {
  totpOff: true,
  reconcile: {
    missingFiles: ["a.webp", "b.webp"],
    orphanFiles: ["c.webp"],
    totalAssets: 3,
    totalBytes: 1,
  },
  alert: "1 alert: see the Trust tab",
  trust: true,
  messages: [mail("new"), mail("spam"), mail("new"), mail("read")],
  copies: [{ page: "About", href: "/admin/about", at: Date.now() }],
  reviews: reviews(3, 1),
  proposals: [proposal("proposed"), proposal("needs_you"), proposal("applied")],
  faq: [faq("proposed"), faq("accepted")],
  journal: {
    entries: [{ status: "proposed", createdAt: HOUR_AGO }] as JournalView["entries"],
    counts: { proposed: 1, accepted: 2, fixed: 0, retired: 0 },
  },
  lessons: {
    lessons: [{ status: "proposed", createdAt: HOUR_AGO }] as LessonsView["lessons"],
    counts: { proposed: 1, active: 1, retired: 0 },
  },
};

describe("Today's Needs you", () => {
  it("lists nothing when nothing waits", () => {
    expect(needsYou(NONE)).toEqual([]);
  });

  it("orders the rows by what ignoring them costs, two-factor first", () => {
    expect(needsYou(ALL).map((row) => row.action)).toEqual([
      "Turn it on",
      "Media",
      "Trust",
      "Inbox",
      "Open",
      "Reviews",
      "Content agent",
      "FAQ",
      "Journal",
      "Journal",
    ]);
  });

  it("counts what each queue's own screen counts, in words", () => {
    expect(needsYou(ALL).map((row) => row.words)).toEqual([
      "Two-factor authentication is off: your password alone signs in to this admin.",
      "Media and database are out of step: 2 records without a file, 1 file without a record.",
      "1 alert: see the Trust tab",
      "2 new messages",
      "Unsaved edits in About, kept in this browser",
      "2 of 3 answers still to review this week",
      "2 drafts from the content agent",
      "1 FAQ proposal",
      "1 journal entry proposed",
      "1 lesson proposed",
    ]);
  });

  it("links each row to the screen that settles it", () => {
    const links = needsYou(ALL).map((row) => [row.link, row.query ?? null]);
    expect(links).toEqual([
      ["/admin/account", null],
      ["/admin/media", null],
      ["/admin/assistant", { view: "trust" }],
      ["/admin/inbox", { filter: "new" }],
      ["/admin/about", null],
      ["/admin/assistant", { view: "reviews" }],
      ["/admin/agent", null],
      ["/admin/assistant", { view: "faq" }],
      ["/admin/assistant", { view: "journal" }],
      ["/admin/assistant", { view: "journal" }],
    ]);
  });

  it("says one as one, and sends a failing model to the Overview", () => {
    const rows = needsYou({
      ...NONE,
      alert: "A model is failing: its breaker is open",
      messages: [mail("new")],
      reviews: reviews(1, 0),
      proposals: [proposal("needs_you")],
      reconcile: { missingFiles: ["a.webp"], orphanFiles: [], totalAssets: 1, totalBytes: 1 },
    });
    expect(rows.map((row) => row.words)).toEqual([
      "Media and database are out of step: 1 record without a file.",
      "A model is failing: its breaker is open",
      "1 new message",
      "1 of 1 answer still to review this week",
      "1 draft from the content agent",
    ]);
    expect(rows[1]).toMatchObject({ action: "Assistant", link: "/admin/assistant" });
    expect(rows[1]!.query).toBeUndefined();
  });

  it("leaves out a source that has not answered rather than guessing", () => {
    expect(
      needsYou({ ...NONE, messages: null, reviews: null, journal: null, lessons: null }),
    ).toEqual([]);
  });
});
