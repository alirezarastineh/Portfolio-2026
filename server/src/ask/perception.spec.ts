import { describe, expect, it } from "vitest";

import type { CorpusDocument } from "./corpus/build.js";
import { applyTiers, MAX_PROMOTED, NO_TIERS } from "./corpus/render.js";
import {
  fetchKind,
  measurePages,
  measurePerception,
  requestedId,
  resolveRequested,
  suggestTiers,
  TIER_RULES,
  type PerceptionRow,
} from "./perception.js";
import { redact } from "./log.js";
import type { AnswerTrace, TraceStep } from "./trace.js";

const doc = (id: string, kind: CorpusDocument["kind"], text: string): CorpusDocument => ({
  id,
  kind,
  locale: id.endsWith("@de") ? "de" : "en",
  title: id,
  url: "/x",
  text,
});

const DOCS: CorpusDocument[] = [
  doc("profile@en", "profile", "Profile, a@b.de"),
  doc("project:atlas@en", "project", "Atlas: 38 % fewer escalations"),
  doc("project:long@en", "project", "A long case study line.\n".repeat(200)),
  doc("profile@de", "profile", "Profil, a@b.de"),
  doc("project:atlas@de", "project", "Atlas: 38 % weniger Eskalationen"),
];
const SNAPSHOTS = new Map([["k#1", DOCS]]);

const step = (
  model: string,
  tokens: { input: number; cached: number },
  fetched: string[] = [],
): TraceStep => ({
  model,
  answerOnly: false,
  ttftMs: 100,
  tokens: { ...tokens, output: 10, thoughts: 0 },
  finishReason: "stop",
  passedOver: [],
  tools: fetched.map((id) => ({
    name: "get_document",
    input: JSON.stringify({ id }),
    outcome: "ok",
    resultChars: 100,
  })),
});

const row = (
  id: string,
  steps: TraceStep[],
  extra: Partial<PerceptionRow> & { core?: NonNullable<AnswerTrace["core"]> } = {},
): PerceptionRow => ({
  id,
  locale: "en",
  tokens: { input: 1000, output: 100 },
  usd: 0.002,
  citedIds: [],
  corpusKey: "k#1",
  helpful: true,
  ...extra,
  trace: { v: 1, steps, ...(extra.core ? { core: extra.core } : {}) },
});

// As the trace stores it (trace.ts redacts tool inputs).
const storedId = (id: string): string => {
  const req = requestedId(redact(JSON.stringify({ id })));
  if (!req) {
    throw new Error(`expected requested id for ${id}`);
  }
  return req;
};

const liteStep = (fetched: string[] = []) =>
  step("gemini-3.5-flash-lite", { input: 1000, cached: 0 }, fetched);

const answeredRow = (
  steps: TraceStep[],
  ttftMs: number | null,
  helpful: boolean,
  page?: NonNullable<AnswerTrace["page"]>,
) => ({ trace: { v: 1 as const, steps, ...(page ? { page } : {}) }, ttftMs, helpful });

const docAccess = (answers: number, fetched: Record<string, number>, cited: string[] = []) => ({
  answers,
  documents: [
    ...Object.entries(fetched).map(([id, n]) => ({ id, fetched: n, cited: 0 })),
    ...cited.map((id) => ({ id, fetched: 0, cited: 1 })),
  ],
});

describe("perception, measured", () => {
  const rows = [
    // Read in English (per-language cores): the German Atlas was a handle, the profile whole.
    row(
      "a",
      [
        step("gemini-3.5-flash-lite", { input: 1000, cached: 0 }, ["project:atlas@de"]),
        step("gemini-3.5-flash-lite", { input: 1200, cached: 800 }, ["profile@en"]),
      ],
      { core: { locale: "en", layout: "locale", tokens: 900 }, citedIds: ["profile@en"] },
    ),
    // From before (no core in the trace: both languages in one core): the rest of a long project.
    row("b", [step("gemini-3.5-flash-lite", { input: 2000, cached: 0 }, ["project:long"])], {
      helpful: false,
      citedIds: ["project:long@en", "profile@en"],
    }),
    // No snapshot to tell; an OpenRouter model, which never caches.
    row(
      "c",
      [step("nvidia/nemotron-3-super-120b-a12b:free", { input: 3000, cached: 0 }, ["cv@en"])],
      { corpusKey: "gone", locale: "de" },
    ),
  ];
  const p = measurePerception(rows, SNAPSHOTS);

  it("splits the cached share into answers' first steps and their later ones, on caching models only", () => {
    expect(p.cache.first).toEqual({ steps: 2, input: 3000, cached: 0, hits: 0 });
    expect(p.cache.later).toEqual({ steps: 1, input: 1200, cached: 800, hits: 1 });
  });

  it("classifies each fetch against the core the answer read, and counts the re-reads", () => {
    expect(p.fetches).toEqual({ whole: 1, rest: 1, handle: 1, unknown: 1 });
    expect(p.rereadRatio).toBeCloseTo(1 / 3);
  });

  it("counts tokens per answer and per helpful answer, the locale mix and each document's access", () => {
    expect(p.tokens).toEqual({
      input: 3000,
      output: 300,
      inputPerAnswer: 1000,
      helpful: 2,
      perHelpful: 1650,
    });
    expect(p.localeMix).toEqual([
      { page: "en", reading: "en", answers: 1 },
      { page: "en", reading: null, answers: 1 },
      { page: "de", reading: null, answers: 1 },
    ]);
    expect(p.documents).toEqual([
      { id: "profile@en", fetched: 1, cited: 2 },
      { id: "project:long@en", fetched: 1, cited: 1 },
      { id: "cv@en", fetched: 1, cited: 0 },
      { id: "project:atlas@de", fetched: 1, cited: 0 },
    ]);
  });

  it("counts searches that led to a citation, by meaning or by words alone (plan phase 18)", () => {
    const searched = (hits: string[], semantic: boolean): TraceStep => ({
      ...step("gemini-3.5-flash-lite", { input: 100, cached: 0 }),
      tools: [
        {
          name: "search_portfolio",
          input: '{"query":"x"}',
          outcome: "ok",
          resultChars: 90,
          hits,
          semantic,
        },
      ],
    });
    const measured = measurePerception(
      [
        row("s1", [searched(["post:a@en", "post:b@en"], true)], { citedIds: ["post:b@en"] }),
        row("s2", [searched(["post:a@en"], true)], { citedIds: ["profile@en"] }),
        row("w1", [searched(["post:c@en"], false)], { citedIds: ["post:c@en"] }),
        row("none", [step("gemini-3.5-flash-lite", { input: 100, cached: 0 })]),
      ],
      SNAPSHOTS,
    );
    expect(measured.search).toEqual({
      semantic: { answers: 2, converted: 1 },
      words: { answers: 1, converted: 1 },
    });
    expect(measurePerception([], SNAPSHOTS).search).toEqual({
      semantic: { answers: 0, converted: 0 },
      words: { answers: 0, converted: 0 },
    });
  });

  it("has nothing to divide by without answers", () => {
    const empty = measurePerception([], SNAPSHOTS);
    expect(empty.rereadRatio).toBeNull();
    expect(empty.tokens.perHelpful).toBeNull();
    expect(empty.tokens.inputPerAnswer).toBeNull();
  });

  it("matches an id whose digits the trace redacted back to its document, if only one fits", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const docs = [
      doc(`experience:${uuid}@en`, "experience", "Then"),
      doc(`experience:${uuid}@de`, "experience", "Damals"),
    ];
    expect(storedId(`experience:${uuid}@de`)).toContain("[number]");
    expect(resolveRequested(docs, storedId(`experience:${uuid}@de`), "en")?.id).toBe(
      `experience:${uuid}@de`,
    );
    expect(resolveRequested(docs, storedId(`experience:${uuid}`), "en")?.id).toBe(
      `experience:${uuid}@en`,
    );
    const twins = [
      ...docs,
      doc("experience:123e4567-e89b-12d3-a456-999999999999@en", "experience", ""),
    ];
    expect(resolveRequested(twins, storedId(`experience:${uuid}@en`), "en")).toBeUndefined();
  });

  it("reads the requested id from a cut input too", () => {
    expect(requestedId('{"id":"project:atlas@en"}')).toBe("project:atlas@en");
    expect(requestedId(`{"id":"project:atlas@en","x":"${"y".repeat(400)}`)).toBe(
      "project:atlas@en",
    );
    expect(requestedId("not json")).toBeNull();
  });

  it("knows a promoted document whole and a demoted one cut, but only under per-language cores", () => {
    const tiered = applyTiers(DOCS, { promoted: ["project:long@en"], demoted: [] });
    const long = tiered.find((d) => d.id === "project:long@en");
    if (!long) {
      throw new Error("expected project:long@en");
    }
    expect(fetchKind(tiered, long, "en", "locale")).toBe("whole");
    expect(fetchKind(tiered, long, "en", "both")).toBe("rest");
    // 1,800 characters: within a project's 2,400, past half of it.
    const mid = doc("project:mid@en", "project", "A line of eighteen.\n".repeat(90));
    const cut = applyTiers([...DOCS, mid], {
      promoted: [],
      demoted: ["project:mid@en", "project:atlas@en"],
    });
    const at = (id: string) => {
      const found = cut.find((d) => d.id === id);
      if (!found) {
        throw new Error(`expected ${id}`);
      }
      return found;
    };
    expect(fetchKind(cut, at("project:mid@en"), "en", "locale")).toBe("rest");
    expect(fetchKind(cut, at("project:mid@en"), "en", "both")).toBe("whole");
    // A short demoted document is still whole; read in German, the English Atlas is a handle.
    expect(fetchKind(cut, at("project:atlas@en"), "en", "locale")).toBe("whole");
    expect(fetchKind(cut, at("project:atlas@en"), "de", "locale")).toBe("handle");
  });

  it("splits every measure by the layout each answer read, before and after per-language cores", () => {
    const { both, locale } = p.byLayout;
    expect([both.answers, locale.answers]).toEqual([2, 1]);
    expect(locale.cache.later).toEqual({ steps: 1, input: 1200, cached: 800, hits: 1 });
    expect(both.cache.later.steps).toBe(0);
    expect(locale.fetches).toEqual({ whole: 1, rest: 0, handle: 1, unknown: 0 });
    expect(both.fetches).toEqual({ whole: 0, rest: 1, handle: 0, unknown: 1 });
    expect(locale.rereadRatio).toBe(0.5);
    expect(both.rereadRatio).toBe(0);
    expect(locale.usdPerAnswer).toBeCloseTo(0.002);
    expect(p.usdPerAnswer).toBeCloseTo(0.002);
    // Two answers before, one of them helpful: 2,000 input and 200 output tokens for it.
    expect(both.tokens.perHelpful).toBe(2200);
  });
});

describe("page-aware answers (visitor plan V8)", () => {
  it("sets the answers asked on a case study or a post against the rest", () => {
    const { pageAware, rest } = measurePages([
      answeredRow([liteStep()], 900, true, { id: "project:atlas@en", promoted: true }),
      answeredRow([liteStep(), liteStep()], 1500, false, { id: "post:x@en", promoted: false }),
      answeredRow([liteStep(["project:atlas@en"]), liteStep()], 1200, true),
      answeredRow([liteStep(), liteStep(), liteStep()], 2000, false),
      // An answer from before the trace held steps: counted, but not in the rounds.
      { trace: null, ttftMs: null, helpful: true },
    ]);
    expect(pageAware).toEqual({
      answers: 2,
      rounds: 1.5,
      ttftP50Ms: 900,
      helpful: 0.5,
      promoted: 1,
    });
    expect(rest).toEqual({ answers: 3, rounds: 2.5, ttftP50Ms: 1200, helpful: 2 / 3 });
  });

  it("counts the answers about a section, a code block or a selection, and those the page held (V9)", () => {
    const onAtlas = { id: "project:atlas@en", promoted: false };
    const focusedOn = (focus: AnswerTrace["focus"], helpful: boolean) => ({
      ...answeredRow([liteStep()], 700, helpful, onAtlas),
      trace: { v: 1 as const, steps: [liteStep()], page: onAtlas, focus },
    });
    const { focused, pageAware } = measurePages([
      focusedOn({ kind: "section", verified: true }, true),
      focusedOn({ kind: "selection", verified: false }, false),
      answeredRow([liteStep(), liteStep()], 1100, true, onAtlas),
    ]);
    expect(focused).toEqual({ answers: 2, rounds: 1, ttftP50Ms: 700, helpful: 0.5, verified: 1 });
    expect(pageAware.answers).toBe(3);
  });

  it("counts a step no model answered as no round, and has nothing to divide by without answers", () => {
    const unanswered: TraceStep = { ...liteStep(), model: null, tokens: null };
    const { pageAware, rest } = measurePages([
      answeredRow([liteStep(), unanswered], 800, true, { id: "post:x@en", promoted: true }),
    ]);
    expect(pageAware.rounds).toBe(1);
    expect(rest).toEqual({ answers: 0, rounds: null, ttftP50Ms: null, helpful: null });
  });
});

describe("tier suggestions", () => {
  it("wait for enough answers before promoting anything", () => {
    const s = suggestTiers(docAccess(19, { "project:atlas@en": 10 }), DOCS, NO_TIERS);
    expect(s.promote).toEqual([]);
    expect(s.considered[0]).toMatchObject({ id: "project:atlas@en", fetched: 10 });
    expect(s.considered[0].why).toContain(`needs ${TIER_RULES.promoteMinAnswers} answers`);
  });

  it("promote what is fetched in more than a fifth of answers, most fetched first, within the cap", () => {
    const s = suggestTiers(
      docAccess(40, { "project:long@en": 20, "project:atlas@en": 9, "profile@en": 4 }),
      DOCS,
      NO_TIERS,
    );
    expect(s.promote.map((x) => x.id)).toEqual(["project:long@en", "project:atlas@en"]);
    expect(s.promote[0].why).toBe("fetched in 50 % of 40 answers");
    expect(s.considered.map((x) => x.id)).toEqual(["profile@en", "*"]);

    const full = {
      promoted: Array.from({ length: MAX_PROMOTED - 1 }, (_, i) => `x${i}`),
      demoted: [],
    };
    const capped = suggestTiers(
      docAccess(40, { "project:long@en": 20, "project:atlas@en": 9 }),
      DOCS,
      full,
    );
    expect(capped.promote.map((x) => x.id)).toEqual(["project:long@en"]);
    expect(capped.considered[0].why).toContain(`at most ${MAX_PROMOTED}`);
  });

  it("cut a project, post or CV shorter only after many answers never touched it", () => {
    const few = suggestTiers(docAccess(199, {}, ["profile@en"]), DOCS, NO_TIERS);
    expect(few.demote).toEqual([]);
    expect(few.considered).toEqual([
      expect.objectContaining({ id: "*", why: "199 answers; clipping harder needs 200" }),
    ]);
    const many = suggestTiers(docAccess(200, { "project:long@en": 1 }), DOCS, {
      promoted: [],
      demoted: ["project:atlas@de"],
    });
    expect(many.demote.map((x) => x.id)).toEqual(["project:atlas@en"]);
  });
});
