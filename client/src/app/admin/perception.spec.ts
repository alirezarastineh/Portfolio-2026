import { describe, expect, it } from "vitest";

import {
  cacheShare,
  documentRows,
  layoutRows,
  localeMixLine,
  percent,
  rereadVerdict,
  searchLine,
  toolRows,
  windowLine,
  tierOf,
  withTier,
  type PerceptionView,
} from "./perception";

const view = (over: Partial<PerceptionView> = {}): PerceptionView => ({
  days: 30,
  answers: 40,
  cache: {
    first: { steps: 30, input: 30_000, cached: 0, hits: 0 },
    later: { steps: 10, input: 12_000, cached: 9_000, hits: 8 },
  },
  fetches: { whole: 1, rest: 6, handle: 2, unknown: 0 },
  rereadRatio: 1 / 9,
  healthyReread: 0.05,
  tokens: { input: 40_000, output: 4_000, inputPerAnswer: 1_000, helpful: 30, perHelpful: 1_467 },
  usdPerAnswer: 0.0021,
  byLayout: {
    both: {
      answers: 25,
      cache: {
        first: { steps: 20, input: 24_000, cached: 0, hits: 0 },
        later: { steps: 5, input: 6_000, cached: 0, hits: 0 },
      },
      fetches: { whole: 1, rest: 4, handle: 0, unknown: 0 },
      rereadRatio: 0.2,
      tokens: {
        input: 30_000,
        output: 2_500,
        inputPerAnswer: 1_200,
        helpful: 18,
        perHelpful: 1_806,
      },
      usdPerAnswer: 0.0025,
    },
    locale: {
      answers: 15,
      cache: {
        first: { steps: 10, input: 6_000, cached: 0, hits: 0 },
        later: { steps: 5, input: 12_000, cached: 9_000, hits: 5 },
      },
      fetches: { whole: 0, rest: 2, handle: 2, unknown: 0 },
      rereadRatio: 0,
      tokens: { input: 10_000, output: 1_500, inputPerAnswer: 667, helpful: 12, perHelpful: 958 },
      usdPerAnswer: null,
    },
  },
  localeMix: [
    { page: "en", reading: "en", answers: 30 },
    { page: "en", reading: "de", answers: 6 },
    { page: "de", reading: null, answers: 4 },
  ],
  documents: [
    { id: "project:atlas@en", fetched: 12, cited: 20 },
    { id: "profile@en", fetched: 1, cited: 25 },
  ],
  coreTokens: { en: 1_341, de: 1_557 },
  rules: { promoteShare: 0.2, promoteMinAnswers: 20, demoteMinAnswers: 200 },
  limits: { promoted: 6, demoted: 30 },
  tiers: { promoted: ["project:atlas@en"], demoted: [] },
  suggestions: { promote: [], demote: [], considered: [] },
  titles: { "project:atlas@en": "Atlas", "profile@en": "Alireza Rastineh" },
  ...over,
});

describe("perception in the admin", () => {
  it("shows shares, the cached share of a set of steps, and a dash with nothing to divide", () => {
    expect(percent(0.111)).toBe("11 %");
    expect(percent(12, 40)).toBe("30 %");
    expect(percent(null)).toBe("–");
    expect(percent(3, 0)).toBe("–");
    expect(cacheShare(view().cache.later)).toBe("75 %");
    expect(cacheShare({ steps: 0, input: 0, cached: 0, hits: 0 })).toBe("–");
  });

  it("reads the locale mix, older answers included", () => {
    expect(localeMixLine(view().localeMix)).toBe(
      "English page, English core: 30 · English page, German core: 6 · German page, one core (before): 4",
    );
  });

  it("lists the most-used documents with their shares and tiers", () => {
    expect(documentRows(view())).toEqual([
      { id: "project:atlas@en", title: "Atlas", fetched: "30 %", cited: "50 %", tier: "promoted" },
      { id: "profile@en", title: "Alireza Rastineh", fetched: "3 %", cited: "63 %", tier: null },
    ]);
    expect(documentRows(view(), 1)).toHaveLength(1);
  });

  it("moves a document between tiers, or out of both", () => {
    const tiers = { promoted: ["a"], demoted: ["b"] };
    expect(withTier(tiers, "b", "promoted")).toEqual({ promoted: ["a", "b"], demoted: [] });
    expect(withTier(tiers, "a", null)).toEqual({ promoted: [], demoted: ["b"] });
    expect(withTier(tiers, "c", "demoted")).toEqual({ promoted: ["a"], demoted: ["b", "c"] });
    expect(tierOf(tiers, "b")).toBe("demoted");
    expect(tierOf(tiers, "c")).toBeNull();
  });

  it("lays before and after side by side for the gate", () => {
    expect(layoutRows(view())).toEqual([
      {
        layout: "both",
        label: "One core, both languages (before)",
        answers: 25,
        inputPerAnswer: "1,200",
        usdPerAnswer: "$0.00250",
        cached: "0 % / 0 %",
        reread: "20 %",
        perHelpful: "1,806",
      },
      {
        layout: "locale",
        label: "A core per language (after)",
        answers: 15,
        inputPerAnswer: "667",
        usdPerAnswer: "–",
        cached: "0 % / 75 %",
        reread: "0 %",
        perHelpful: "958",
      },
    ]);
  });

  it("says how many searches led to a citation, by meaning and by words alone", () => {
    expect(
      searchLine({
        semantic: { answers: 6, converted: 4 },
        words: { answers: 5, converted: 2 },
      }),
    ).toBe("By meaning: 4 of 6 led to a citation · By words alone: 2 of 5 led to a citation");
    expect(
      searchLine({ semantic: { answers: 0, converted: 0 }, words: { answers: 3, converted: 1 } }),
    ).toBe("By words alone: 1 of 3 led to a citation");
    expect(
      searchLine({ semantic: { answers: 0, converted: 0 }, words: { answers: 0, converted: 0 } }),
    ).toBeNull();
    expect(searchLine(undefined)).toBeNull();
  });

  it("judges the re-read ratio against the heuristic's ceiling", () => {
    expect(rereadVerdict(view())).toBe("high");
    expect(rereadVerdict(view({ rereadRatio: 0.02 }))).toBe("healthy");
    expect(rereadVerdict(view({ rereadRatio: null }))).toBeNull();
  });

  it("shows each tool's calls per answer, its calls by outcome and what got cited", () => {
    // Every outcome a different share: a column reading another outcome's count fails.
    const tools = {
      answers: 20,
      tools: [
        {
          name: "get_document",
          calls: 20,
          callsPerAnswer: 1,
          outcomes: { ok: 12, not_found: 1, duplicate: 3, budget_exhausted: 4 },
          citedAfter: 0.8,
        },
        {
          name: "search_portfolio",
          calls: 10,
          callsPerAnswer: 0.5,
          outcomes: { ok: 7, no_hits: 3 },
          citedAfter: 0.6,
        },
        {
          name: "navigate",
          calls: 10,
          callsPerAnswer: 0.5,
          outcomes: { ok: 8, not_allowed: 2 },
          citedAfter: null,
        },
      ],
    };
    expect(toolRows(view({ tools }))).toEqual([
      {
        name: "get_document",
        perAnswer: "1.00",
        notFound: "5 %",
        notAllowed: "0 %",
        noHits: "0 %",
        repeated: "15 %",
        overBudget: "20 %",
        cited: "80 %",
      },
      {
        name: "search_portfolio",
        perAnswer: "0.50",
        notFound: "0 %",
        notAllowed: "0 %",
        noHits: "30 %",
        repeated: "0 %",
        overBudget: "0 %",
        cited: "60 %",
      },
      {
        name: "navigate",
        perAnswer: "0.50",
        notFound: "0 %",
        notAllowed: "20 %",
        noHits: "0 %",
        repeated: "0 %",
        overBudget: "0 %",
        cited: "–",
      },
    ]);
    // An older API sends no tools.
    expect(toolRows(view())).toEqual([]);
  });

  it("says how often the conversation window trimmed a session, and what followed", () => {
    const window = {
      sessions: 40,
      sessionsTrimmed: 2,
      afterTrim: { answers: 3, rephrased: 1 },
      otherwise: { answers: 37, rephrased: 2 },
    };
    expect(windowLine(view({ window }))).toBe(
      "Conversation window: 2 of 40 sessions trimmed (5 %); rephrased after a trim 1 of 3 (33 %), otherwise 2 of 37 (5 %)",
    );
    expect(
      windowLine(
        view({
          window: { ...window, sessionsTrimmed: 0, afterTrim: { answers: 0, rephrased: 0 } },
        }),
      ),
    ).toBe("Conversation window: 0 of 40 sessions trimmed (0 %)");
    expect(windowLine(view())).toBeNull();
  });
});
