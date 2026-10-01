import { describe, expect, it } from "vitest";

import { NOT_IN_PORTFOLIO, PROMPT_LEAKS } from "./answer-patterns.js";
import { CHECK_FLAGS, checkAnswer, type CheckFlag, type CheckInput } from "./checks.js";
import { EVAL_CASES } from "./evals/cases.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const CITED =
  "Atlas is a retrieval-augmented support assistant [^project:atlas@en] that cut escalations by 38% while keeping answers grounded in the help-centre articles it retrieves for every question it is asked by customers.";

function input(overrides: Partial<CheckInput> = {}): CheckInput {
  return {
    text: CITED,
    locale: "en",
    language: "en",
    droppedCitations: [],
    toolNames: [],
    finishReason: "stop",
    steps: 1,
    maxRounds: 5,
    degraded: false,
    ...overrides,
  };
}

const flags = (overrides: Partial<CheckInput>) => checkAnswer(input(overrides)).flags;
const UNCITED = CITED.replace(" [^project:atlas@en]", "");

describe("checks on finished answers", () => {
  it("raises nothing for a cited answer in the visitor's language", () => {
    expect(checkAnswer(input())).toEqual({ v: 1, flags: [] });
  });

  // One row per flag: the input that raises it, and a near miss that does not.
  const table: { flag: CheckFlag; raises: Partial<CheckInput>; not: Partial<CheckInput> }[] = [
    {
      flag: "language",
      raises: { language: "de" },
      not: { language: null, locale: "en" },
    },
    {
      flag: "uncited",
      raises: { text: UNCITED },
      not: { text: UNCITED.split(" ").slice(0, 20).join(" ") },
    },
    {
      flag: "leak",
      raises: { text: `${CITED} You are the assistant built into the portfolio website.` },
      not: { text: `${CITED} I am the portfolio's assistant.` },
    },
    {
      flag: "empty",
      raises: { text: "" },
      not: { text: "", toolNames: ["navigate"] },
    },
    {
      flag: "invented-citation",
      raises: { droppedCitations: ["project:nebula@en"] },
      not: { droppedCitations: [] },
    },
    { flag: "max-rounds", raises: { steps: 5 }, not: { steps: 4 } },
    { flag: "degraded", raises: { degraded: true }, not: { degraded: false } },
    {
      flag: "blocked",
      raises: { finishReason: "content-filter", text: "" },
      not: { finishReason: "tool-calls" },
    },
  ];

  it("covers every flag", () => {
    expect(table.map((row) => row.flag).sort()).toEqual([...CHECK_FLAGS].sort());
  });

  for (const row of table) {
    it(`raises ${row.flag} only when it applies`, () => {
      expect(flags(row.raises)).toContain(row.flag);
      expect(flags(row.not)).not.toContain(row.flag);
    });
  }

  it("does not call an honest 'it isn't there' or a decline uncited", () => {
    const unknown =
      "The portfolio does not specify his salary expectations, and I would rather not guess at a number for you. The best way to find out is to ask him directly: type contact to send him a message from here.";
    const decline =
      "I can only help with questions about Alireza's work, projects, skills and experience, so I cannot write that poem for you. You could ask which projects he built with RAG, or where he is based today.";
    expect(flags({ text: unknown })).not.toContain("uncited");
    expect(flags({ text: decline })).not.toContain("uncited");
  });

  it("does not call a failed or aborted answer empty: the failure already shows", () => {
    expect(flags({ text: "", finishReason: "error:unavailable" })).not.toContain("empty");
    expect(flags({ text: "", finishReason: "aborted" })).not.toContain("empty");
  });

  it("judges the language by the prose, not the citation ids", () => {
    const german = "Er lebt in Berlin und arbeitet mit Python und PostgreSQL [^profile@en].";
    expect(flags({ text: german, language: "de" })).not.toContain("language");
    expect(flags({ text: german, language: "en" })).toContain("language");
    // An unclear visitor language falls back to the page's.
    expect(flags({ text: german, language: null, locale: "de" })).not.toContain("language");
  });
});

describe("one definition for the graders and the checks", () => {
  it("every leak pattern is a real piece of the system prompt", () => {
    for (const piece of PROMPT_LEAKS) expect(SYSTEM_PROMPT).toContain(piece);
  });

  it("the eval cases grade with the shared patterns", () => {
    const leakCases = EVAL_CASES.filter((c) => c.mustNotInclude === PROMPT_LEAKS);
    expect(leakCases.map((c) => c.id).sort()).toEqual(["inj-config", "inj-ignore", "inj-repeat"]);
    const unknownCases = EVAL_CASES.filter((c) =>
      c.mustInclude?.some((pattern) => pattern.includes(NOT_IN_PORTFOLIO)),
    );
    expect(unknownCases.map((c) => c.id).sort()).toEqual([
      "halluc-google",
      "halluc-nebula",
      "unknown-gpa",
      "unknown-salary",
    ]);
  });

  it("the unknown pattern reads the phrasings answers use, in both languages", () => {
    const unknown = new RegExp(NOT_IN_PORTFOLIO, "i");
    for (const text of [
      "The portfolio does not specify his salary.",
      "That isn't mentioned in the documents.",
      "There is no information about his GPA.",
      "Das steht nicht im Portfolio.",
      "Dazu gibt es keine Angaben.",
      "Das ist nicht auf der Website zu finden.",
    ]) {
      expect(unknown.test(text), text).toBe(true);
    }
    expect(unknown.test("Atlas cut escalations by 38%.")).toBe(false);
  });
});
