import { describe, expect, it } from "vitest";

import type { AppContent } from "../content/schema";
import { ASK_COPY } from "./ask-copy";
import type { AnswerMetadata, AnswerReceipt } from "./ask-types";
import {
  counted,
  duration,
  failoverLine,
  pageTitle,
  receiptAlways,
  receiptClauses,
  sourceFacts,
  toolStep,
} from "./receipt";

const en = ASK_COPY.en;
const PLAIN: AnswerReceipt = { lookups: 2, sources: 3, removed: 0 };

function line(receipt: Partial<AnswerReceipt>, meta: AnswerMetadata = {}, context = {}): string {
  return receiptClauses(
    { route: "lite", ...meta, receipt: { ...PLAIN, ...receipt } },
    en.receipt,
    context,
  ).join(" · ");
}

describe("the receipt line (visitor plan V12)", () => {
  it("counts in words: none, one and many", () => {
    expect(counted(0, en.receipt.lookups)).toBe("no lookups");
    expect(counted(1, en.receipt.lookups)).toBe("1 lookup");
    expect(counted(4, en.receipt.sources)).toBe("4 sources checked");
  });

  it("reads an ordinary answer as its model, its lookups and its sources", () => {
    expect(line({})).toBe("fast model · 2 lookups · 3 sources checked");
    expect(line({ lookups: 0, sources: 0 }, { route: "deep" })).toBe(
      "thorough model · no lookups · nothing cited",
    );
    // An older server sent no receipt: nothing to read.
    expect(receiptClauses({ route: "lite" }, en.receipt)).toEqual([]);
    expect(receiptClauses(undefined, en.receipt)).toEqual([]);
  });

  it("says each thing that makes it show by itself", () => {
    expect(line({ removed: 1 })).toBe(
      "fast model · 2 lookups · 3 sources checked · 1 invented reference removed",
    );
    expect(line({ escalation: "projects-fetched" }, { route: "deep" })).toBe(
      "moved to the thorough model: it read two projects · 2 lookups · 3 sources checked",
    );
    expect(line({ careful: "compensation" })).toContain("careful topic: published facts only");
    // The topic itself is never named on the line.
    expect(line({ careful: "compensation" })).not.toContain("compensation");
    expect(line({ repair: { reason: "no-words", by: "model" } })).toContain(
      "repaired: the first try had no words",
    );
    expect(line({ repair: { reason: "echo", by: "fixed-line" } })).toContain(
      "closed with a fixed line: no model had words",
    );
    for (const receipt of [
      { careful: "health" },
      { removed: 2 },
      { repair: { reason: "stub", by: "model" } },
      { escalation: "search-spans-projects" },
    ] as Partial<AnswerReceipt>[]) {
      expect(receiptAlways({ ...PLAIN, ...receipt }), JSON.stringify(receipt)).toBe(true);
    }
    expect(receiptAlways(PLAIN)).toBe(false);
    expect(receiptAlways({ ...PLAIN, page: "project:atlas@en", level: "plain" })).toBe(false);
    expect(receiptAlways(undefined)).toBe(false);
  });

  it("counts a match's rows, and shows by itself when the check took one back (visitor plan V20)", () => {
    expect(line({ match: { kind: "role", rows: 5, downgraded: 0 } })).toContain("5 rows");
    expect(line({ match: { kind: "role", rows: 5, downgraded: 2 } })).toContain(
      "5 rows, 2 taken back by the check",
    );
    expect(receiptAlways({ ...PLAIN, match: { kind: "role", rows: 5, downgraded: 0 } })).toBe(
      false,
    );
    expect(receiptAlways({ ...PLAIN, match: { kind: "role", rows: 5, downgraded: 1 } })).toBe(true);
  });

  it("names the page, what was pointed at and the level", () => {
    expect(line({ page: "project:atlas@en" }, {}, { pageTitle: "Atlas" })).toContain("page: Atlas");
    // Without the site's name for it, its id.
    expect(line({ page: "post:gone@en" })).toContain("page: post:gone@en");
    const about = {
      focus: { kind: "section" as const, id: "architecture" },
      label: "Architecture",
    };
    expect(line({ focus: { kind: "section", verified: true } }, {}, { about })).toContain(
      "section: Architecture",
    );
    expect(line({ focus: { kind: "section", verified: true } })).toContain(" · section");
    expect(line({ focus: { kind: "code", verified: false } })).toContain(
      "code block not found on the page",
    );
    // A selection is named by what it is, never by the visitor's words again.
    const quoted = { focus: { kind: "selection" as const, text: "a demo" }, label: "“a demo”" };
    expect(line({ focus: { kind: "selection", verified: true } }, {}, { about: quoted })).toContain(
      "selection quoted from the page",
    );
    expect(
      line({ focus: { kind: "selection", verified: true } }, {}, { about: quoted }),
    ).not.toContain("a demo");
    expect(line({ focus: { kind: "selection", verified: false } })).toContain(
      "selection not found on the page: read as your words",
    );
    expect(line({ level: "plain" })).toContain("level: plain");
  });

  it("shows only the fields it lists: an unknown field or code never reaches the line", () => {
    const odd = {
      ...PLAIN,
      escalation: "toString",
      repair: { reason: "constructor", by: "model" },
      focus: { kind: "__proto__", verified: true },
      level: "hacker",
      extra: "UNLISTED-FIELD",
    } as unknown as AnswerReceipt;
    expect(receiptClauses({ route: "lite", receipt: odd }, en.receipt)).toEqual([
      "fast model",
      "2 lookups",
      "3 sources checked",
    ]);
  });

  it("speaks German on a German page", () => {
    const words = receiptClauses(
      { route: "lite", receipt: { ...PLAIN, removed: 2, careful: "contract" } },
      ASK_COPY.de.receipt,
    );
    expect(words).toEqual([
      "schnelles Modell",
      "2 Abfragen",
      "3 Quellen geprüft",
      "2 erfundene Verweise entfernt",
      "heikles Thema: nur veröffentlichte Fakten",
    ]);
  });
});

describe("duration", () => {
  it("prints milliseconds under a second, seconds with one decimal above", () => {
    expect(duration(12, "en")).toBe("12 ms");
    expect(duration(1420, "en")).toBe("1.4 s");
    expect(duration(1420, "de")).toBe("1,4 s");
  });
});

describe("pageTitle", () => {
  const content = {
    projects: [{ slug: "atlas", name: "Atlas" }],
    posts: [{ slug: "evals-first", title: "Evals first" }],
  } as unknown as AppContent;

  it("names a case study or post by the site's own name for it", () => {
    expect(pageTitle("project:atlas@en", content)).toBe("Atlas");
    expect(pageTitle("post:evals-first@de", content)).toBe("Evals first");
    expect(pageTitle("project:gone@en", content)).toBeNull();
    expect(pageTitle("profile@en", content)).toBeNull();
  });
});

describe("a step of the trace (plan 4 U11)", () => {
  const content = {
    projects: [{ slug: "atlas", name: "Atlas" }],
    posts: [],
    experiences: [{ id: "acme", org: { name: "Acme" } }],
  } as unknown as AppContent;
  const step = (name: string, input = {}, copy = en.trace) => toolStep(name, input, copy, content);

  it("says what each call did, in plain words", () => {
    expect(step("search_portfolio", { query: "RAG" })).toBe("Searched “RAG”");
    expect(step("list_projects")).toBe("Listed the projects");
    expect(step("list_projects", { text: "RAG" })).toBe("Listed the projects about “RAG”");
    expect(step("get_resume")).toBe("Read the CV");
    expect(step("navigate", { to: "/en/work/atlas" })).toBe("Opened /en/work/atlas");
  });

  it("names what it read: a page, an entry's organisation, its kind, or else the id", () => {
    expect(step("get_document", { id: "project:atlas@en" })).toBe("Read Atlas");
    expect(step("get_document", { id: "experience:acme@en" })).toBe("Read Acme");
    expect(step("get_document", { id: "experience:gone@en" })).toBe("Read an experience entry");
    expect(step("get_document", { id: "system-card@en" })).toBe("Read the system card");
    expect(step("get_document", { id: "faq:3@en" })).toBe("Read the FAQ");
    expect(step("get_document", { id: "constructor@en" })).toBe("Read constructor@en");
  });

  it("has no line for what shows elsewhere", () => {
    expect(step("suggest_followups")).toBeNull();
    expect(step("handoff_contact")).toBeNull();
  });

  it("speaks German on a German page", () => {
    const de = ASK_COPY.de.trace;
    expect(step("search_portfolio", { query: "RAG" }, de)).toBe("„RAG“ gesucht");
    expect(step("get_document", { id: "project:atlas@de" }, de)).toBe("Atlas gelesen");
    expect(step("get_resume", {}, de)).toBe("Lebenslauf gelesen");
  });
});

describe("a source's row (visitor plan V12)", () => {
  it("shows the month it last changed", () => {
    const facts = { portfolio: { kind: "project", updated: "2026-09-12" } };
    expect(sourceFacts(facts, "en", en)).toEqual({ updated: "updated Sep 2026" });
    expect(sourceFacts(facts, "de", ASK_COPY.de)).toEqual({ updated: "aktualisiert Sept. 2026" });
  });

  it("shows nothing it cannot read", () => {
    expect(sourceFacts(undefined, "en", en)).toEqual({ updated: null });
    expect(sourceFacts({ portfolio: { updated: "last week" } }, "en", en)).toEqual({
      updated: null,
    });
  });
});

describe("the failover line (visitor plan V12)", () => {
  it("says the first model is busy, then that the next one is too", () => {
    expect(failoverLine({ position: 2, of: 3 }, en.failover)).toBe(
      "the first model is busy, trying another (2 of 3)",
    );
    expect(failoverLine({ position: 3, of: 3 }, en.failover)).toBe(
      "that one is busy too, trying another (3 of 3)",
    );
    expect(failoverLine({ position: 2, of: 2 }, ASK_COPY.de.failover)).toBe(
      "das erste Modell ist ausgelastet, ich versuche ein anderes (2 von 2)",
    );
  });
});
