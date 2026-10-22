import { describe, expect, it } from "vitest";

import { ASK_COPY } from "./ask-copy";
import { fetchInspect, inspectLines, linesText } from "./inspect";

/**
 * `inspect`'s timeline (visitor plan V12): every field it prints is listed
 * here, read by name from the server's projection; anything else the response
 * holds stays off the screen.
 */

const VIEW = {
  v: 1,
  id: "m_inspect000001",
  at: "2026-10-22T14:03:00.000Z",
  prompt: "ask-2026-10-22.1+982317ef9de8",
  route: "lite→deep",
  reason: "multi-project+sensitive:contract",
  model: "nemotron-3-ultra",
  ttftMs: 6_640,
  totalMs: 9_100,
  steps: [
    {
      model: "nemotron-3-ultra",
      ttftMs: 640,
      tokens: { input: 9_000, cached: 8_000, output: 120 },
      passedOver: [{ model: "gemini-3.5-flash-lite", outcome: "timeout", ms: 6_000 }],
      tools: [
        { name: "search_portfolio", input: "atlas evals", outcome: "ok", chars: 812 },
        { name: "get_document", input: "project:atlas@en", outcome: "ok", chars: 2_400 },
        { name: "list_projects", outcome: "no_hits", chars: 15 },
        { name: "search_portfolio", outcome: "ok", chars: 5 },
        { name: "handoff_contact", outcome: "ok", chars: 40 },
      ],
    },
    { model: null, ttftMs: null, tokens: null, passedOver: [], tools: [] },
  ],
  citations: { kept: ["project:atlas@en", "profile@en"], removed: 1 },
  guard: { canary: 2, instructions: 1 },
  flags: ["invented-citation", "degraded"],
  escalation: { step: 1, reason: "search-spans-projects" },
  careful: "contract",
  page: { id: "project:atlas@en", promoted: true },
  focus: { kind: "selection", verified: false },
  level: "plain",
  repair: { reason: "stub", by: "model" },
};

const at = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

describe("inspect's timeline (visitor plan V12)", () => {
  it("prints each listed field, in the order a shell timeline reads", () => {
    const lines = inspectLines(VIEW, ASK_COPY.en, "en");
    expect(lines.map((l) => [l.label ?? "", l.text])).toEqual([
      [
        "",
        `inspect m_inspect000001 · ${at(VIEW.at, "en-GB")} · prompt ask-2026-10-22.1+982317ef9de8`,
      ],
      ["route", "lite→deep · reason: multi-project+sensitive:contract"],
      [" ", "moved to the thorough model at step 1: the search spans two projects"],
      ["careful", "contract"],
      ["page", "project:atlas@en · its text came with the question"],
      ["focus", "selection · not found on the page"],
      ["level", "plain"],
      ["step 1", "nemotron-3-ultra · first token 640 ms · 9,000 in (8,000 cached) · 120 out"],
      [" ", "↳ passed over gemini-3.5-flash-lite: timeout after 6.0 s"],
      [" ", '↳ search "atlas evals" → ok · 812 chars'],
      [" ", "↳ cat project:atlas@en → ok · 2,400 chars"],
      [" ", "↳ ls projects → no_hits · 15 chars"],
      // An input not shown again: the tool by its name.
      [" ", "↳ search_portfolio → ok · 5 chars"],
      [" ", "↳ handoff_contact → ok · 40 chars"],
      ["step 2", "no model could answer"],
      ["cited", "project:atlas@en, profile@en · 1 invented reference removed"],
      ["guard", "canary ×2, instructions ×1"],
      ["checks", "invented-citation, degraded"],
      ["repair", "stub · words by the model"],
      ["time", "9.1 s · first token 6.6 s"],
    ]);
  });

  it("never prints a field it does not list, whatever the response holds", () => {
    const text = inspectLines(
      {
        ...VIEW,
        thoughts: "PRIVATE-THOUGHT-1",
        steps: [{ ...VIEW.steps[0], finishReason: "UNLISTED-2", answerOnly: true }],
        question: "UNLISTED-3",
      },
      ASK_COPY.en,
      "en",
    )
      .map((l) => `${l.label ?? ""} ${l.text}`)
      .join("\n");
    for (const never of ["PRIVATE-THOUGHT-1", "UNLISTED-2", "UNLISTED-3", "true"]) {
      expect(text, never).not.toContain(never);
    }
  });

  it("reads a sparse or broken response without failing, and says what it lacks", () => {
    const lines = inspectLines(
      { id: "m_x0000001", steps: "nope", guard: { canary: "x" } },
      ASK_COPY.en,
      "en",
    );
    expect(lines.map((l) => [l.label ?? "", l.text])).toEqual([
      ["", "inspect m_x0000001 ·  · prompt "],
      ["route", ""],
      ["cited", "nothing cited"],
      ["guard", "nothing removed"],
      ["checks", "none"],
      ["time", "– · first token –"],
    ]);
    expect(() => inspectLines(null, ASK_COPY.de, "de")).not.toThrow();
  });

  it("speaks German on a German page", () => {
    const lines = inspectLines(VIEW, ASK_COPY.de, "de");
    expect(lines.find((l) => l.label === "Schritt 1")?.text).toBe(
      "nemotron-3-ultra · erstes Token 640 ms · 9.000 rein (8.000 aus dem Cache) · 120 raus",
    );
    expect(lines.find((l) => l.label === "Ausgabefilter")?.text).toBe("canary ×2, instructions ×1");
  });

  it("copies as the terminal shows it: the prompt and command, then each label in its column", () => {
    expect(
      linesText("inspect", "visitor@portfolio:~$", [
        { text: "inspect m_1", tone: "dim" },
        { label: "route", text: "lite" },
        { label: " ", text: "↳ next" },
      ]),
    ).toBe(
      `visitor@portfolio:~$ inspect\ninspect m_1\nroute           lite\n${" ".repeat(16)}↳ next`,
    );
  });
});

describe("fetchInspect", () => {
  const respond = (status: number, body: unknown = {}) =>
    new Response(JSON.stringify(body), { status });
  const noWait = { sleep: () => Promise.resolve() };

  it("waits for an answer still being logged, then reads it", async () => {
    const replies = [respond(404), respond(200, { id: "m_1" })];
    let calls = 0;
    const result = await fetchInspect(() => Promise.resolve(replies[calls++]!), noWait);
    expect(result).toEqual({ ok: true, view: { id: "m_1" } });
    expect(calls).toBe(2);
  });

  it("says an answer is missing after its tries, and a failure otherwise", async () => {
    let calls = 0;
    const missing = await fetchInspect(() => {
      calls++;
      return Promise.resolve(respond(404));
    }, noWait);
    expect(missing).toEqual({ ok: false, missing: true });
    expect(calls).toBe(3);
    expect(await fetchInspect(() => Promise.resolve(respond(500)), noWait)).toEqual({
      ok: false,
      missing: false,
    });
    expect(await fetchInspect(() => Promise.reject(new TypeError("offline")), noWait)).toEqual({
      ok: false,
      missing: false,
    });
    expect(
      await fetchInspect(() => Promise.resolve(new Response("not json", { status: 200 })), noWait),
    ).toEqual({ ok: false, missing: false });
  });
});
