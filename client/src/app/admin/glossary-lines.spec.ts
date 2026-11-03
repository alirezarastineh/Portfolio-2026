import { describe, expect, it } from "vitest";

import { glossaryText, parseGlossary } from "./glossary-lines";

describe("the glossary field's lines", () => {
  // The copilot's gate splits the same cases the same way (server skills/gates.spec.ts).
  it("splits each line at its first colon and a space", () => {
    expect(
      parseGlossary(
        "std::vector: a growable array\r\nTerm:definition\nTerm: def: more\n\n  no colon  \n",
      ),
    ).toEqual([
      { term: "std::vector", definition: "a growable array" },
      { term: "Term", definition: "definition" },
      { term: "Term", definition: "def: more" },
      { term: "no colon", definition: "" },
    ]);
  });

  it("writes a saved glossary back as the lines it parses from", () => {
    const items = [
      { term: "RAG", definition: "Answers from given documents." },
      { term: "p95", definition: "The 95th percentile." },
    ];
    expect(glossaryText(items)).toBe(
      "RAG: Answers from given documents.\np95: The 95th percentile.",
    );
    expect(parseGlossary(glossaryText(items))).toEqual(items);
    expect(glossaryText([])).toBe("");
  });
});
