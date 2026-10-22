import { describe, expect, it } from "vitest";

import type { AppContent } from "../content/schema";
import { ASK_COPY } from "./ask-copy";
import type { AnswerMetadata, AnswerReceipt } from "./ask-types";
import {
  counted,
  failoverLine,
  pageTitle,
  receiptAlways,
  receiptClauses,
  sourceFacts,
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

describe("a source's chip (visitor plan V12)", () => {
  it("shows its kind as a glyph and the month it last changed", () => {
    const facts = { portfolio: { kind: "project", updated: "2026-09-12" } };
    expect(sourceFacts(facts, "en", en)).toEqual({ glyph: "◆", updated: "updated Sep 2026" });
    expect(sourceFacts(facts, "de", ASK_COPY.de)).toEqual({
      glyph: "◆",
      updated: "aktualisiert Sept. 2026",
    });
    expect(sourceFacts({ portfolio: { kind: "post" } }, "en", en)).toEqual({
      glyph: "¶",
      updated: null,
    });
  });

  it("shows nothing it cannot read", () => {
    expect(sourceFacts(undefined, "en", en)).toEqual({ glyph: null, updated: null });
    expect(
      sourceFacts({ portfolio: { kind: "constructor", updated: "last week" } }, "en", en),
    ).toEqual({ glyph: null, updated: null });
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
