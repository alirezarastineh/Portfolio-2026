import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../test/ask-fixtures.js";
import { EVAL_CASES } from "./evals/cases.js";
import { fixtureAskCorpus } from "./evals/fixture.js";
import {
  contactIntentOf,
  escalationOf,
  routeLabels,
  routeQuestion,
  sensitivityOf,
  type StepToolResults,
} from "./router.js";

const options = { forceDeep: false, deepAllowed: true, projectNames: ["Atlas", "Borealis"] };

describe("sensitivityOf (the newspaper test)", () => {
  it.each([
    ["What salary does he expect?", "compensation"],
    ["What are his day rates?", "compensation"],
    ["How much does he charge per hour?", "compensation"],
    ["Wie hoch ist seine Gehaltsvorstellung?", "compensation"],
    ["Wie viel verdient er?", "compensation"],
    ["Does he need a visa to work in Germany?", "immigration"],
    ["Hat er eine Arbeitserlaubnis für die Schweiz?", "immigration"],
    ["Who are his clients?", "contract"],
    ["Is he under an NDA?", "contract"],
    ["Welche Kunden hatte er?", "contract"],
    ["How is his health?", "health"],
    ["Does he have a disability?", "health"],
    ["Ist er krank?", "health"],
    ["Is he married?", "family"],
    ["Does he have kids?", "family"],
    ["Hat er Kinder?", "family"],
    ["What are his politics?", "politics"],
    ["Who did he vote for?", "politics"],
    ["Wen wählt er?", "politics"],
    ["What is his home address?", "private"],
    ["What's his phone number?", "private"],
    ["What was his manager's name at Northwind?", "private"],
    ["Wie lautet seine Telefonnummer?", "private"],
    // The reviewer's misses (plan phase 20's second review), each its own topic.
    ["Is he authorized to work in the US?", "immigration"],
    ["Does he require work authorization?", "immigration"],
    ["Does he have a green card?", "immigration"],
    ["Does he have the right to work in the UK?", "immigration"],
    ["Would he need an H-1B?", "immigration"],
    ["What does he charge per day?", "compensation"],
    ["What does he earn?", "compensation"],
    ["How expensive is he?", "compensation"],
    ["Does he have any medical conditions?", "health"],
    ["Is he disabled?", "health"],
    ["What's the name of his manager at Northwind?", "private"],
    ["Who did he report to?", "private"],
    ["Who are his references?", "private"],
    ["Wer war sein Chef?", "private"],
    ["Wie heißt sein Vorgesetzter?", "private"],
  ])("flags %j as %s", (question, topic) => {
    expect(sensitivityOf(question)).toBe(topic);
  });

  it.each([
    "What rate limits does Atlas use?",
    "How does Atlas run its health checks?",
    "Did he build a mental health app?",
    "Has he built apps for people with disabilities?",
    "Did he work on medical imaging?",
    "Welche Vorträge hat er gehalten?",
    "Welche Datenbank wählt er für Analytics?",
    "Is he open to contract work?",
    "Ist er offen für Freelance-Verträge?",
    "Does Borealis accept Visa card payments?",
    "Did he build apps for kids?",
    "How does voting work in his polling app?",
    "What's his email?",
    "Where is he based?",
    // The reviewer's false positives: a project in such a domain is a project.
    "What is his mobile experience?",
    "Tell me about his mobile apps",
    "How do his rate limits work?",
    "What daily rate limit does this assistant use?",
    "How does Borealis handle compensation in its saga?",
    "Did he integrate Visa payments?",
    "Which clients does the Borealis API support?",
    "Did his app track health conditions?",
    "Did he build a pregnancy-tracking app?",
    "Has he worked on political campaign software?",
    "Did he build software for immigration lawyers?",
    "Wie funktioniert seine Telefonnummer-Validierung?",
    "How many years of experience does he have in his number crunching?",
  ])("leaves %j alone", (question) => {
    expect(sensitivityOf(question)).toBeNull();
  });
});

describe("contactIntentOf (visitor plan V6)", () => {
  it.each([
    "I'd like to hire him for a six-month contract. How do we start?",
    "I’d like to hire him.",
    "Can we hire Alireza?",
    "How can I hire him?",
    "Is it possible to hire him as a contractor?",
    "We're hiring a staff engineer. Would he be interested?",
    "Is he available for hire?",
    "Would he join our team?",
    "How do I contact him?",
    "What's the best way to reach him?",
    "Can I email you about a role?",
    "How can I get in touch?",
    "I'd love to get in touch with Alireza.",
    "Can I speak to him this week?",
    "My email is jane.doe@example.com, please send him my CV.",
    "We'd like to interview him for a senior role.",
    "Can we schedule a call with him?",
    "I want to work with him on a RAG project.",
    "We'd be happy to work with him.",
    "I'm interested in working with Alireza.",
    "Could we work together on our platform?",
    "Let's work together.",
    "We have a project for him.",
    "Can I get a quote for a small website?",
    "Could he give us a quote?",
    "How do we start?",
    "What are the next steps?",
    "Wir würden ihn gern einstellen.",
    "Können wir Alireza beauftragen?",
    "Kann man ihn für Projekte buchen?",
    "Wie kann ich ihn kontaktieren?",
    "Wie erreiche ich ihn?",
    "Ich möchte Kontakt aufnehmen.",
    "Wie komme ich mit ihm in Kontakt?",
    "Können wir mit ihm zusammenarbeiten?",
    "Wir hätten gern ein Vorstellungsgespräch mit ihm.",
    "Ich hätte gern ein Angebot für unsere App.",
    "Kann er uns ein Angebot machen?",
    "Wir haben ein Projekt für ihn.",
    "Schick ihm meinen Lebenslauf.",
    "Wie fangen wir an?",
  ])("flags %j", (question) => {
    expect(contactIntentOf(question)).toBe("contact");
  });

  it.each([
    // What he did, or what others did with him.
    "Did he hire engineers?",
    "Has he hired or led a team?",
    "Why did Northwind hire him?",
    "Would a startup hire him for this?",
    "Who did he work with at Northwind?",
    "What's it like to work with him?",
    "Does he interview candidates?",
    "How did he start his career?",
    // Words that look like it.
    "Does he do contract testing?",
    "How does he handle client contracts?",
    "Can you quote his post on evals?",
    "Is there a quote from his manager?",
    "Tell me about the Contact Form Builder project.",
    "How did he build the contact form?",
    "How do we start a RAG project?",
    "Can I chat with you about his projects?",
    "What do you call his Atlas pipeline?",
    "Is he open to new roles?",
    // German.
    "Hat er Leute eingestellt?",
    "Mit wem hat er zusammengearbeitet?",
    "Wie ist es, mit ihm zu arbeiten?",
    "Wie geht er mit Kundenverträgen um?",
    "Was hat er mit Atlas erreicht?",
    "Welche Angebote nutzt Atlas?",
    "Wie geht es weiter mit Atlas?",
    "Wer hat ihn eingestellt?",
  ])("leaves %j alone", (question) => {
    expect(contactIntentOf(question)).toBeNull();
  });

  it("flags exactly the eval cases that ask to reach him, and not the near miss", () => {
    const flagged = EVAL_CASES.filter((c) => contactIntentOf(c.question)).map((c) => c.id);
    expect(flagged.sort()).toEqual([
      "conv-handoff",
      "pii-send",
      "tool-hire",
      "tool-hire-de",
      "tool-interview",
    ]);
    // Every case that expects the offer asks for it.
    for (const c of EVAL_CASES.filter((c) => c.expectTool?.name === "handoff_contact")) {
      expect(flagged, c.id).toContain(c.id);
    }
  });

  it("keeps the intent on the decision, whatever the route, with its reason unchanged", () => {
    expect(routeQuestion("How can I hire him?", options)).toEqual({
      route: "lite",
      reason: "default",
      intent: "contact",
    });
    expect(routeQuestion("Who do I contact to hire him?", options)).toMatchObject({
      intent: "contact",
      lookup: true,
    });
    expect(routeQuestion("Why would we hire him over others?", options)).toMatchObject({
      route: "deep",
      intent: "contact",
    });
    expect(routeQuestion("Where is he based?", options).intent).toBeUndefined();
  });
});

describe("routeQuestion", () => {
  it("adds the careful topic to the route and its reason, whichever the route", () => {
    expect(routeQuestion("What salary does he expect?", options)).toEqual({
      route: "lite",
      reason: "default+sensitive:compensation",
      sensitive: "compensation",
    });
    expect(routeQuestion("Compare his rates for Atlas and Borealis", options)).toEqual({
      route: "deep",
      reason: "compare+sensitive:compensation",
      sensitive: "compensation",
    });
  });

  it("gives a short who/where/when/which question the lookup tier", () => {
    expect(routeQuestion("Where is he based?", options)).toEqual({
      route: "lite",
      reason: "default+lookup",
      lookup: true,
    });
    expect(routeQuestion("  Wo wohnt er?", options).lookup).toBe(true);
    expect(routeQuestion("Welche Sprachen spricht er?", options).lookup).toBe(true);
    expect(routeQuestion("Which stack does Borealis use?", options).lookup).toBe(true);
  });

  it("keeps the lookup tier from anything long, open, sensitive, deep or commanded", () => {
    const long = "Where did he work before he joined Northwind and what did he do there?";
    expect(routeQuestion(long, options).lookup).toBeUndefined();
    expect(routeQuestion("Is he available?", options).lookup).toBeUndefined();
    expect(routeQuestion("Which clients did he work for?", options).lookup).toBeUndefined();
    expect(routeQuestion("Which is better, Atlas or Borealis?", options)).toEqual({
      route: "deep",
      reason: "multi-project",
    });
    const forced = { ...options, forceDeep: true, deepAllowed: false };
    expect(routeQuestion("Where is he based?", forced)).toEqual({
      route: "lite",
      reason: "deep-off",
    });
    // With the deep route off, a lookup still gets its tier.
    expect(routeQuestion("Where is he based?", { ...options, deepAllowed: false }).lookup).toBe(
      true,
    );
  });

  it("never gives the lookup tier to what the deep route would take, open or closed", () => {
    const closed = { ...options, deepAllowed: false };
    for (const question of [
      "Which trade-offs did he make in Atlas?",
      "Which architecture did Borealis use, and why?",
      "Which is better, Atlas or Borealis?",
    ]) {
      const open = routeQuestion(question, options);
      expect(open.route).toBe("deep");
      const shut = routeQuestion(question, closed);
      expect(shut).toMatchObject({ route: "lite", reason: `${open.reason}+deep-off` });
      expect(shut.lookup).toBeUndefined();
    }
  });

  it("keeps a judgment off the lookup tier, however short", () => {
    for (const question of [
      "Which database would he pick for a multi-tenant SaaS?",
      "When would he choose Kafka over Postgres?",
      "Which cloud does he prefer?",
      "Welche Datenbank würde er wählen?",
    ]) {
      expect(routeQuestion(question, options).lookup, question).toBeUndefined();
    }
  });
});

describe("escalationOf", () => {
  const fetched = (id: string | undefined): StepToolResults => ({
    toolResults: [
      { toolName: "get_document", output: id ? { id, text: "…" } : { error: "not_found" } },
    ],
  });
  const searched = (...ids: string[]): StepToolResults => ({
    toolResults: [{ toolName: "search_portfolio", output: { results: ids.map((id) => ({ id })) } }],
  });

  it("stays put until two projects are fetched, whichever the language", () => {
    expect(escalationOf([])).toBeNull();
    expect(escalationOf([fetched("project:atlas@en")])).toBeNull();
    expect(escalationOf([fetched("project:atlas@en"), fetched("project:atlas@de")])).toBeNull();
    expect(escalationOf([fetched("project:atlas@en"), fetched(undefined)])).toBeNull();
    expect(escalationOf([fetched("cv@en"), fetched("post:llm@en")])).toBeNull();
    expect(
      escalationOf([
        fetched("project:atlas@en"),
        { toolResults: [{ toolName: "get_document", output: { id: "project:borealis@de" } }] },
      ]),
    ).toBe("projects-fetched");
  });

  it("moves up when one search's two best hits are two projects", () => {
    expect(escalationOf([searched("project:atlas@en", "post:llm@en", "cv@en")])).toBeNull();
    expect(escalationOf([searched("project:atlas@en", "project:atlas@de")])).toBeNull();
    expect(escalationOf([searched("project:atlas@en", "project:borealis@en", "faq:x@en")])).toBe(
      "search-spans-projects",
    );
    // A weaker match lower down is often what every project shares (a "Role:" line).
    expect(
      escalationOf([searched("profile@en", "project:atlas@en", "project:borealis@en")]),
    ).toBeNull();
    expect(
      escalationOf([searched("project:atlas@en", "faq:x@en", "project:borealis@en")]),
    ).toBeNull();
    expect(
      escalationOf([{ toolResults: [{ toolName: "search_portfolio", output: { results: [] } }] }]),
    ).toBeNull();
    expect(
      escalationOf([{ toolResults: [{ toolName: "get_document", output: null }] }]),
    ).toBeNull();
  });
});

describe("the eval cases' routes", () => {
  it("are what each case expects, before any model answers (lite→deep needs the answer)", () => {
    const projectNames = fixtureAskCorpus(fixtureConfig()).projects.map((p) => p.name);
    const wrong = EVAL_CASES.filter((c) => c.expectRoute && c.expectRoute !== "lite→deep")
      .map((c) => {
        const labels = routeLabels(
          routeQuestion(c.question, { forceDeep: false, deepAllowed: true, projectNames }),
          false,
        );
        return labels.includes(c.expectRoute!) ? null : `${c.id}: ${labels.join("+")}`;
      })
      .filter(Boolean);
    expect(wrong).toEqual([]);
    expect(EVAL_CASES.filter((c) => c.expectRoute === "sensitive").length).toBeGreaterThanOrEqual(
      5,
    );
    // No other case trips the newspaper test by accident.
    const careful = EVAL_CASES.filter((c) => sensitivityOf(c.question)).map((c) => c.id);
    expect(careful.sort()).toEqual(
      EVAL_CASES.filter((c) => c.expectRoute === "sensitive")
        .map((c) => c.id)
        .sort(),
    );
  });
});

describe("routeLabels", () => {
  it("names the router's route, a move up, then the lookup and careful tiers", () => {
    expect(routeLabels({ route: "lite", reason: "default+lookup", lookup: true }, false)).toEqual([
      "lite",
      "lookup",
    ]);
    // Routed lite, then moved up: it meets a case that expects either.
    expect(routeLabels({ route: "lite", reason: "default" }, true)).toEqual(["lite", "lite→deep"]);
    expect(
      routeLabels(
        { route: "deep", reason: "compare+sensitive:compensation", sensitive: "compensation" },
        false,
      ),
    ).toEqual(["deep", "sensitive"]);
  });
});
