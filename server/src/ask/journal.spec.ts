import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../test/ask-fixtures.js";
import type { CorpusDocument } from "./corpus/build.js";
import { coreLimit, heldText } from "./corpus/render.js";
import { fixtureAskCorpus } from "./evals/fixture.js";
import {
  categoryOf,
  contentWords,
  diagnose,
  sameWord,
  symptomsOf,
  type DiagnosisAnswer,
  type DiagnosisInput,
  type HypothesisId,
  type JournalDiagnosis,
  type ReplayResult,
} from "./journal.js";
import type { AnswerTrace, TraceStep, TraceTool } from "./trace.js";

/**
 * Plan phase 24: the Diagnose agent's experiments, each hypothesis's evidence
 * for and against, the ranking, and the proposal. Pure: the answer and the
 * corpora are built here.
 */

const filler = "A long case study line about the platform and its teams.\n".repeat(60);
const LONG: CorpusDocument = {
  id: "project:long@en",
  kind: "project",
  locale: "en",
  title: "Long",
  url: "/en/work/long",
  text: `${filler}In 2023 he migrated the clusters to Kubernetes with zero downtime.`,
};
const DOCS: CorpusDocument[] = [
  {
    id: "profile@en",
    kind: "profile",
    locale: "en",
    title: "Alireza Rastineh",
    url: "/en",
    text: "Alireza Rastineh — Senior AI engineer\nLocation: Berlin",
  },
  LONG,
  {
    id: "project:atlas@en",
    kind: "project",
    locale: "en",
    title: "Atlas",
    url: "/en/work/atlas",
    text: "Atlas — a support assistant\nStack: Python, pgvector",
  },
  {
    id: "post:kosten@de",
    kind: "post",
    locale: "de",
    title: "Kosten im Griff",
    url: "/de/writing/kosten",
    text: "Budgets für Sprachmodelle: jede Funktion hat eine Obergrenze pro Tag.",
  },
];

const MODEL = "gemini-3.5-flash-lite";

const tool = (name: string, input: unknown, extra: Partial<TraceTool> = {}): TraceTool => ({
  name,
  input: JSON.stringify(input),
  outcome: "ok",
  resultChars: 200,
  ...extra,
});

const step = (tools: TraceTool[] = [], extra: Partial<TraceStep> = {}): TraceStep => ({
  model: MODEL,
  answerOnly: false,
  ttftMs: 700,
  tokens: { input: 1000, cached: 0, output: 50, thoughts: 0 },
  finishReason: "stop",
  passedOver: [],
  tools,
  ...extra,
});

const trace = (steps: TraceStep[], extra: Partial<AnswerTrace> = {}): AnswerTrace => ({
  v: 1,
  steps,
  core: { locale: "en", layout: "locale", tokens: 1200 },
  routing: { reason: "default" },
  ...extra,
});

function answer(overrides: Partial<DiagnosisAnswer> = {}): DiagnosisAnswer {
  return {
    id: "m_journal0001",
    locale: "en",
    question: "Did he migrate the clusters to Kubernetes?",
    answer: "That is not in the portfolio.",
    citedIds: [],
    toolCalls: [],
    model: MODEL,
    route: "lite",
    finishReason: "stop",
    ttftMs: 700,
    totalMs: 1_800,
    flags: [],
    checked: true,
    feedback: null,
    faithfulness: null,
    rephrased: false,
    promptVersion: "ask-test+abc",
    corpusKey: "snap#1",
    attempts: [{ model: MODEL, outcome: "ok", ms: 700 }],
    trace: trace([step()]),
    ...overrides,
  };
}

const run = (overrides: Partial<DiagnosisInput> = {}): JournalDiagnosis =>
  diagnose({
    answer: answer(),
    snapshot: DOCS,
    live: DOCS,
    projectNames: ["Long", "Atlas"],
    ...overrides,
  });

const hypothesis = (d: JournalDiagnosis, id: HypothesisId) =>
  d.hypotheses.find((h) => h.id === id)!;
const observations = (d: JournalDiagnosis, id: HypothesisId, supports: boolean) =>
  hypothesis(d, id)
    .evidence.filter((e) => e.supports === supports)
    .map((e) => e.observation);

describe("the question's words", () => {
  it("keeps what it asks about, without function words, placeholders or repeats", () => {
    expect(contentWords("Did he migrate the clusters to Kubernetes? Kubernetes!")).toEqual([
      "migrate",
      "clusters",
      "kubernetes",
    ]);
    expect(contentWords("Mail [email] or call [number] about Atlas")).toEqual([
      "mail",
      "call",
      "atlas",
    ]);
    expect(contentWords("Wie lange ist seine Kündigungsfrist?")).toEqual([
      "lange",
      "kündigungsfrist",
    ]);
    expect(contentWords(Array.from({ length: 20 }, (_, i) => `word${i}`).join(" "))).toHaveLength(
      12,
    );
  });

  it("matches a word inflected, never a whole word inside a longer one", () => {
    const same: [string, string][] = [
      ["llm", "llms"],
      ["relocating", "relocation"],
      ["located", "location"],
      ["migrate", "migrated"],
      ["migrate", "migration"],
      ["notice", "notices"],
      ["company", "companies"],
      ["kündigungsfrist", "kündigungsfristen"],
      ["erfahrung", "erfahrungen"],
      ["funktion", "funktionen"],
    ];
    const different: [string, string][] = [
      ["atlas", "atlassian"],
      ["ops", "mlops"],
      ["post", "postgres"],
      ["team", "teamwork"],
      ["go", "goal"],
      ["contract", "contrast"],
      ["migrate", "migraine"],
    ];
    for (const [a, b] of same) expect(sameWord(a, b), `${a}/${b}`).toBe(true);
    for (const [a, b] of different) expect(sameWord(a, b), `${a}/${b}`).toBe(false);
  });
});

describe("symptoms", () => {
  it("are read from the answer, the most telling first", () => {
    const symptoms = symptomsOf(
      answer({
        flags: ["uncited", "degraded", "injection-attempt"],
        feedback: -1,
        rephrased: true,
      }),
    );
    // "That is not in the portfolio." is an unknown; the question's own flag is no symptom.
    expect(symptoms).toEqual(["unknown", "uncited", "degraded", "thumbs-down", "rephrased"]);
    expect(categoryOf({ symptoms })).toBe("unknown");
    expect(categoryOf({ symptoms: [] })).toBe("reported");
    expect(symptomsOf(answer({ answer: "", finishReason: "error:timeout" }))).toEqual(["failed"]);
    expect(symptomsOf(answer({ answer: "Fine.", faithfulness: 0.5 }))).toEqual(["unfaithful"]);
  });
});

describe("diagnose", () => {
  it("names a fact past the cut of a clipped document, never fetched (the done-when)", () => {
    const d = run();
    expect(d.leading).toBe("context-unused");
    expect(d.located).toMatchObject({
      id: "project:long@en",
      named: false,
      position: "rest",
      pastCut: ["migrated", "clusters", "kubernetes"],
      held: heldText(LONG).length,
      length: LONG.text.length,
    });
    expect(d.located!.held).toBeLessThanOrEqual(coreLimit(LONG)!);
    expect(observations(d, "context-unused", true)).toEqual([
      `The core held project:long@en cut at ${d.located!.held.toLocaleString("en-GB")} of ${LONG.text.length.toLocaleString("en-GB")} characters; migrated, clusters, kubernetes lie past the cut`,
      "It never fetched project:long@en",
    ]);
    // The fact is there, a search finds it, the first model answered, nothing failed.
    expect(hypothesis(d, "content-missing").ratio).toBe(0);
    expect(observations(d, "retrieval-miss", false)).toEqual([
      "A search for the question's words returns project:long@en at rank 1: a search would have found it",
    ]);
    for (const id of ["degraded-model", "language", "under-routed", "infrastructure"] as const) {
      expect(hypothesis(d, id).ratio, id).toBe(0);
    }
    expect(d.proposal).toMatchObject({
      fixType: "content",
      fixRef: "project:long@en",
      fix: `Promote project:long@en (Overview → Perception holds it whole), or move the fact before the cut at ${d.located!.held.toLocaleString("en-GB")} characters.`,
    });
    expect(d.proposal.rootCause).toMatch(
      /^Context clipped or unused: The core held project:long@en/,
    );
    expect(d.proposal.heuristic.split(/\s+/).length).toBeGreaterThanOrEqual(8);
    expect(d.next).toEqual([]);
    expect(d.context).toMatchObject({
      reading: "en",
      layout: "locale",
      corpus: "snapshot",
      traced: true,
      steps: 1,
    });
  });

  it("reads a fetch that still missed the fact as unused context, and proposes a prompt test", () => {
    const d = run({
      answer: answer({
        toolCalls: ["get_document"],
        trace: trace([step([tool("get_document", { id: "project:long" })]), step()]),
      }),
    });
    expect(d.leading).toBe("context-unused");
    expect(observations(d, "context-unused", true)).toContain(
      "It fetched project:long@en (step 1): the whole text was in context",
    );
    expect(observations(d, "retrieval-miss", false)).toContain(
      "It fetched project:long@en: retrieval reached it",
    );
    expect(d.proposal.fixType).toBe("prompt");
  });

  it("counts a fetch the document budget refused for clipped context", () => {
    const d = run({
      answer: answer({
        trace: trace([
          step([tool("get_document", { id: "project:long@en" }, { outcome: "budget_exhausted" })]),
        ]),
      }),
    });
    expect(observations(d, "context-unused", true)).toContain(
      "Its fetch of project:long@en was refused (step 1): the answer's document budget was spent",
    );
    expect(d.proposal.fixType).toBe("content");
  });

  it("reads a document held whole as context unused, with nothing to retrieve", () => {
    const d = run({ answer: answer({ question: "Where is he located? Berlin?" }) });
    expect(d.located).toMatchObject({ id: "profile@en", position: "whole" });
    expect(observations(d, "context-unused", true)).toEqual([
      "The core held profile@en whole: its text was in context",
    ]);
    expect(observations(d, "retrieval-miss", false)).toEqual([
      "Nothing had to be retrieved: profile@en was in context",
    ]);
  });

  it("supports content missing when no document holds the question's words, and asks for the document", () => {
    const d = run({ answer: answer({ question: "Does he speak fluent Japanese?" }) });
    expect(d.located).toBeNull();
    expect(d.leading).toBe("content-missing");
    expect(observations(d, "content-missing", true)).toEqual([
      "No document holds any of the question's 3 content words",
    ]);
    expect(d.proposal).toMatchObject({ fixType: "faq", fixRef: null });
    expect(d.next[0]).toMatch(/^Nothing in the corpus holds most of the question's words/);
  });

  it("finds content added since the answer, in today's corpus", () => {
    const d = run({ snapshot: DOCS.filter((doc) => doc.id !== LONG.id) });
    expect(d.located).toBeNull();
    expect(d.addedSince).toBe("project:long@en");
    expect(observations(d, "content-missing", true)).toContain(
      "Today's corpus has it: project:long@en holds 3 of the question's 3 content words (migrated, clusters, kubernetes); the answer's corpus did not",
    );
    expect(d.proposal).toMatchObject({ fixType: "faq", fixRef: "project:long@en" });
    expect(d.proposal.fix).toMatch(/^Already added since: project:long@en/);
  });

  it("reads today's corpus when the answer's was not kept, and says so", () => {
    const d = run({ snapshot: null });
    expect(d.context.corpus).toBe("live");
    expect(d.untested).toContain(
      "The answer's corpus was not kept: the experiments read today's corpus.",
    );
    expect(d.leading).toBe("context-unused");
  });

  it("says which experiments an answer without a trace could not run", () => {
    const d = run({ answer: answer({ trace: null, attempts: [] }) });
    expect(d.untested).toContain(
      "No trace (an answer from before traces were kept): the experiments on its steps could not run.",
    );
    expect(d.context.layout).toBe("both");
    // Held in one core with both languages, still cut short: the place says enough.
    expect(d.located?.position).toBe("rest");
    expect(hypothesis(d, "degraded-model").evidence).toEqual([]);
  });

  it("supports a retrieval miss when its own searches never returned the fact", () => {
    const d = run({
      answer: answer({
        toolCalls: ["search_portfolio"],
        trace: trace([
          step([tool("search_portfolio", { query: "cloud work" }, { hits: ["project:atlas@en"] })]),
          step(),
        ]),
      }),
    });
    expect(observations(d, "retrieval-miss", true)).toEqual([
      "Its 1 search returned 1 document, never project:long@en",
      "A search for the question's words returns project:long@en at rank 1; its own queries did not",
    ]);
    // Level with clipped context: the order breaks the tie, and the next step says so.
    expect(d.leading).toBe("retrieval-miss");
    expect(d.next).toContain(
      "Retrieval miss and Context clipped or unused are level: the evidence does not separate them yet.",
    );
    expect(d.proposal).toMatchObject({ fixType: "retrieval", fixRef: "project:long@en" });
  });

  it("counts a search that found the fact against a retrieval miss", () => {
    const d = run({
      answer: answer({
        trace: trace([
          step([
            tool(
              "search_portfolio",
              { query: "kubernetes" },
              { hits: ["project:atlas@en", "project:long@en"], semantic: false },
            ),
          ]),
        ]),
      }),
    });
    expect(observations(d, "retrieval-miss", false)).toEqual([
      "Its search (step 1) returned project:long@en at rank 2",
    ]);
  });

  /** The eval fixture's `fact-llm-ops`: the post found by meaning, cited, never fetched past the cut. */
  function llmOps(expected?: string): JournalDiagnosis {
    const corpus = fixtureAskCorpus(fixtureConfig());
    const id = "post:llm-in-production@en";
    return diagnose({
      answer: answer({
        question: "Has he written about LLM ops?",
        answer:
          "He wrote about shipping language models to real users [^post:llm-in-production@en].",
        citedIds: [id],
        toolCalls: ["search_portfolio"],
        trace: trace([
          step([
            tool(
              "search_portfolio",
              { query: "LLM ops" },
              { hits: [id, "post:evals-first@en"], semantic: true },
            ),
          ]),
          step(),
        ]),
      }),
      snapshot: corpus.documents,
      live: corpus.documents,
      projectNames: corpus.projects.map((p) => p.name),
      expected,
    });
  }

  it("reads the LLM-ops failure as clipped context on its own: cited, read in part, never fetched", () => {
    const id = "post:llm-in-production@en";
    const d = llmOps();
    // Its words are not the post's (a synonym), so the fact is not placed…
    expect(d.located).toBeNull();
    // …but the answer cited a post it read only in part: the absence is not established.
    const partly = expect.stringMatching(
      /^It cited post:llm-in-production@en but read only its first 1,[0-9]{3} of [0-9,]+ characters, and never fetched the rest/,
    );
    expect(observations(d, "context-unused", true)).toEqual([partly]);
    expect(observations(d, "content-missing", false)).toEqual([partly]);
    expect(d.leading).toBe("context-unused");
    expect(d.proposal).toMatchObject({ fixType: "content", fixRef: id });
    expect(d.proposal.fix).toMatch(/^Promote post:llm-in-production@en/);
    // And it asks for the document, to confirm where the fact is.
    expect(d.next[0]).toMatch(/^Nothing in the corpus holds most of the question's words/);
  });

  it("reads the LLM-ops failure as clipped context once the admin names the post", () => {
    const id = "post:llm-in-production@en";
    const d = llmOps("post:llm-in-production");
    expect(d.located).toMatchObject({ id, named: true, position: "clipped", words: [] });
    expect(d.leading).toBe("context-unused");
    expect(observations(d, "context-unused", true)).toEqual([
      expect.stringMatching(/^The core held post:llm-in-production@en cut at 1,[0-9]{3} of /),
      "It never fetched post:llm-in-production@en",
      "It cited post:llm-in-production@en, the document that holds the answer, and still fell short",
    ]);
    // "Almost working": found and cited, so neither the content nor the retrieval failed.
    expect(observations(d, "retrieval-miss", false)).toEqual([
      "Its search (step 1) returned post:llm-in-production@en at rank 1",
      "It cited post:llm-in-production@en, the document that holds the answer, and still fell short",
    ]);
    expect(d.proposal).toMatchObject({ fixType: "content", fixRef: id });
  });

  it("puts a failure in the infrastructure, and leaves the corpus experiments out", () => {
    const d = run({
      answer: answer({
        answer: "",
        model: null,
        finishReason: "error:unavailable",
        attempts: [{ model: MODEL, outcome: "timeout", ms: 6_000 }],
        trace: trace([
          step([], {
            model: null,
            ttftMs: null,
            tokens: null,
            finishReason: null,
            passedOver: [{ model: MODEL, outcome: "timeout", ms: 6_000 }],
          }),
        ]),
      }),
    });
    expect(d.symptoms).toEqual(["failed"]);
    expect(d.leading).toBe("infrastructure");
    expect(observations(d, "infrastructure", true)).toEqual([
      "It finished with error:unavailable",
      `Step 1: no model could answer (${MODEL} (timeout))`,
    ]);
    expect(d.untested).toContain(
      "The answer was not written (error:unavailable): the experiments on its use of the corpus do not apply.",
    );
    expect(hypothesis(d, "context-unused").evidence).toEqual([]);
    expect(d.proposal).toMatchObject({ fixType: "infra", fixRef: MODEL });
  });

  it("sees a fallback in the passed-over models", () => {
    const d = run({
      answer: answer({
        model: "nemotron-ultra",
        trace: trace([
          step([], {
            model: "nemotron-ultra",
            passedOver: [{ model: MODEL, outcome: "rate-limited", ms: 120 }],
          }),
        ]),
      }),
    });
    expect(observations(d, "degraded-model", true)).toEqual([
      `Step 1: ${MODEL} (rate-limited) passed over; nemotron-ultra answered`,
    ]);
    expect(observations(d, "infrastructure", true)).toEqual([
      `Step 1: ${MODEL} rate-limited after 120 ms`,
    ]);
  });

  it("supports language for the flag, and for a fact only in the other language", () => {
    const flagged = run({ answer: answer({ answer: "Er hat es getan.", flags: ["language"] }) });
    expect(observations(flagged, "language", true)).toEqual([
      "Flagged language: the answer was not in the visitor's language",
    ]);
    const german = run({
      answer: answer({ question: "Does each function have a daily budget limit? Obergrenze" }),
      expected: "post:kosten@de",
    });
    expect(observations(german, "language", true)).toEqual([
      "post:kosten@de exists only in German; the answer was in English",
    ]);
    // H5 leading with such a document: translate it.
    const translate = run({
      answer: answer({
        question: "Does each function have a daily budget limit? Obergrenze",
        flags: ["language"],
      }),
      expected: "post:kosten@de",
    });
    expect(translate.leading).toBe("language");
    expect(translate.proposal).toMatchObject({
      fixType: "content",
      fixRef: "post:kosten@de",
      fix: "Translate post:kosten@de into English.",
    });
    // A failed answer says nothing about its language.
    const failedAnswer = run({
      answer: answer({ answer: "", finishReason: "error:timeout" }),
      expected: "post:kosten@de",
    });
    expect(hypothesis(failedAnswer, "language").evidence).toEqual([]);
  });

  it("weighs the route: closed deep route, lookup tier and false-simple signals for, deep against", () => {
    const d = run({
      answer: answer({
        question: "Compare Atlas and Long",
        feedback: -1,
        flags: ["uncited"],
        trace: trace([step()], { routing: { reason: "compare+deep-off" } }),
      }),
    });
    expect(observations(d, "under-routed", true)).toEqual([
      "The router wanted the deep route (compare+deep-off), but it was closed",
      "A false-simple candidate: kept lite, then flagged uncited, a thumbs-down",
    ]);
    expect(d.leading).toBe("under-routed");
    expect(d.proposal).toMatchObject({ fixType: "routing", fixRef: null });
    expect(d.next).toContain(
      "Replay it on both chains (paid) to test the model, the route and a passing outage.",
    );
    const escalated = run({
      answer: answer({
        route: "lite→deep",
        trace: trace([step(), step()], { escalation: { step: 1, reason: "projects-fetched" } }),
      }),
    });
    expect(observations(escalated, "under-routed", false)).toEqual([
      "It moved to the deep chain at step 2 (projects-fetched)",
    ]);

    const deep = run({ answer: answer({ route: "deep" }) });
    expect(observations(deep, "under-routed", false)).toEqual([
      "The deep chain answered (route deep)",
    ]);
    const lookup = run({
      answer: answer({
        question: "Where did he migrate the clusters to Kubernetes?",
        trace: trace([step()], { routing: { reason: "default+lookup", lookup: true } }),
      }),
    });
    expect(observations(lookup, "under-routed", true)).toEqual([
      "Answered in the lookup tier, with minimal thinking",
    ]);
  });

  it("re-routes an untraced answer with today's router", () => {
    const d = run({
      answer: answer({ question: "What is the difference between Atlas and Long?", trace: null }),
    });
    expect(observations(d, "under-routed", true)).toEqual([
      "Today's router sends it deep (compare); it was answered lite",
    ]);
  });

  it("merges a replay: the deep chain answering supports under-routing", () => {
    const result = (chain: "lite" | "deep", over: Partial<ReplayResult>): ReplayResult => ({
      chain,
      model: chain === "lite" ? MODEL : "gemini-3.7-flash",
      finishReason: "stop",
      answered: true,
      unknown: false,
      cited: [],
      flags: [],
      usd: 0.001,
      unavailable: false,
      ...over,
    });
    const replay = (results: ReplayResult[]) => ({
      runId: "00000000-0000-4000-8000-000000000001",
      at: "2026-10-07T10:00:00.000Z",
      corpusKey: "live#1",
      results,
    });

    const deepAnswers = run({
      replay: replay([
        result("lite", { answered: false, unknown: true }),
        result("deep", { cited: ["project:long@en"] }),
      ]),
    });
    expect(deepAnswers.replayed).toBe(true);
    expect(observations(deepAnswers, "under-routed", true)).toContain(
      `Replayed today, the deep chain answers it (gemini-3.7-flash); the lite chain does not (${MODEL})`,
    );

    // "Almost working" counts against: the deep chain found the document and still failed.
    const almost = run({
      replay: replay([
        result("lite", { answered: false, unknown: true }),
        result("deep", { answered: false, unknown: true, cited: ["project:long@en"] }),
      ]),
    });
    const observation =
      "Replayed on the deep chain, gemini-3.7-flash cited project:long@en and still said it isn't there";
    expect(observations(almost, "context-unused", true)).toContain(observation);
    expect(observations(almost, "degraded-model", false)).toContain(observation);
    expect(observations(almost, "under-routed", false)).toContain(observation);
    expect(observations(almost, "infrastructure", false)).toContain(
      "Replayed today, both chains fail it: not a passing outage",
    );
    expect(almost.leading).toBe("context-unused");

    const down = run({ replay: replay([result("lite", { unavailable: true, answered: false })]) });
    expect(down.untested).toContain("The replay on the lite chain found no model answering.");
  });

  it("is undetermined when nothing has more evidence for than against", () => {
    const d = run({
      answer: answer({ question: "Hi there!", answer: "Hello! Ask me about the portfolio." }),
    });
    expect(d.leading).toBeNull();
    expect(d.proposal).toEqual({
      rootCause: "",
      fixType: null,
      fix: "",
      fixRef: null,
      heuristic: "",
    });
    expect(d.untested).toContain("The question has no content words to look for.");
    expect(d.next).toContain(
      "No hypothesis has more evidence for than against: name the document that holds the answer, or replay it.",
    );
  });

  it("stores no word of the question that no document has, located or not", () => {
    const found = run({
      answer: answer({ question: "Did he migrate the clusters to Kubernetes for Zyxqvbx?" }),
    });
    // The corpus's spelling of the words it has; nothing of the rest.
    expect(found.located?.words).toEqual(["migrated", "clusters", "kubernetes"]);
    expect(JSON.stringify(found).toLowerCase()).not.toContain("zyxqvbx");

    const missed = run({
      answer: answer({ question: "Did Zyxqvbx migrate clusters for Qwertzia at Plovdivsoft?" }),
    });
    expect(missed.located).toBeNull();
    const stored = JSON.stringify(missed).toLowerCase();
    for (const secret of ["zyxqvbx", "qwertzia", "plovdivsoft"]) {
      expect(stored).not.toContain(secret);
    }
    expect(observations(missed, "content-missing", true)[0]).toMatch(
      /^No document holds most of the question's words: the closest, project:long@en, has 2 of 5 \(migrated, clusters\)/,
    );
  });
});

describe("each experiment's other outcomes", () => {
  const filler = (line: string) => `${line}\n`.repeat(60);

  it("places a fact before the cut (held) as context unused, with nothing to retrieve", () => {
    const early: CorpusDocument = {
      ...LONG,
      id: "project:early@en",
      title: "Early",
      text: `In 2023 he migrated the clusters to Kubernetes.\n${filler("A long case study line about the platform and its teams.")}`,
    };
    const d = run({ snapshot: [DOCS[0]!, early], live: [DOCS[0]!, early] });
    expect(d.located).toMatchObject({ id: "project:early@en", position: "held" });
    expect(observations(d, "context-unused", true)).toEqual([
      `The core held project:early@en cut at ${d.located!.held.toLocaleString("en-GB")} of ${early.text.length.toLocaleString("en-GB")} characters, with the matching words before the cut`,
    ]);
    expect(observations(d, "retrieval-miss", false)).toEqual([
      "Nothing had to be retrieved: project:early@en was in context",
    ]);
    // In context and unused: the instructions, tested on a frozen case.
    expect(d.proposal).toMatchObject({ fixType: "prompt", fixRef: null });
  });

  it("places a fact in the other language's complete version as a handle", () => {
    const atlasDe: CorpusDocument = {
      id: "project:atlas@de",
      kind: "project",
      locale: "de",
      title: "Atlas",
      url: "/de/work/atlas",
      text: "Atlas — ein Support-Assistent\nStack: Python, pgvector",
    };
    const docs = [...DOCS, atlasDe];
    const d = run({ snapshot: docs, live: docs, expected: "project:atlas@de" });
    expect(d.located).toMatchObject({ id: "project:atlas@de", position: "handle", held: 0 });
    expect(observations(d, "context-unused", true)).toEqual([
      "project:atlas@de was one line in the English core (a handle): its text was one get_document away",
      "It never fetched project:atlas@de",
    ]);
    expect(d.proposal).toMatchObject({
      fixType: "content",
      fixRef: "project:atlas@de",
      fix: "Promote project:atlas@de (Overview → Perception holds it whole), or make sure its English version says it too.",
    });
  });

  it("supports a retrieval miss when the search would not return the fact, saying why", () => {
    const lang: CorpusDocument = {
      id: "post:grenzen@de",
      kind: "post",
      locale: "de",
      title: "Grenzen",
      url: "/de/writing/grenzen",
      text: `${filler("Eine Zeile über Kosten und Modelle.")}Jede Funktion hat eine Obergrenze pro Tag.`,
    };
    // Without the other German post, which has the same words.
    const docs = [DOCS[0]!, DOCS[2]!, lang];
    const d = run({
      snapshot: docs,
      live: docs,
      answer: answer({ question: "Obergrenze Funktion Atlas?" }),
    });
    expect(d.located).toMatchObject({ id: "post:grenzen@de", position: "rest" });
    // English documents match too, and the search prefers them for an English answer.
    expect(observations(d, "retrieval-miss", true)).toEqual([
      "A search for the question's words does not return post:grenzen@de (the search prefers English documents)",
    ]);
    expect(observations(d, "language", true)).toEqual([
      "post:grenzen@de exists only in German; the answer was in English",
    ]);
  });

  it("matches a fetch whose id the trace redacted back to its document", () => {
    const faq: CorpusDocument = {
      id: "faq:a1c2e3f4-0000-4000-8000-000000000001@en",
      kind: "faq",
      locale: "en",
      title: "Did he move clusters to Kubernetes?",
      url: "/en#about",
      text: "Q: Did he move clusters to Kubernetes?\nA: Yes, he migrated them in 2023.",
    };
    const docs = [DOCS[0]!, faq];
    const d = run({
      snapshot: docs,
      live: docs,
      answer: answer({
        trace: trace([
          step([tool("get_document", { id: "faq:a1c2e3f4-0000-4000-8000-[number]@en" })]),
          step(),
        ]),
      }),
    });
    expect(d.located?.id).toBe(faq.id);
    expect(observations(d, "context-unused", true)).toContain(
      `It fetched ${faq.id} (step 1): the whole text was in context`,
    );
  });

  it("weighs rare words over the ones every document has", () => {
    const docs: CorpusDocument[] = ["one", "two", "three"].map((name) => ({
      id: `project:${name}@en`,
      kind: "project",
      locale: "en",
      title: name,
      url: `/en/work/${name}`,
      text: `Rastineh built the ${name} platform.`,
    }));
    // Three of four words, but all three are in every document: none holds the rare one.
    const d = run({
      snapshot: docs,
      live: docs,
      answer: answer({ question: "Has Rastineh built a platform for Zyxqvbx?" }),
    });
    expect(d.located).toBeNull();
    expect(observations(d, "content-missing", true)[0]).toMatch(
      /^No document holds most of the question's words: the closest, project:\w+@en, has 3 of 4 \(rastineh, built, platform\), \d{2} % of their weight$/,
    );
  });

  it("reads a cited handle as read in part, and skips a document held whole or fetched", () => {
    const atlasDe: CorpusDocument = {
      id: "project:atlas@de",
      kind: "project",
      locale: "de",
      title: "Atlas",
      url: "/de/work/atlas",
      text: "Atlas — ein Support-Assistent\nStack: Python, pgvector",
    };
    const docs = [...DOCS, atlasDe];
    const partly = (citedIds: string[], tools: TraceTool[] = []) =>
      run({
        snapshot: docs,
        live: docs,
        answer: answer({
          question: "Who funded it, and when?",
          answer: "It was a support assistant.",
          citedIds,
          trace: trace([step(tools)]),
        }),
      });
    expect(observations(partly(["project:atlas@de"]), "context-unused", true)).toEqual([
      "It cited project:atlas@de but had only its one-line handle, and never fetched the rest",
    ]);
    // Held whole: the answer had all of it, so its silence is no sign of a cut.
    expect(hypothesis(partly(["profile@en"]), "context-unused").evidence).toEqual([]);
    // Fetched: read in full.
    const fetched = partly(["project:long@en"], [tool("get_document", { id: "project:long@en" })]);
    expect(hypothesis(fetched, "context-unused").evidence).toEqual([]);
    // Cut short and never fetched: read in part.
    expect(observations(partly(["project:long@en"]), "context-unused", true)[0]).toMatch(
      /^It cited project:long@en but read only its first [\d,]+ of [\d,]+ characters/,
    );
  });

  it("reads an answer without a trace from its attempts and flags", () => {
    const passed = run({
      answer: answer({
        model: "nemotron-ultra",
        trace: null,
        attempts: [
          { model: MODEL, outcome: "timeout", ms: 6_000 },
          { model: "nemotron-ultra", outcome: "ok", ms: 900 },
        ],
      }),
    });
    expect(observations(passed, "degraded-model", true)).toEqual([
      `${MODEL} (timeout) passed over; nemotron-ultra answered`,
    ]);
    expect(observations(passed, "infrastructure", true)).toEqual([
      `${MODEL} timeout after 6,000 ms`,
    ]);
    const flagged = run({ answer: answer({ trace: null, attempts: [], flags: ["degraded"] }) });
    expect(observations(flagged, "degraded-model", true)).toEqual([
      "Flagged degraded: a fallback or an answer-only model answered",
    ]);
  });

  it("proposes testing the language instruction when the fact has no other language", () => {
    const d = run({
      answer: answer({
        question: "Und was?",
        answer: "Ask me about the portfolio.",
        flags: ["language"],
      }),
    });
    expect(d.leading).toBe("language");
    expect(d.proposal).toMatchObject({
      fixType: "prompt",
      fixRef: null,
      fix: "Freeze the answer as an eval case and test the language instruction on it.",
    });
  });

  it("counts the model's own failures and an answer-only model for a degraded model", () => {
    const d = run({
      answer: answer({
        answer: "",
        flags: ["empty", "invented-citation"],
        trace: trace([step([], { answerOnly: true })]),
      }),
    });
    expect(observations(d, "degraded-model", true)).toEqual([
      `An answer-only model answered (${MODEL}, no tools)`,
      "Flagged empty: no words and no action",
      "It cited a document that does not exist (removed before the visitor saw it)",
    ]);
    expect(d.leading).toBe("degraded-model");
    expect(d.proposal).toMatchObject({ fixType: "model", fixRef: MODEL });
  });

  it("puts the content filter, a slow first token and the token limit in the infrastructure", () => {
    const blocked = run({
      answer: answer({ answer: "", finishReason: "content-filter", flags: ["blocked"] }),
    });
    expect(observations(blocked, "infrastructure", true)).toEqual([
      "The provider's content filter stopped it",
    ]);
    const silent = run({
      answer: answer({ answer: "", finishReason: "aborted", ttftMs: null, totalMs: 4_000 }),
    });
    expect(observations(silent, "infrastructure", true)).toEqual([
      "The visitor left after 4,000 ms with no first token",
    ]);
    const slow = run({ answer: answer({ finishReason: "aborted", ttftMs: 12_000 }) });
    expect(observations(slow, "infrastructure", true)).toEqual([
      "The first token took 12,000 ms; the visitor left",
    ]);
    // A visitor who left a fast answer says nothing about the infrastructure.
    const left = run({ answer: answer({ finishReason: "aborted", ttftMs: 800 }) });
    expect(hypothesis(left, "infrastructure").evidence).toEqual([]);
    const cut = run({ answer: answer({ finishReason: "length" }) });
    expect(observations(cut, "infrastructure", true)).toEqual([
      "It stopped at the output token limit",
    ]);
  });
});

describe("a replay's evidence, chain by chain", () => {
  const result = (chain: "lite" | "deep", over: Partial<ReplayResult> = {}): ReplayResult => ({
    chain,
    model: chain === "lite" ? MODEL : "gemini-3.7-flash",
    finishReason: "stop",
    answered: true,
    unknown: false,
    cited: ["project:long@en"],
    flags: [],
    usd: 0.001,
    unavailable: false,
    ...over,
  });
  const failing = { answered: false, unknown: true, cited: [] };
  const down = { unavailable: true, answered: false };
  const replay = (...results: ReplayResult[]) => ({
    runId: "00000000-0000-4000-8000-000000000001",
    at: "2026-10-07T10:00:00.000Z",
    corpusKey: "live#1",
    results,
  });
  const replayed = (d: JournalDiagnosis) =>
    d.hypotheses.flatMap((h) =>
      h.evidence
        .filter((e) => e.experiment === "replay")
        .map((e) => `${h.id} ${e.supports ? "+" : "-"} ${e.observation}`),
    );

  it("reads both chains answering as a failure that did not repeat", () => {
    expect(replayed(run({ replay: replay(result("lite"), result("deep")) }))).toEqual([
      "infrastructure + Replayed today, both chains answer it: the failure did not repeat",
    ]);
    // Only the lite chain answering says the same; the deep chain's miss is noise.
    expect(replayed(run({ replay: replay(result("lite"), result("deep", failing)) }))).toEqual([
      "infrastructure + Replayed today, the lite chain answers it: the failure did not repeat",
    ]);
  });

  it("reads the chains answering, once the fact was added since, as content that was missing", () => {
    const d = run({
      snapshot: DOCS.filter((doc) => doc.id !== LONG.id),
      replay: replay(result("lite"), result("deep")),
    });
    expect(replayed(d)).toEqual([
      "content-missing + Replayed today, both chains answer it, now that project:long@en has it",
    ]);
  });

  it("decides by the chain that answered the visitor: deep for an answer routed or moved there", () => {
    const onDeep = (...results: ReplayResult[]) =>
      replayed(run({ answer: answer({ route: "deep" }), replay: replay(...results) }));
    expect(onDeep(result("lite", failing), result("deep"))).toEqual([
      "infrastructure + Replayed today, the deep chain answers it: the failure did not repeat",
    ]);
    // The visitor's chain fails again where the lite one answers: the model, never the route.
    expect(onDeep(result("lite"), result("deep", failing))).toEqual([
      `degraded-model + Replayed today, the lite chain answers it (${MODEL}); the deep chain, which answered the visitor, does not (gemini-3.7-flash)`,
    ]);
    expect(onDeep(result("lite", failing), result("deep", failing))).toEqual([
      "degraded-model - Replayed today, both chains fail it: not the model",
      "infrastructure - Replayed today, both chains fail it: not a passing outage",
    ]);
    const moved = run({
      answer: answer({ route: "lite→deep" }),
      replay: replay(result("lite", failing), result("deep")),
    });
    expect(replayed(moved)).toEqual([
      "infrastructure + Replayed today, the deep chain answers it: the failure did not repeat",
    ]);
    const deepDown = run({
      answer: answer({ route: "deep" }),
      replay: replay(result("lite"), result("deep", down)),
    });
    expect(replayed(deepDown)).toEqual([]);
    expect(deepDown.untested).toContain(
      "Only the lite chain answered the replay: the deep chain, which answered the visitor, had no model answering.",
    );
  });

  it("reads one chain alone for what it can say, and nothing more", () => {
    expect(replayed(run({ replay: replay(result("lite", failing)) }))).toEqual([
      "infrastructure - Replayed today, the lite chain fails it again: not a passing outage",
    ]);
    // The lite chain down: the deep chain answering says nothing about the route.
    const deepOnly = run({ replay: replay(result("lite", down), result("deep")) });
    expect(replayed(deepOnly)).toEqual([]);
    expect(deepOnly.untested).toEqual(
      expect.arrayContaining([
        "The replay on the lite chain found no model answering.",
        "Only the deep chain answered the replay: with no lite answer to compare, it says nothing about the route.",
      ]),
    );
    const deepFails = run({ replay: replay(result("lite", down), result("deep", failing)) });
    expect(replayed(deepFails)).toEqual([
      "degraded-model - Replayed today, the deep chain fails it too: not the model",
      "under-routed - Replayed today, the deep chain fails it too: not the route",
    ]);
  });
});
