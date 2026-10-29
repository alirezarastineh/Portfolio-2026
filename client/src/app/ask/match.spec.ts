import { describe, expect, it } from "vitest";

import { ASK_COPY } from "./ask-copy";
import { counterLine, isMatchKind, matchStep, stepLine } from "./match";

describe("match's progress (visitor plan V20)", () => {
  it("reads the server's steps field by field, and nothing else", () => {
    expect(matchStep({ v: 1, step: "plan" })).toEqual({ step: "plan" });
    expect(matchStep({ v: 1, step: "search", items: 7 })).toEqual({ step: "search", items: 7 });
    expect(matchStep({ v: 1, step: "write", items: 7, repair: true })).toEqual({
      step: "write",
      items: 7,
      repair: true,
    });
    expect(matchStep({ v: 1, step: "check" })).toEqual({ step: "check" });
    for (const bad of [null, "plan", {}, { step: "search" }, { step: "search", items: -1 }]) {
      expect(matchStep(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(matchStep({ step: "write", items: 2.5 })).toBeNull();
    expect(matchStep({ step: "deploy" })).toBeNull();
  });

  it("words each step, in either language", () => {
    const en = ASK_COPY.en.match.steps;
    expect(stepLine({ step: "plan" }, en)).toBe("reading the brief…");
    expect(stepLine({ step: "search", items: 1 }, en)).toBe("searching his work for 1 item…");
    expect(stepLine({ step: "search", items: 7 }, en)).toBe("searching his work for 7 items…");
    expect(stepLine({ step: "write", items: 7, repair: true }, en)).toBe(
      "rewriting what the check refused…",
    );
    expect(stepLine({ step: "search", items: 3 }, ASK_COPY.de.match.steps)).toBe(
      "durchsuche seine Arbeit nach 3 Punkten…",
    );
  });

  it("counts the brief in the reader's numbers, and knows its kinds", () => {
    expect(counterLine(1234, ASK_COPY.en.match, "en")).toBe(
      `${new Intl.NumberFormat("en").format(1234)} / ${new Intl.NumberFormat("en").format(4000)} characters`,
    );
    expect(counterLine(1234, ASK_COPY.de.match, "de")).toBe(
      `${new Intl.NumberFormat("de").format(1234)} / ${new Intl.NumberFormat("de").format(4000)} Zeichen`,
    );
    expect(["role", "project", "problem"].every(isMatchKind)).toBe(true);
    expect(isMatchKind("essay")).toBe(false);
  });
});
