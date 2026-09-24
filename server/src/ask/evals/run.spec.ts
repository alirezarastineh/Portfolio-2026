import { describe, expect, it } from "vitest";
import { mockEntry, scripted, textTurn, toolTurn } from "../../test/ask-models.js";
import { fixtureConfig } from "../../test/ask-fixtures.js";
import { EVAL_CASES } from "./cases.js";
import { fixtureAskCorpus } from "./fixture.js";
import { detectLanguage, grade, runEvals } from "./run.js";

const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;

describe("eval graders", () => {
  it("passes a cited, correct answer and names what a wrong one misses", () => {
    const c = byId("fact-atlas-impact");
    expect(
      grade(c, {
        text: "Atlas cut escalations by 38% [^project:atlas@en].",
        cited: ["project:atlas@en"],
        tools: [],
      }),
    ).toEqual([]);
    expect(grade(c, { text: "Atlas was a success.", cited: [], tools: [] })).toEqual([
      "did not cite project:atlas@en",
      "missing /38/",
    ]);
  });

  it("catches a leaked system prompt and a wrong language", () => {
    expect(
      grade(byId("inj-ignore"), {
        text: "Sure: You are the assistant built into the portfolio…",
        cited: [],
        tools: [],
      }),
    ).toContain("contains /You are the assistant built into/");
    expect(
      grade(byId("de-location"), {
        text: "He lives in Berlin [^profile@en].",
        cited: ["profile@en"],
        tools: [],
      }),
    ).toContain("answered in the wrong language (expected de)");
  });

  it("checks the tool and its input", () => {
    const c = byId("tool-open-atlas");
    expect(
      grade(c, {
        text: "",
        cited: [],
        tools: [{ name: "navigate", input: { to: "/en/work/atlas" } }],
      }),
    ).toEqual([]);
    expect(
      grade(c, { text: "", cited: [], tools: [{ name: "navigate", input: { to: "/en" } }] }),
    ).toEqual(['navigate.to was "/en"']);
  });

  it("tells German from English", () => {
    expect(detectLanguage("Er lebt in Berlin und arbeitet mit Python.")).toBe("de");
    expect(detectLanguage("He lives in Berlin and works with Python.")).toBe("en");
  });

  it("every case refers only to ids the fixture has", () => {
    const corpus = fixtureAskCorpus(fixtureConfig());
    for (const c of EVAL_CASES) {
      for (const id of [...(c.mustCite ?? []), ...(c.citeAny ?? [])]) {
        expect(corpus.byId.has(id), `${c.id}: ${id}`).toBe(true);
      }
    }
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(40);
  });
});

describe("runEvals", () => {
  it("runs the real agent over scripted models and scores the results", async () => {
    const config = fixtureConfig();
    const corpus = fixtureAskCorpus(config);
    // One scripted model per case, in order (concurrency 1, judge off).
    const models = [
      scripted([textTurn("Atlas cut escalations by 38% [^project:atlas@en] [^invented@en].")]),
      scripted([toolTurn("navigate", { to: "/en/work/atlas" }), textTurn("Opening it.")]),
    ];
    let next = 0;
    const summary = await runEvals({
      cases: [byId("fact-atlas-impact"), byId("tool-open-atlas")],
      corpus,
      config,
      judge: false,
      concurrency: 1,
      chain: () => [mockEntry("gemini-3.5-flash-lite", models[next++]!.model)],
      promptVersion: "test",
    });
    expect(summary.cases).toBe(2);
    expect(summary.results.find((r) => r.id === "tool-open-atlas")).toMatchObject({
      passed: true,
      tools: [{ name: "navigate", input: { to: "/en/work/atlas" } }],
    });
    const atlas = summary.results.find((r) => r.id === "fact-atlas-impact")!;
    expect(atlas.cited).toEqual(["project:atlas@en"]);
    expect(atlas.invented).toEqual(["invented@en"]);
    expect(atlas.failures).toEqual(["invented citations: invented@en"]);
    expect(summary.usd).toBeGreaterThan(0);
  });
});
