import { describe, expect, it } from "vitest";

import {
  effectLine,
  lessonProblem,
  lessonRefusal,
  noticeLine,
  promoteProblem,
  ratesLine,
  scopeFromEntries,
  scopeFromTitle,
  scopeWords,
  topicProblem,
} from "./lessons";
import type { JournalEntry } from "./journal";

const effect = (applications: number, successes: number) => ({
  at: "2026-10-07T03:30:00.000Z",
  since: "2026-10-01T09:00:00.000Z",
  before: { answers: 3, unknown: 3, down: 1, failed: 3 },
  after: { answers: applications, unknown: 0, down: 0, failed: applications - successes },
  applications,
  successes,
  value: applications ? successes / applications : null,
});

describe("lessons in the admin (plan phase 25)", () => {
  it("says a lesson's effect as counts until there are five applications", () => {
    expect(effectLine(null)).toBe("Not applied yet: nothing to measure.");
    expect(effectLine(effect(2, 2))).toBe(
      "Too little to judge yet: 2 of 2 matching answers since the fix went well (5 needed).",
    );
    expect(effectLine(effect(5, 4))).toBe(
      "Effectiveness 0.80: 4 of 5 matching answers since the fix went well.",
    );
    expect(ratesLine({ answers: 3, unknown: 3, down: 1, failed: 3 })).toBe(
      "3 answers: 3 said it isn't there, 1 thumbs down, 3 failed",
    );
    expect(ratesLine({ answers: 0, unknown: 0, down: 0, failed: 0 })).toBe("no matching answers");
  });

  it("promotes three decided entries, with the corpus words they found as a first scope", () => {
    const entry = (status: JournalEntry["status"], words: string[]) =>
      ({
        status,
        diagnosis: { located: words.length ? { words } : null },
      }) as unknown as JournalEntry;
    const picked = [
      entry("accepted", ["visa", "germany"]),
      entry("fixed", ["visa", "permit"]),
      entry("proposed", []),
    ];
    expect(promoteProblem(picked)).toBe("Select 3 accepted or fixed entries (2 selected).");
    expect(promoteProblem([...picked, entry("accepted", [])])).toBeNull();
    const many = Array.from({ length: 21 }, () => entry("fixed", []));
    expect(promoteProblem(many)).toBe("A lesson names at most 20 entries (21 selected).");
    expect(scopeFromEntries(picked)).toEqual(["visa", "germany", "permit"]);
    expect(scopeWords("Visa, visa;  work-permit Arbeitserlaubnis ab")).toEqual([
      "visa",
      "arbeitserlaubnis",
    ]);
  });

  it("makes a lesson only from an unanswered topic of five questions, in the admin's words", () => {
    expect(topicProblem({ questions: 6, unanswered: true })).toBeNull();
    expect(topicProblem({ questions: 4, unanswered: true })).toBe(
      "A lesson needs 5 questions on the topic; it has 4.",
    );
    expect(topicProblem({ questions: 9, unanswered: false })).toBe(
      "Only a topic the assistant could not answer becomes a lesson.",
    );
    expect(scopeFromTitle("Kafka and streaming with the Atlas team")).toEqual([
      "kafka",
      "streaming",
      "atlas",
      "team",
    ]);

    expect(lessonProblem("Be careful.", "kafka")).toBe(
      "Write the lesson as a rule someone can follow: at least 8 words (2 so far).",
    );
    const rule = "When visitors ask about streaming, answer it once in the FAQ.";
    expect(lessonProblem(rule, "ab, !!")).toBe(
      "Name at least one word of 3 letters or more that its questions contain.",
    );
    expect(lessonProblem(rule, "kafka")).toBeNull();

    expect(
      lessonRefusal("not_corroborated", {
        reason: "a lesson needs 3 accepted or fixed journal entries; 2 given",
      }),
    ).toBe("Not corroborated: a lesson needs 3 accepted or fixed journal entries; 2 given.");
    expect(lessonRefusal("not_corroborated")).toBe("Not corroborated yet.");
    expect(lessonRefusal("bad_transition")).toBe(
      "The lesson changed meanwhile: reload the journal.",
    );
    expect(lessonRefusal("http_500")).toBe("http_500");
    expect(lessonRefusal("invalid_input")).toMatch(/^Something in the lesson is out of bounds/);
  });

  it("says on the Overview why insights ran by themselves", () => {
    const reason = "failures rose: the last 30: 9 failed; the 30 before: 4 failed";
    expect(noticeLine({ reason, unanswered: 1 })).toBe(
      `Insights ran by themselves (${reason}): 1 topic the assistant could not answer.`,
    );
    expect(noticeLine({ reason, unanswered: 0 })).toMatch(/: 0 topics the assistant/);
  });
});
