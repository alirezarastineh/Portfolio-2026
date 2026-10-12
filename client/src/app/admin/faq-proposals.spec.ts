import { describe, expect, it } from "vitest";

import {
  acceptBody,
  acceptForm,
  acceptProblem,
  faqProposalWords,
  isOpenProposal,
  measureChoices,
  provenanceOf,
  sourceLine,
  type FaqProposal,
} from "./faq-proposals";

function proposal(change: Partial<FaqProposal> = {}): FaqProposal {
  return {
    id: "p1",
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
    source: "insight",
    snapshotId: "s1",
    topicIndex: 0,
    topic: {
      snapshotId: "s1",
      title: "Relocation and remote work",
      questions: 6,
      unanswered: true,
    },
    journalId: null,
    questionEn: "Is he open to relocating?",
    questionDe: "Ist er offen für einen Umzug?",
    answerEn: "Yes, within the EU.",
    answerDe: "Ja, innerhalb der EU.",
    uses: {},
    flags: [],
    notes: [],
    usd: 0.001,
    status: "proposed",
    decidedAt: null,
    faqId: null,
    lessonId: null,
    lessons: [],
    newLesson: null,
    ...change,
  };
}

describe("the FAQ proposals' helpers (plan phase 31)", () => {
  it("says where a proposal came from, and which entry an accepted one made", () => {
    expect(sourceLine(proposal())).toBe(
      "From the insight topic “Relocation and remote work” (6 questions, not answered)",
    );
    expect(
      sourceLine(
        proposal({ topic: { snapshotId: "s", title: "Rates", questions: 1, unanswered: false } }),
      ),
    ).toBe("From the insight topic “Rates” (1 question)");
    expect(sourceLine(proposal({ source: "journal", topic: null }))).toBe("From a journal entry");
    const made = provenanceOf([
      proposal({ status: "accepted", faqId: "f1" }),
      proposal({ id: "p2", source: "journal", topic: null, status: "accepted", faqId: "f2" }),
      proposal({ id: "p3", status: "rejected" }),
    ]);
    expect([...made]).toEqual([
      ["f1", "From insights: Relocation and remote work"],
      ["f2", "From the journal"],
    ]);
    expect(isOpenProposal({ status: "needs_you" })).toBe(true);
    expect(isOpenProposal({ status: "accepted" })).toBe(false);
  });

  it("measures by the source's lesson first, a new one when allowed, else not at all", () => {
    const linked = proposal({ lessons: [{ id: "l1", statement: "When visitors ask, answer." }] });
    expect(measureChoices(linked).map((c) => c.value)).toEqual(["lesson:l1", "new", "none"]);
    expect(acceptForm(linked).measure).toBe("lesson:l1");
    const fresh = acceptForm(proposal());
    expect(fresh.measure).toBe("new");
    expect(fresh.statement).toBe(
      "When visitors ask about relocation and remote work, the FAQ entry answers it from the portfolio.",
    );
    expect(fresh.scope).toBe("relocation, remote, work");
    const journal = proposal({
      source: "journal",
      topic: null,
      newLesson: "a lesson from the journal needs 3 accepted or fixed entries",
    });
    expect(measureChoices(journal).map((c) => c.value)).toEqual(["none"]);
    expect(acceptForm(journal).measure).toBe("none");
  });

  it("accepts a language written whole, and sends only what was written", () => {
    const form = acceptForm(proposal());
    expect(acceptProblem(form)).toBeNull();
    expect(acceptBody(form)).toEqual({
      isVisible: true,
      translations: {
        en: { question: "Is he open to relocating?", answer: "Yes, within the EU." },
        de: { question: "Ist er offen für einen Umzug?", answer: "Ja, innerhalb der EU." },
      },
      lesson: {
        statement:
          "When visitors ask about relocation and remote work, the FAQ entry answers it from the portfolio.",
        scope: ["relocation", "remote", "work"],
      },
    });

    // A content gap: the answers are the admin's to write.
    const gap = acceptForm(proposal({ answerEn: "", answerDe: "" }));
    expect(acceptProblem(gap)).toBe(
      "Write both the question and the answer in EN (3 characters or more), or leave both empty.",
    );
    gap.text.en.answer = "He is, within the EU.";
    gap.text.de = { question: "", answer: "" };
    gap.measure = "none";
    expect(acceptProblem(gap)).toBeNull();
    expect(acceptBody(gap)).toEqual({
      isVisible: true,
      translations: {
        en: { question: "Is he open to relocating?", answer: "He is, within the EU." },
      },
    });
    gap.text.en = { question: "", answer: "" };
    expect(acceptProblem(gap)).toBe("Write the entry in at least one language.");

    // A lesson needs words that say something, and a scope.
    const lesson = { ...acceptForm(proposal()), statement: "Answer it." };
    expect(acceptProblem(lesson)).toMatch(/at least 8 words/);
    expect(acceptBody({ ...acceptForm(proposal()), measure: "lesson:l9" }).lesson).toEqual({
      id: "l9",
    });
  });

  it("says the server's refusals in words", () => {
    expect(faqProposalWords("feature_off")).toBe(
      "Admin agents are switched off: Settings → Spending.",
    );
    expect(faqProposalWords("question_gone")).toMatch(/pruned/);
    expect(
      faqProposalWords("not_corroborated", { reason: "the topic has 3 questions; 5 needed" }),
    ).toBe("Not corroborated: the topic has 3 questions; 5 needed.");
    expect(faqProposalWords("http_503")).toBe(
      "The API failed (HTTP 503): try again; its log says why.",
    );
    expect(faqProposalWords("something_new")).toBe("something_new");
  });
});
