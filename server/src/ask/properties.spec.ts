import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream, type ModelMessage, type TextStreamPart, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { fixtureConfig, fixtureCorpus } from "../test/ask-fixtures.js";
import {
  apiError,
  drain,
  finish,
  mockEntry,
  scripted,
  textTurn,
  toolTurn,
} from "../test/ask-models.js";
import { streamAnswer } from "./agent.js";
import type { CorpusDocument } from "./corpus/build.js";
import { resolveDocument, type AskCorpus } from "./corpus/index.js";
import { stateFor, type Availability } from "./guard.js";
import { cleanVisitorText, signAnswer, trimHistory, verifyAnswer } from "./history.js";
import { redact } from "./log.js";
import {
  breakerSnapshot,
  recordFailure,
  recordSuccess,
  releaseProbe,
  resetBreakers,
  tryAcquire,
} from "./models/circuit.js";
import { createFallbackModel, newTrace } from "./models/fallback.js";
import { wrapVisitor } from "./prompt.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { citationTransform } from "./stream-transforms.js";
import { countTokens } from "./tokens.js";
import { allowedPath } from "./tools.js";

/**
 * Invariants that must hold whatever path an answer takes: the evaluation
 * stack's third layer. Seeded, so CI replays the same cases; set FC_SEED to
 * explore others. A failure prints the smallest counterexample fast-check
 * could shrink it to.
 */

const seed = Number(process.env.FC_SEED ?? 20260930);
const runs = (numRuns: number) => ({ seed, numRuns });

/* ------------------------------------------------------------ citations */

const DOCS: CorpusDocument[] = [
  { id: "profile@en", kind: "profile", locale: "en", title: "Profile", url: "/en", text: "" },
  {
    id: "project:atlas@en",
    kind: "project",
    locale: "en",
    title: "Atlas",
    url: "/en/work/atlas",
    text: "",
  },
  {
    id: "project:atlas@de",
    kind: "project",
    locale: "de",
    title: "Atlas",
    url: "/de/work/atlas",
    text: "",
  },
  {
    id: "post:evals@en",
    kind: "post",
    locale: "en",
    title: "Evals",
    url: "/en/writing/evals",
    text: "",
  },
];
const byId = new Map(DOCS.map((d) => [d.id, d]));

async function throughCitations(chunks: string[]) {
  const cited = new Set<string>();
  const dropped: string[] = [];
  const parts: TextStreamPart<ToolSet>[] = [
    { type: "text-start", id: "t" },
    ...chunks.map((text) => ({ type: "text-delta" as const, id: "t", text })),
    { type: "text-end", id: "t" },
  ];
  const input = new ReadableStream<TextStreamPart<ToolSet>>({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
  const transform = citationTransform({ corpus: { byId }, locale: "en", cited, dropped });
  const out = await drain(input.pipeThrough(transform({ tools: {}, stopStream: () => {} })));
  return {
    text: out.map((p) => (p.type === "text-delta" ? p.text : "")).join(""),
    sources: out.filter((p) => p.type === "source").map((p) => (p as { id: string }).id),
    dropped,
  };
}

/** A marker in any bracket style. */
const ANY_MARKER = /[[【［]\^[^\]】］\s]+[\]】］]/g;
/** An invented marker, which the transform removes together with one space before it. */
const INVENTED = / ?[[【［]\^zz-[^\]】］\s]*[\]】］]/g;
const BRACKETS: [string, string][] = [
  ["[", "]"],
  ["【", "】"],
  ["［", "］"],
];

const segment = fc.oneof(
  { weight: 3, arbitrary: fc.stringMatching(/^[A-Za-z0-9 ,.]{0,10}$/) },
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        fc.constantFrom("profile@en", "project:atlas@en", "project:atlas", "post:evals@de"),
        fc.constantFrom(...BRACKETS),
        fc.boolean(),
      )
      .map(([id, [open, close], space]) => `${space ? " " : ""}${open}^${id}${close}`),
  },
  {
    weight: 1,
    // Invented: no document has a `zz-` id, in either locale.
    arbitrary: fc
      .tuple(fc.stringMatching(/^[a-z]{1,8}$/), fc.constantFrom(...BRACKETS), fc.boolean())
      .map(([name, [open, close], space]) => `${space ? " " : ""}${open}^zz-${name}@en${close}`),
  },
);

function cut(text: string, points: number[]): string[] {
  const at = [...new Set(points.map((p) => p % (text.length + 1)))].sort((a, b) => a - b);
  const out: string[] = [];
  let from = 0;
  for (const p of at) {
    out.push(text.slice(from, p));
    from = p;
  }
  out.push(text.slice(from));
  return out;
}

const chunkedText = fc
  .tuple(fc.array(segment, { maxLength: 12 }), fc.array(fc.nat(), { maxLength: 8 }))
  .map(([segments, points]) => {
    const text = segments.join("");
    return { text, chunks: cut(text, points) };
  });

type Through = (chunks: string[]) => ReturnType<typeof throughCitations>;

const citationProperty = (through: Through) =>
  fc.asyncProperty(chunkedText, async ({ text, chunks }) => {
    const whole = await through([text]);
    const split = await through(chunks);
    expect(split).toEqual(whole);
    expect(split.text).not.toContain("zz-");
    // Each document a marker names is announced, once.
    expect(new Set(split.sources).size).toBe(split.sources.length);
    const named = [...text.matchAll(ANY_MARKER)].flatMap(
      (m) => resolveDocument({ byId }, m[0].slice(2, -1), "en")?.id ?? [],
    );
    expect(new Set(split.sources)).toEqual(new Set(named));
    // The words around the markers are untouched.
    expect(split.text.replace(ANY_MARKER, "")).toBe(
      text.replace(INVENTED, "").replace(ANY_MARKER, ""),
    );
  });

/**
 * A deliberately broken transform: it rewrites each chunk on its own, as if
 * no marker were ever split across chunks.
 */
async function chunkByChunk(chunks: string[]) {
  const sources: string[] = [];
  const dropped: string[] = [];
  const text = chunks
    .map((chunk) =>
      chunk.replace(/ ?[[【［]\^([^\]】］\s]+)[\]】］]/g, (match, raw: string) => {
        const doc = resolveDocument({ byId }, raw, "en");
        if (!doc) {
          dropped.push(raw);
          return "";
        }
        if (!sources.includes(doc.id)) sources.push(doc.id);
        return `${match.startsWith(" ") ? " " : ""}[^${doc.id}]`;
      }),
    )
    .join("");
  return { text, sources, dropped };
}

describe("properties", () => {
  it("citations: any chunking gives the same answer; nothing invented survives; each source once", async () => {
    await fc.assert(citationProperty(throughCitations), runs(300));
  });

  it("citations: the property catches a transform that forgets split markers, and shrinks it", async () => {
    const result = await fc.check(citationProperty(chunkByChunk), runs(300));
    expect(result.failed).toBe(true);
    const [{ text, chunks }] = result.counterexample as [{ text: string; chunks: string[] }];
    // The smallest failing case: one marker, cut once inside it.
    expect(text).toMatch(/^[[【［]\^[^\]】］\s]+[\]】］]$/);
    expect(chunks).toHaveLength(2);
  });

  /* ---------------------------------------------------------- navigate */

  const site = {
    projects: [
      { slug: "atlas", locale: "en", hasCaseStudy: true },
      { slug: "atlas", locale: "de", hasCaseStudy: true },
      { slug: "draft", locale: "en", hasCaseStudy: false },
    ],
    posts: [{ slug: "evals", locale: "en" }],
  } as unknown as Pick<AskCorpus, "projects" | "posts">;
  const SECTIONS = ["projects", "experience", "skills", "writing", "about", "contact"];
  const ALLOWED = new Set([
    ...["en", "de"].flatMap((l) => [
      `/${l}`,
      `/${l}/writing`,
      `/${l}/legal/imprint`,
      `/${l}/legal/privacy`,
      `/${l}/work/atlas`,
      ...SECTIONS.map((s) => `/${l}#${s}`),
    ]),
    "/en/writing/evals",
  ]);
  const pathLike = fc.oneof(
    fc.string({ maxLength: 60 }),
    fc
      .tuple(
        fc.constantFrom("/", "//", "", "https://evil.test/", "javascript:", "/ "),
        fc.constantFrom("en", "de", "EN", "fr", "", "en.", "de%2f"),
        fc.array(
          fc.constantFrom(
            "work",
            "writing",
            "legal",
            "atlas",
            "draft",
            "evals",
            "privacy",
            "..",
            "%2e%2e",
            "admin",
            "",
          ),
          { maxLength: 4 },
        ),
        fc.option(fc.constantFrom("#projects", "#admin", "#", "#skills", "?x=1")),
        fc.boolean(),
      )
      .map(
        ([prefix, locale, segments, fragment, slash]) =>
          `${prefix}${locale}${segments.length ? `/${segments.join("/")}` : ""}${slash ? "/" : ""}${fragment ?? ""}`,
      ),
  );

  it("navigate: only this site's own pages, whatever the model asks for", () => {
    fc.assert(
      fc.property(pathLike, (raw) => {
        const path = allowedPath(site, raw);
        expect(path === null || ALLOWED.has(path), `${raw} → ${path}`).toBe(true);
      }),
      runs(2000),
    );
  });

  /* ------------------------------------------------------------ redact */

  const email = fc
    .tuple(
      fc.stringMatching(/^[a-z0-9][a-z0-9._%+-]{0,15}$/),
      fc.array(fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,8}$/), { minLength: 1, maxLength: 3 }),
      fc.stringMatching(/^[a-z]{2,6}$/),
    )
    .map(([local, labels, tld]) => `${local}@${labels.join(".")}.${tld}`);
  const phone = fc
    .tuple(
      fc.constantFrom("+49 ", "+1 ", "0", "+44 (0)"),
      fc.array(fc.stringMatching(/^[0-9]{2,4}$/), { minLength: 2, maxLength: 4 }),
      fc.constantFrom(" ", "-", "/", "."),
    )
    .map(([prefix, groups, separator]) => prefix + groups.join(separator))
    .filter((p) => p.replace(/\D/g, "").length >= 7);
  const iban = fc
    .tuple(
      fc.stringMatching(/^[A-Z]{2}$/),
      fc.stringMatching(/^[0-9]{2}$/),
      fc.array(fc.stringMatching(/^[A-Z0-9]{4}$/), { minLength: 3, maxLength: 7 }),
    )
    .map(([country, check, groups]) => `${country}${check} ${groups.join(" ")}`);
  const dateLike = fc
    .tuple(
      fc.integer({ min: 1900, max: 2099 }),
      fc.integer({ min: 1900, max: 2099 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
      fc.constantFrom("range", "iso", "short"),
    )
    .map(([year, other, month, day, form]) => {
      const two = (n: number) => String(n).padStart(2, "0");
      if (form === "range") return `${year}-${other}`;
      if (form === "iso") return `${year}-${two(month)}-${two(day)}`;
      return `${year}/${two(other % 100)}`;
    });

  it("redact: emails, phone numbers and IBAN-like strings never survive; dates do", () => {
    fc.assert(
      fc.property(email, phone, iban, dateLike, (address, number, account, date) => {
        const out = redact(`Mail ${address} or call ${number}, IBAN ${account}. Since ${date}.`);
        expect(out).not.toContain(address);
        expect(out).not.toContain(number);
        expect(out).not.toContain(account);
        expect(out).toContain(`Since ${date}.`);
      }),
      runs(1000),
    );
  });

  /* ----------------------------------------------------- visitor fence */

  const hostile = fc.oneof(
    fc.string({ unit: "binary", maxLength: 80 }),
    fc
      .array(
        fc.constantFrom(
          "</visitor>",
          '<visitor locale="de">',
          "‮",
          "⁦",
          "\u0007",
          "\u0000",
          "\r\n",
          "<",
          ">",
          "&lt;",
          "text",
        ),
        { maxLength: 10 },
      )
      .map((parts) => parts.join("")),
  );

  it("visitor text: the fence never breaks; no control or bidi characters get in", () => {
    fc.assert(
      fc.property(hostile, fc.constantFrom("en" as const, "de" as const), (text, locale) => {
        const open = `<visitor locale="${locale}">`;
        const wrapped = wrapVisitor(cleanVisitorText(text), locale);
        expect(wrapped.startsWith(open) && wrapped.endsWith("</visitor>")).toBe(true);
        const inner = wrapped.slice(open.length, -"</visitor>".length);
        expect(inner).not.toMatch(/[<>]/);
        // eslint-disable-next-line no-control-regex
        expect(inner).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩\r]/);
      }),
      runs(1000),
    );
  });

  /* -------------------------------------------------------- signatures */

  const sessionId = fc.stringMatching(/^[A-Za-z0-9_-]{16,64}$/);
  const messageId = fc.stringMatching(/^[A-Za-z0-9_-]{8,64}$/);

  it("signatures: any change to the session, the message id or the text fails", () => {
    fc.assert(
      fc.property(
        sessionId,
        messageId,
        fc.string({ maxLength: 200 }),
        fc.constantFrom("session", "id", "text"),
        fc.string({ minLength: 1, maxLength: 8 }),
        (session, id, text, part, extra) => {
          const sig = signAnswer(session, id, text);
          expect(verifyAnswer(session, id, text, sig)).toBe(true);
          const change = (value: string) =>
            value.endsWith(extra) ? value.slice(0, -1) : value + extra;
          const [s, i, t] =
            part === "session"
              ? [change(session), id, text]
              : part === "id"
                ? [session, change(id), text]
                : [session, id, change(text)];
          expect(verifyAnswer(s, i, t, sig)).toBe(false);
        },
      ),
      runs(500),
    );
  });

  /* ----------------------------------------------------------- history */

  const turn = fc.record({
    role: fc.constantFrom("user" as const, "assistant" as const),
    content: fc.string({ minLength: 1, maxLength: 120 }),
  });

  it("history: never starts with an answer, and fits the budget unless nothing is left", () => {
    fc.assert(
      fc.property(
        fc.array(turn, { maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 5, max: 200 }),
        (turns, question, historyTurns, maxInputTokens) => {
          const current: ModelMessage = { role: "user", content: question };
          const kept = trimHistory(turns as ModelMessage[], current, {
            historyTurns,
            maxInputTokens,
          });
          expect(kept[0]?.role).not.toBe("assistant");
          const total = [...kept, current].reduce(
            (sum, m) => sum + countTokens(m.content as string),
            0,
          );
          expect(kept.length === 0 || total <= maxInputTokens).toBe(true);
          // It only ever drops from the front.
          expect(turns.slice(turns.length - kept.length)).toEqual(kept);
        },
      ),
      runs(1000),
    );
  });

  /* ---------------------------------------------------------- fallback */

  type Behaviour = "fails" | "fails-midway" | "answers";

  function behaving(tag: string, behaviour: Behaviour) {
    const calls: LanguageModelV4CallOptions[] = [];
    const model = new MockLanguageModelV4({
      modelId: tag,
      doStream: async (options) => {
        calls.push(options);
        if (behaviour === "fails") throw apiError(500);
        const rest: LanguageModelV4StreamPart[] =
          behaviour === "fails-midway"
            ? [{ type: "error", error: apiError(500) }]
            : [
                { type: "text-delta", id: "t", delta: `${tag}:2` },
                { type: "text-end", id: "t" },
                finish(),
              ];
        return {
          stream: simulateReadableStream<LanguageModelV4StreamPart>({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: `${tag}:1 ` },
              ...rest,
            ],
            chunkDelayInMs: null,
          }),
        };
      },
    });
    return { model, calls };
  }

  it("fallback: once a model has sent content, no other model is asked", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<Behaviour>("fails", "fails-midway", "answers"), {
          minLength: 1,
          maxLength: 4,
        }),
        async (behaviours) => {
          resetBreakers();
          const models = behaviours.map((b, i) => behaving(`m${i}`, b));
          const fallback = createFallbackModel({
            entries: models.map((m, i) => mockEntry(`m${i}`, m.model)),
            trace: newTrace(),
            firstChunkTimeoutMs: 1_000,
            requestTimeoutMs: 2_000,
            maxRetries: 0,
            retryBaseDelayMs: 1,
            retryMaxDelayMs: 1,
            estimateTokens: () => 1,
          });
          let parts: LanguageModelV4StreamPart[] = [];
          try {
            const { stream } = await fallback.doStream({
              prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            });
            parts = await drain(stream);
          } catch {
            // Every model failed before sending anything.
          }
          const first = behaviours.findIndex((b) => b !== "fails");
          const senders = new Set(
            parts.flatMap((p) => (p.type === "text-delta" ? [p.delta.split(":")[0]] : [])),
          );
          expect([...senders]).toEqual(first === -1 ? [] : [`m${first}`]);
          models.forEach((m, i) =>
            expect(m.calls).toHaveLength(first === -1 || i <= first ? 1 : 0),
          );
          if (behaviours[first] === "fails-midway") expect(parts.at(-1)?.type).toBe("error");
        },
      ),
      runs(200),
    );
  });

  /* ----------------------------------------------------------- breaker */

  type Op =
    | { kind: "acquire" }
    | { kind: "success" }
    | { kind: "failure"; rateLimited: boolean }
    | { kind: "release" }
    | { kind: "wait"; ms: number };

  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.constant<Op>({ kind: "acquire" }),
    fc.constant<Op>({ kind: "success" }),
    fc.boolean().map<Op>((rateLimited) => ({ kind: "failure", rateLimited })),
    fc.constant<Op>({ kind: "release" }),
    fc.integer({ min: 1, max: 120_000 }).map<Op>((ms) => ({ kind: "wait", ms })),
  );

  it("breaker: an open breaker admits nothing, a half-open one a single probe", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        resetBreakers();
        let now = 1_000_000;
        let probing = false;
        for (const o of ops) {
          if (o.kind === "wait") now += o.ms;
          else if (o.kind === "acquire") {
            const state = breakerSnapshot(["m"], now)[0]!.state;
            const admitted = tryAcquire("m", now);
            if (state === "open") expect(admitted).toBe(false);
            if (state === "half-open" && admitted) {
              expect(probing).toBe(false);
              probing = true;
            }
          } else {
            if (o.kind === "success") recordSuccess("m", 10, now);
            else if (o.kind === "failure") {
              recordFailure("m", { error: "x", rateLimited: o.rateLimited }, now);
            } else releaseProbe("m");
            probing = false;
          }
        }
      }),
      runs(1000),
    );
  });

  /* ------------------------------------------------------ availability */

  const rank = (a: Availability) => {
    if (a.state === "off") return -1;
    if (a.state === "resting") return 2;
    return a.deepAllowed ? 0 : 1;
  };

  it("availability: more spend never opens anything back up", () => {
    const config = fixtureConfig();
    const spend = fc.double({ min: 0, max: 10, noNaN: true });
    fc.assert(
      fc.property(
        spend,
        spend,
        fc.option(fc.double({ min: 0.01, max: 5, noNaN: true })),
        fc.boolean(),
        (a, b, budget, deepEnabled) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          const settings = { ...DEFAULT_SETTINGS, dailyBudgetUsd: budget, deepEnabled };
          expect(rank(stateFor(config, settings, low))).toBeLessThanOrEqual(
            rank(stateFor(config, settings, high)),
          );
        },
      ),
      runs(1000),
    );
  });

  /* ------------------------------------------------------------- agent */

  it("agent: at most maxRounds model steps, and the last one may use no tools", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 8 }),
        async (maxRounds, lookups) => {
          resetBreakers();
          const config = fixtureConfig({ agentMaxRounds: maxRounds });
          const model = scripted([
            ...Array.from({ length: lookups }, (_, i) =>
              toolTurn("search_portfolio", { query: `q${i}` }, `call-${i}`),
            ),
            textTurn("Done."),
          ]);
          const { stream, done } = streamAnswer({
            messages: [{ role: "user", content: wrapVisitor("Tell me about Atlas", "en") }],
            question: "Tell me about Atlas",
            locale: "en",
            language: "en",
            sessionId: "property-session-0001",
            sessionHash: "property",
            source: "eval",
            route: { route: "lite", reason: "property" },
            corpus: fixtureCorpus(config),
            config,
            chain: [mockEntry("gemini-3.5-flash-lite", model.model)],
            abortSignal: new AbortController().signal,
            persist: false,
          });
          await drain(stream);
          await done;
          expect(model.calls.length).toBeLessThanOrEqual(maxRounds);
          if (model.calls.length === maxRounds) {
            expect(model.calls.at(-1)!.tools ?? []).toHaveLength(0);
          }
        },
      ),
      runs(40),
    );
  });
});
