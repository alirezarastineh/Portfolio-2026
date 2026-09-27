import { describe, expect, it } from "vitest";

import { sentenceCase } from "./sentence-case";

describe("sentenceCase", () => {
  it("turns a shouted single word into a heading", () => {
    expect(sentenceCase("PROBLEM", "en")).toBe("Problem");
    expect(sentenceCase("INFRASTRUKTUR", "de")).toBe("Infrastruktur");
    expect(sentenceCase("ÜBERBLICK", "de")).toBe("Überblick");
  });

  it("leaves acronyms, phrases and mixed case as written", () => {
    expect(sentenceCase("AI", "en")).toBe("AI");
    expect(sentenceCase("AI STACK", "en")).toBe("AI STACK");
    expect(sentenceCase("Outcomes", "en")).toBe("Outcomes");
    expect(sentenceCase("case_study", "en")).toBe("case_study");
  });
});
