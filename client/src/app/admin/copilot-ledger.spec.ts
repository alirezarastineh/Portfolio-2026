import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiService } from "./admin-api.service";
import { classify, CopilotLedger, MAX_WORD_PAIRS, sharedWords, wordsOf } from "./copilot-ledger";
import type { DraftVerdict } from "./copilot-skills";

const words = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("a draft's verdict (plan phase 27)", () => {
  it("counts words as the server does, whitespace aside", () => {
    expect(wordsOf("  Atlas,\nretrieval\tover   2 M docs ")).toEqual([
      "Atlas,",
      "retrieval",
      "over",
      "2",
      "M",
      "docs",
    ]);
    expect(wordsOf("   ")).toEqual([]);
  });

  it("keeps a draft saved with the same words, whatever the spacing", () => {
    expect(
      classify("Atlas: retrieval over 2 M documents.", "  Atlas:  retrieval over\n2 M documents. "),
    ).toEqual({ outcome: "kept", distance: 0 });
  });

  it("calls a draft edited while at least half of its words survive in order", () => {
    expect(
      classify(
        "Atlas retrieves over two million documents.",
        "Atlas retrieves over 2 M documents.",
      ),
    ).toEqual({
      outcome: "edited",
      distance: 4,
    });
    // Text added around the draft keeps it.
    expect(
      classify("A retrieval system.", "Atlas. A retrieval system. Built with pgvector in 2024."),
    ).toMatchObject({ outcome: "edited" });
    // Exactly half kept: still edited.
    expect(classify("one two three four", "one two five six")).toEqual({
      outcome: "edited",
      distance: 4,
    });
  });

  it("calls a draft discarded when its field went back to what it held, however close they were", () => {
    // A light tighten, then Discard: the old text shares most of the draft's words.
    expect(classify("Short title 3", "Short title 1")).toMatchObject({ outcome: "edited" });
    expect(classify("Short title 3", "Short title 1", "Short title 1")).toEqual({
      outcome: "discarded",
      distance: 2,
    });
    // Saved as the draft: kept, whatever the field held before.
    expect(classify("Short title 3", "Short title 3", "Short title 1")).toEqual({
      outcome: "kept",
      distance: 0,
    });
    // Edited into something new: judged on its words.
    expect(classify("Short title 3", "Short title three", "Short title 1")).toMatchObject({
      outcome: "edited",
    });
  });

  it("calls a draft discarded when most of it went, or the field was emptied", () => {
    expect(classify("one two three four", "one five six seven")).toMatchObject({
      outcome: "discarded",
    });
    expect(classify("A retrieval system over documents.", "Something else entirely here.")).toEqual(
      {
        outcome: "discarded",
        distance: 9,
      },
    );
    expect(classify("A retrieval system.", "")).toEqual({ outcome: "discarded", distance: 3 });
  });

  it("counts shared words in order, and only bounds them past the cap", () => {
    expect(sharedWords(["a", "b", "c", "d"], ["b", "a", "d", "c"])).toBe(2);
    expect(sharedWords([], ["a"])).toBe(0);
    // Past the cap (2,001 × 2,001 words), a multiset count: an upper bound.
    const big = words(2_001);
    expect(big.length * big.length).toBeGreaterThan(MAX_WORD_PAIRS);
    const reversed = [...big].reverse();
    expect(sharedWords(big, reversed)).toBe(2_001);
    // A reordered text the bound matches word for word is still an edit, never a 0-word one.
    expect(classify(big.join(" "), reversed.join(" "))).toEqual({ outcome: "edited", distance: 1 });
  });
});

describe("the ledger", () => {
  let reported: DraftVerdict[][];
  let ledger: CopilotLedger;
  let fail = false;

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    reported = [];
    fail = false;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        CopilotLedger,
        {
          provide: AdminApiService,
          useValue: {
            reportDrafts: async (outcomes: DraftVerdict[]) => {
              reported.push(outcomes);
              return fail
                ? { ok: false, error: "not_found", status: 404 }
                : { ok: true, data: { recorded: outcomes.length } };
            },
          },
        },
      ],
    });
    ledger = TestBed.inject(CopilotLedger);
  });

  it("judges a draft once, by what its field holds when it is settled", async () => {
    let field = "Atlas: retrieval over two million documents.";
    ledger.propose("seo:en", { suggestionId: "s1", text: field }, { read: () => field });
    field = "Atlas: retrieval over 2 M documents.";
    ledger.settle("seo:en");
    ledger.settle("seo:en");
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "edited", distance: 4 }]]);
    expect(ledger.has("seo:en")).toBe(false);
  });

  it("discards a draft whose field a discard put back", async () => {
    let field = "Hallo Welt!";
    const before = field;
    field = "Hallo Welt";
    ledger.propose("seo:de", { suggestionId: "s1", text: field }, { read: () => field, before });
    field = before; // the editor's Discard
    ledger.settle("seo:de");
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "discarded", distance: 2 }]]);
  });

  it("discards a draft replaced before a save, or never saved", async () => {
    ledger.propose("faq:en", { suggestionId: "s1", text: "First." }, { read: () => "First." });
    ledger.propose("faq:en", { suggestionId: "s2", text: "Second." }, { read: () => "Second." });
    ledger.propose("faq:de", { suggestionId: "s3", text: "Dritte." }, { read: () => "Dritte." });
    ledger.abandonPrefix("faq:");
    await tick();
    expect(reported).toEqual([
      [
        { id: "s1", outcome: "discarded", distance: null },
        { id: "s2", outcome: "discarded", distance: null },
        { id: "s3", outcome: "discarded", distance: null },
      ],
    ]);
  });

  it("judges a save's drafts by what it sent, in one request, and only its own fields'", async () => {
    let live = "typed while the save was on its way";
    ledger.propose(
      "media:alt:a:en",
      { suggestionId: "s1", text: "A diagram." },
      { read: () => live },
    );
    ledger.propose(
      "media:alt:a:de",
      { suggestionId: "s2", text: "Ein Diagramm." },
      { read: () => live },
    );
    ledger.propose(
      "media:describe:a:en",
      { suggestionId: "s3", text: "OCR → LLM" },
      { read: () => "x" },
    );
    const ended = ledger.beginSave({
      "media:alt:a:en": "A diagram.",
      "media:alt:a:de": "Ein Bild.",
    });
    live = "something else again";
    ended(true);
    await tick();
    expect(reported).toEqual([
      [
        { id: "s1", outcome: "kept" },
        { id: "s2", outcome: "edited", distance: 2 },
      ],
    ]);
    expect(ledger.has("media:describe:a:en")).toBe(true);
  });

  it("records which of several drafts was kept, and moves the judgment to the one the admin used", async () => {
    let field = "Outcome first.";
    const offered = {
      suggestionId: "s1",
      text: "Outcome first.",
      alternatives: [{ text: "Problem first." }, { text: "Stack first." }],
    };
    ledger.propose("seo:en", offered, { read: () => field });
    expect(ledger.waits("seo:en")).toBe(true);
    field = "Stack first.";
    ledger.use("seo:en", 2);
    ledger.settle("seo:en");
    ledger.propose("seo:de", offered, { read: () => "Outcome first, edited." });
    ledger.settle("seo:de");
    ledger.propose("seo:fr", offered, { read: () => "Something else entirely." });
    ledger.settle("seo:fr");
    await tick();
    expect(reported).toEqual([
      [
        { id: "s1", outcome: "kept", pick: 2 },
        { id: "s1", outcome: "edited", distance: 3, pick: 0 },
        { id: "s1", outcome: "discarded", distance: 5 },
      ],
    ]);
    expect(ledger.waits("seo:en")).toBe(false);
    // A single draft names no pick.
    ledger.propose("faq:en", { suggestionId: "s2", text: "Yes." }, { read: () => "Yes." });
    ledger.use("faq:en", 1);
    ledger.settle("faq:en");
    await tick();
    expect(reported[1]).toEqual([{ id: "s2", outcome: "kept" }]);
  });

  it("reports a draft that came back too late as discarded, and one without an id not at all", async () => {
    ledger.drop({ suggestionId: "s1" });
    ledger.drop({});
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "discarded", distance: null }]]);
  });

  it("keeps a save's drafts out of reach of a close until the save ends", async () => {
    ledger.propose(
      "faq:en",
      { suggestionId: "s1", text: "Yes, within the EU." },
      { read: () => "" },
    );
    const ended = ledger.beginSave({ "faq:en": "Yes, within the EU." });
    ledger.abandonPrefix("faq:"); // the form closed while the save was on its way
    await tick();
    expect(reported).toEqual([]);
    ended(true);
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "kept" }]]);
  });

  it("puts a draft back to wait when its save fails, unless a newer one took its field", async () => {
    ledger.propose("faq:en", { suggestionId: "s1", text: "First." }, { read: () => "First." });
    const failed = ledger.beginSave({ "faq:en": "First." });
    failed(false);
    expect(ledger.has("faq:en")).toBe(true);

    const again = ledger.beginSave({ "faq:en": "First." });
    ledger.propose("faq:en", { suggestionId: "s2", text: "Second." }, { read: () => "Second." });
    again(false);
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "discarded", distance: null }]]);
    expect(ledger.has("faq:en")).toBe(true);
    again(true); // ending twice changes nothing
    await tick();
    expect(reported).toHaveLength(1);
  });

  it("tracks no draft without an id, but still lets it replace one waiting", async () => {
    ledger.propose("seo:de", { text: "Ohne Kennung." }, { read: () => "Ohne Kennung." });
    ledger.settle("seo:de");
    await tick();
    expect(reported).toEqual([]);

    ledger.propose("seo:de", { suggestionId: "s1", text: "Mit." }, { read: () => "Mit." });
    ledger.propose("seo:de", { text: "NO_ANSWER" }, { read: () => "NO_ANSWER" });
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "discarded", distance: null }]]);
    expect(ledger.has("seo:de")).toBe(false);
  });

  it("splits more than fifty verdicts, and never troubles the admin when the API refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fail = true;
    for (let i = 0; i < 51; i++)
      ledger.propose(`f:${i}`, { suggestionId: `s${i}`, text: "x" }, { read: () => "x" });
    ledger.abandonPrefix("f:");
    await tick();
    expect(reported.map((batch) => batch.length)).toEqual([50, 1]);
    expect(warn).toHaveBeenCalledWith("[copilot] verdicts not recorded", "not_found");
    warn.mockRestore();
  });
});
