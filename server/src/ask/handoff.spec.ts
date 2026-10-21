import { describe, expect, it } from "vitest";

import { handoffOffer, OWN_WORDS_CHARS, ownWords, summaryProblem } from "./handoff.js";

/**
 * The hand-off that happens (visitor plan V6): the model's summary is checked
 * before it fills the form, and the server offers the hand-off itself when the
 * visitor asked and the model did not.
 */

const visitor = {
  question: "I'd like to hire him, my email is jane@example.com.",
  language: "en" as const,
};

describe("the summary gate", () => {
  it.each([
    ["Jane would like to hire Alireza for a six-month contract.", null],
    // What the visitor wrote may come back.
    ["Jane (jane@example.com) would like to hire him.", null],
    ["", "missing"],
    [42, "missing"],
    ["Jane möchte Alireza für ein Projekt über sechs Monate beauftragen.", "language"],
    ["Jane would like to hire him; reach her at jane.doe@other.example.", "added-contact"],
    ["Jane would like to hire him; call +49 30 1234567.", "added-contact"],
    ["Jane would like to hire him: see https://example.com/jane for details.", "added-contact"],
    ["Your request has been sent to Alireza.", "claims-sent"],
    ["I forwarded your CV to him.", "claims-sent"],
  ] as const)("%j: %s", (summary, problem) => {
    expect(summaryProblem(summary, visitor)).toBe(problem);
  });

  it("reads a German visitor's summary in German, and a date as no phone number", () => {
    const german = { question: "Wir möchten ihn einstellen.", language: "de" as const };
    expect(summaryProblem("Das Team möchte Alireza einstellen, ab 2026-11-01.", german)).toBeNull();
    expect(summaryProblem("Die Anfrage wurde gesendet.", german)).toBe("claims-sent");
  });
});

describe("the visitor's own words", () => {
  it("are cleaned onto one line, and cut at a word past the limit", () => {
    expect(ownWords("  How can I\n hire   him?\u0007 ")).toBe("How can I hire him?");
    const long = `${"word ".repeat(100)}end`;
    const cut = ownWords(long);
    expect(cut.length).toBeLessThanOrEqual(OWN_WORDS_CHARS);
    expect(cut.endsWith("word…")).toBe(true);
  });
});

describe("the offer an answer makes", () => {
  const base = {
    intent: true,
    call: null,
    finished: true,
    openedContact: false,
    question: "How can I hire him?",
    language: "en" as const,
  };

  it("is the model's, its summary kept when it passes", () => {
    expect(
      handoffOffer({
        ...base,
        call: { input: { summary: " Wants to hire him for a contract. " } },
      }),
    ).toEqual({ by: "tool", summary: "Wants to hire him for a contract." });
  });

  it("is the model's, with the visitor's words when its summary fails, whatever the intent", () => {
    expect(
      handoffOffer({
        ...base,
        intent: false,
        call: { input: { summary: "Sent to Alireza." } },
      }),
    ).toEqual({ by: "tool", summary: "How can I hire him?", replaced: true });
  });

  it("is the server's when the visitor asked and the model offered nothing", () => {
    expect(handoffOffer(base)).toEqual({ by: "fallback", summary: "How can I hire him?" });
  });

  it("is none without the intent, after a failure, or once the contact section opened", () => {
    expect(handoffOffer({ ...base, intent: false })).toBeNull();
    expect(handoffOffer({ ...base, finished: false })).toBeNull();
    expect(handoffOffer({ ...base, openedContact: true })).toBeNull();
  });
});
