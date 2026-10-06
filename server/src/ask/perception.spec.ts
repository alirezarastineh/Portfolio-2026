import { describe, expect, it } from "vitest";

import type { CorpusDocument } from "./corpus/build.js";
import { applyTiers, MAX_PROMOTED, NO_TIERS } from "./corpus/render.js";
import {
  fetchKind,
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
  extra: Partial<PerceptionRow> & { core?: AnswerTrace["core"] } = {},
): PerceptionRow => ({
  id,
  locale: "en",
  tokens: { input: 1_000, output: 100 },
  usd: 0.002,
  citedIds: [],
  corpusKey: "k#1",
  helpful: true,
  ...extra,
  trace: { v: 1, steps, ...(extra.core ? { core: extra.core } : {}) },
});

describe("perception, measured", () => {
  const rows = [
    // Read in English (per-language cores): the German Atlas was a handle, the profile whole.
    row(
      "a",
      [
        step("gemini-3.5-flash-lite", { input: 1_000, cached: 0 }, ["project:atlas@de"]),
        step("gemini-3.5-flash-lite", { input: 1_200, cached: 800 }, ["profile@en"]),
      ],
      { core: { locale: "en", layout: "locale", tokens: 900 }, citedIds: ["profile@en"] },
    ),
    // From before (no core in the trace: both languages in one core): the rest of a long project.
    row("b", [step("gemini-3.5-flash-lite", { input: 2_000, cached: 0 }, ["project:long"])], {
      helpful: false,
      citedIds: ["project:long@en", "profile@en"],
    }),
    // No snapshot to tell; an OpenRouter model, which never caches.
    row(
      "c",
      [step("nvidia/nemotron-3-super-120b-a12b:free", { input: 3_000, cached: 0 }, ["cv@en"])],
      { corpusKey: "gone", locale: "de" },
    ),
  ];
  const p = measurePerception(rows, SNAPSHOTS);

  it("splits the cached share into answers' first steps and their later ones, on caching models only", () => {
    expect(p.cache.first).toEqual({ steps: 2, input: 3_000, cached: 0, hits: 0 });
    expect(p.cache.later).toEqual({ steps: 1, input: 1_200, cached: 800, hits: 1 });
  });

  it("classifies each fetch against the core the answer read, and counts the re-reads", () => {
    expect(p.fetches).toEqual({ whole: 1, rest: 1, handle: 1, unknown: 1 });
    expect(p.rereadRatio).toBeCloseTo(1 / 3);
  });

  it("counts tokens per answer and per helpful answer, the locale mix and each document's access", () => {
    expect(p.tokens).toEqual({
      input: 3_000,
      output: 300,
      inputPerAnswer: 1_000,
      helpful: 2,
      perHelpful: 1_650,
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
    const p = measurePerception(
      [
        row("s1", [searched(["post:a@en", "post:b@en"], true)], { citedIds: ["post:b@en"] }),
        row("s2", [searched(["post:a@en"], true)], { citedIds: ["profile@en"] }),
        row("w1", [searched(["post:c@en"], false)], { citedIds: ["post:c@en"] }),
        row("none", [step("gemini-3.5-flash-lite", { input: 100, cached: 0 })]),
      ],
      SNAPSHOTS,
    );
    expect(p.search).toEqual({
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
    // As the trace stores it (trace.ts redacts tool inputs).
    const stored = (id: string) => requestedId(redact(JSON.stringify({ id })))!;
    expect(stored(`experience:${uuid}@de`)).toContain("[number]");
    expect(resolveRequested(docs, stored(`experience:${uuid}@de`), "en")?.id).toBe(
      `experience:${uuid}@de`,
    );
    expect(resolveRequested(docs, stored(`experience:${uuid}`), "en")?.id).toBe(
      `experience:${uuid}@en`,
    );
    const twins = [
      ...docs,
      doc("experience:123e4567-e89b-12d3-a456-999999999999@en", "experience", ""),
    ];
    expect(resolveRequested(twins, stored(`experience:${uuid}@en`), "en")).toBeUndefined();
  });

  it("reads the requested id from a cut input too", () => {
    expect(requestedId('{"id":"project:atlas@en"}')).toBe("project:atlas@en");
    expect(requestedId('{"id":"project:atlas@en","x":"' + "y".repeat(400))).toBe(
      "project:atlas@en",
    );
    expect(requestedId("not json")).toBeNull();
  });

  it("knows a promoted document whole and a demoted one cut, but only under per-language cores", () => {
    const tiered = applyTiers(DOCS, { promoted: ["project:long@en"], demoted: [] });
    const long = tiered.find((d) => d.id === "project:long@en")!;
    expect(fetchKind(tiered, long, "en", "locale")).toBe("whole");
    expect(fetchKind(tiered, long, "en", "both")).toBe("rest");
    // 1,800 characters: within a project's 2,400, past half of it.
    const mid = doc("project:mid@en", "project", "A line of eighteen.\n".repeat(90));
    const cut = applyTiers([...DOCS, mid], {
      promoted: [],
      demoted: ["project:mid@en", "project:atlas@en"],
    });
    const at = (id: string) => cut.find((d) => d.id === id)!;
    expect(fetchKind(cut, at("project:mid@en"), "en", "locale")).toBe("rest");
    expect(fetchKind(cut, at("project:mid@en"), "en", "both")).toBe("whole");
    // A short demoted document is still whole; read in German, the English Atlas is a handle.
    expect(fetchKind(cut, at("project:atlas@en"), "en", "locale")).toBe("whole");
    expect(fetchKind(cut, at("project:atlas@en"), "de", "locale")).toBe("handle");
  });

  it("splits every measure by the layout each answer read, before and after per-language cores", () => {
    const { both, locale } = p.byLayout;
    expect([both.answers, locale.answers]).toEqual([2, 1]);
    expect(locale.cache.later).toEqual({ steps: 1, input: 1_200, cached: 800, hits: 1 });
    expect(both.cache.later.steps).toBe(0);
    expect(locale.fetches).toEqual({ whole: 1, rest: 0, handle: 1, unknown: 0 });
    expect(both.fetches).toEqual({ whole: 0, rest: 1, handle: 0, unknown: 1 });
    expect(locale.rereadRatio).toBe(0.5);
    expect(both.rereadRatio).toBe(0);
    expect(locale.usdPerAnswer).toBeCloseTo(0.002);
    expect(p.usdPerAnswer).toBeCloseTo(0.002);
    // Two answers before, one of them helpful: 2,000 input and 200 output tokens for it.
    expect(both.tokens.perHelpful).toBe(2_200);
  });
});

describe("tier suggestions", () => {
  const access = (answers: number, fetched: Record<string, number>, cited: string[] = []) => ({
    answers,
    documents: [
      ...Object.entries(fetched).map(([id, n]) => ({ id, fetched: n, cited: 0 })),
      ...cited.map((id) => ({ id, fetched: 0, cited: 1 })),
    ],
  });

  it("wait for enough answers before promoting anything", () => {
    const s = suggestTiers(access(19, { "project:atlas@en": 10 }), DOCS, NO_TIERS);
    expect(s.promote).toEqual([]);
    expect(s.considered[0]).toMatchObject({ id: "project:atlas@en", fetched: 10 });
    expect(s.considered[0]!.why).toContain(`needs ${TIER_RULES.promoteMinAnswers} answers`);
  });

  it("promote what is fetched in more than a fifth of answers, most fetched first, within the cap", () => {
    const s = suggestTiers(
      access(40, { "project:long@en": 20, "project:atlas@en": 9, "profile@en": 4 }),
      DOCS,
      NO_TIERS,
    );
    expect(s.promote.map((x) => x.id)).toEqual(["project:long@en", "project:atlas@en"]);
    expect(s.promote[0]!.why).toBe("fetched in 50 % of 40 answers");
    expect(s.considered.map((x) => x.id)).toEqual(["profile@en", "*"]);

    const full = {
      promoted: Array.from({ length: MAX_PROMOTED - 1 }, (_, i) => `x${i}`),
      demoted: [],
    };
    const capped = suggestTiers(
      access(40, { "project:long@en": 20, "project:atlas@en": 9 }),
      DOCS,
      full,
    );
    expect(capped.promote.map((x) => x.id)).toEqual(["project:long@en"]);
    expect(capped.considered[0]!.why).toContain(`at most ${MAX_PROMOTED}`);
  });

  it("cut a project, post or CV shorter only after many answers never touched it", () => {
    const few = suggestTiers(access(199, {}, ["profile@en"]), DOCS, NO_TIERS);
    expect(few.demote).toEqual([]);
    expect(few.considered).toEqual([
      expect.objectContaining({ id: "*", why: "199 answers; clipping harder needs 200" }),
    ]);
    const many = suggestTiers(access(200, { "project:long@en": 1 }), DOCS, {
      promoted: [],
      demoted: ["project:atlas@de"],
    });
    expect(many.demote.map((x) => x.id)).toEqual(["project:atlas@en"]);
  });
});
