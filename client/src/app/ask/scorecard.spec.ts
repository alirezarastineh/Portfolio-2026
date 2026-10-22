import { describe, expect, it } from "vitest";

import { ASK_COPY } from "./ask-copy";
import { helpLines } from "./commands";
import { fetchScorecard, scorecardLines } from "./scorecard";

/**
 * `evals` (visitor plan V13): the public scorecard as shell lines. Every field
 * printed is listed here, read by name; the rest of a response stays off.
 */

const CARD = {
  v: 1,
  prompt: "ask-2026-10-22.1+982317ef9de8",
  recorded: {
    measured: true,
    at: "2026-10-22T15:18:24.510Z",
    cases: 84,
    completed: 84,
    passed: 76,
    passRate: 76 / 84,
    judge: "gemini-3.5-flash-lite",
    categories: [
      { name: "fact", cases: 18, completed: 18, passed: 14 },
      { name: "page", cases: 5, completed: 5, passed: 5 },
    ],
  },
  live: {
    days: 30,
    minimum: 20,
    answers: 51,
    unanswered: { share: 4 / 55, n: 55 },
    citationsVerified: { share: 0.96, n: 40 },
    repaired: { share: 0.02, n: 51 },
    figuresFlagged: null,
    firstWordMs: { median: 1_800, n: 30 },
    refusals: { invalid_input: 16, rate_limited: 2 },
  },
  judge: { median: 0.92, n: 25 },
  at: "2026-10-22T20:00:00.000Z",
};

const rows = (lines: ReturnType<typeof scorecardLines>) =>
  lines.map((l) => [l.label ?? "", l.text, ...(l.ask ? [l.ask] : [])]);

describe("evals' lines (visitor plan V13)", () => {
  it("prints the recorded run, the live checks and the judge, then asks for the system card", () => {
    expect(rows(scorecardLines(CARD, ASK_COPY.en, "en"))).toEqual([
      ["", "evals · how the assistant does · prompt ask-2026-10-22.1+982317ef9de8"],
      // Dated as the site dates its posts.
      [
        "recorded run",
        "October 22, 2026 · 76 of 84 cases passed (90.5%) · judged by gemini-3.5-flash-lite",
      ],
      [" ", "fact 14/18 · page 5/5"],
      ["last 30 days", "51 answers to visitors · 4 unanswered (7.3%)"],
      ["citations", "every reference real in 96% of 40 answers that cite"],
      ["repaired", "2% written again: the first try had no words"],
      // Below its minimum, the server sent none.
      ["figures", "not enough answers yet"],
      ["first word", "median 1.8 s in visitors' browsers (30 answers)"],
      ["turned away", "invalid_input 16 · rate_limited 2"],
      ["judge", "median faithfulness 92% in a nightly sample of 25 answers"],
      ["", "how this assistant works ›", "How does this assistant work?"],
    ]);
  });

  it("says a waived version is not measured yet, and a thin window has not enough answers", () => {
    const lines = rows(
      scorecardLines(
        {
          ...CARD,
          recorded: { measured: false, reason: "a new prompt, measured next run" },
          live: { ...CARD.live, answers: 12, unanswered: null },
          judge: null,
        },
        ASK_COPY.en,
        "en",
      ),
    );
    expect(lines).toEqual([
      ["", "evals · how the assistant does · prompt ask-2026-10-22.1+982317ef9de8"],
      ["recorded run", "this version is not measured yet: a new prompt, measured next run"],
      ["last 30 days", "12 answers to visitors"],
      [" ", "not enough answers yet"],
      ["", "how this assistant works ›", "How does this assistant work?"],
    ]);
    expect(
      rows(scorecardLines({ recorded: { measured: false, reason: null } }, ASK_COPY.en, "en"))[1],
    ).toEqual(["recorded run", "this version is not measured yet"]);
  });

  it("never prints a field it does not list, nor fails on a broken response", () => {
    const text = scorecardLines(
      {
        ...CARD,
        question: "UNLISTED-1",
        live: { ...CARD.live, sessions: "UNLISTED-2" },
        recorded: { ...CARD.recorded, acceptedRegression: { reason: "UNLISTED-3" } },
      },
      ASK_COPY.en,
      "en",
    )
      .map((l) => `${l.label ?? ""} ${l.text}`)
      .join("\n");
    expect(text).not.toMatch(/UNLISTED/);
    expect(() => scorecardLines(null, ASK_COPY.de, "de")).not.toThrow();
  });

  it("speaks German on a German page", () => {
    const lines = rows(scorecardLines(CARD, ASK_COPY.de, "de"));
    expect(lines[1]).toEqual([
      "Testlauf",
      "22. Oktober 2026 · 76 von 84 Fällen bestanden (90,5 %) · bewertet von gemini-3.5-flash-lite",
    ]);
    expect(lines.at(-1)).toEqual([
      "",
      "wie dieser Assistent funktioniert ›",
      "Wie funktioniert dieser Assistent?",
    ]);
  });

  it("lists evals under help only while the scorecard is published", () => {
    const labels = (scorecard: boolean) =>
      helpLines(ASK_COPY.en, "disclosure", { scorecard }).map((l) => l.label);
    expect(labels(false)).not.toContain("evals");
    expect(labels(true)).toContain("evals");
    expect(labels(true).indexOf("evals")).toBe(labels(true).indexOf("history · clear · reset") - 1);
  });
});

describe("fetchScorecard", () => {
  const respond = (status: number, body: unknown = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it("reads the scorecard, or says why not", async () => {
    expect(await fetchScorecard(() => respond(200, { v: 1 }))).toEqual({
      ok: true,
      card: { v: 1 },
    });
    expect(await fetchScorecard(() => respond(404))).toEqual({ ok: false, reason: "off" });
    expect(await fetchScorecard(() => respond(429, { retryAfter: 12 }))).toEqual({
      ok: false,
      reason: "limited",
      retryAfter: 12,
    });
    expect(await fetchScorecard(() => respond(500))).toEqual({ ok: false, reason: "failed" });
    expect(await fetchScorecard(() => Promise.reject(new TypeError("offline")))).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});
