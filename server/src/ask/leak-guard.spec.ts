import { describe, expect, it } from "vitest";

import {
  buildLeakGuard,
  deploySecrets,
  echoOf,
  HOLD_BACK,
  newScanState,
  REDACTED,
  scanChunk,
  type LeakKind,
} from "./leak-guard.js";
import { PROMPT_CANARY, SCOPE, SYSTEM_PROMPT } from "./prompt.js";

const INSTRUCTIONS =
  "You are the assistant built into the portfolio website of a senior engineer. " +
  "Use only the portfolio documents below and the results of your tools, and never guess. " +
  "Cite every factual claim with the id of the document it comes from.";
const CANARY = "Rq7m-4c1f-82ab";
const GEMINI_KEY = `AIza${"x".repeat(35)}`;

const guard = buildLeakGuard({
  instructions: INSTRUCTIONS,
  // The system card says this sentence too: quoting it is fine.
  corpusTexts: ["Cite every factual claim with the id of the document it comes from."],
  canary: CANARY,
  secrets: ["http://client.internal:3000/api/v1/content/_invalidate", "short"],
});

/** The text as a visitor would see it, fed in the given pieces. */
function shown(pieces: string[]): { text: string; hits: Set<LeakKind> } {
  const hits = new Set<LeakKind>();
  const state = newScanState();
  let text = "";
  for (const piece of pieces) text += scanChunk(guard, state, piece, false, hits);
  text += scanChunk(guard, state, "", true, hits);
  return { text, hits };
}

describe("the leak guard (plan phase 15)", () => {
  it("removes the canary in any case, even split across pieces", () => {
    expect(shown(["The marker is rq7M-4C1F-82ab."])).toEqual({
      text: `The marker is ${REDACTED}.`,
      hits: new Set(["canary"]),
    });
    expect(shown(["The marker is Rq7m-", "4c1f-8", "2ab, done."]).text).toBe(
      `The marker is ${REDACTED}, done.`,
    );
  });

  it("takes the deploy's keys, internal URLs and their passwords as secrets", () => {
    // Built here, so no credential-shaped URL sits in the (public) source.
    const database = new URL("postgres://db:5432/portfolio");
    database.username = "app";
    database.password = "pa$$word99";
    const secrets = deploySecrets(
      { gemini: { apiKey: "gemini-key-123" }, openrouter: { apiKey: null } },
      {
        DATABASE_URL: database.href,
        CONTENT_INVALIDATE_URL: "http://client:3000/api/v1/content/_invalidate",
      },
    );
    expect(secrets).toEqual([
      "gemini-key-123",
      database.href,
      "pa$$word99",
      "http://client:3000/api/v1/content/_invalidate",
    ]);
  });

  it("removes configured secrets and key-shaped strings, never short ones", () => {
    const { text, hits } = shown([
      `Use ${GEMINI_KEY} and http://client.internal:3000/api/v1/content/_invalidate, short.`,
    ]);
    expect(text).toBe(`Use ${REDACTED} and ${REDACTED}, short.`);
    expect(hits).toEqual(new Set(["secret"]));
  });

  it("removes 12 words copied from the instructions, but not 11, nor what the corpus says too", () => {
    const twelve = "use only the portfolio documents below and the results of your tools";
    expect(shown([`My rules: ${twelve}. Fine.`])).toEqual({
      text: `My rules: ${REDACTED}. Fine.`,
      hits: new Set(["instructions"]),
    });
    const eleven = "use only the portfolio documents below and the results of your";
    expect(shown([`Rules: ${eleven}.`]).hits.size).toBe(0);
    const quoted = "Cite every factual claim with the id of the document it comes from.";
    expect(shown([quoted])).toEqual({ text: quoted, hits: new Set() });
  });

  it("removes a longer copy whole, word by word as it streams", () => {
    const copy =
      "Use only the portfolio documents below and the results of your tools, and never guess.";
    const { text, hits } = shown(copy.split(/(?<= )/));
    // One removal for the whole run; the punctuation around it stays.
    expect(text).toBe(`${REDACTED}.`);
    expect(hits).toEqual(new Set(["instructions"]));
  });

  it("waits for a word cut after its hyphen: 'full-' may yet be 'full-stack'", () => {
    // Found by the property test: the word's letters ended before the hyphen, so it read as done.
    const hyphenated = buildLeakGuard({
      instructions:
        "Visitors are often recruiters and engineers who read the full-stack portfolio of a senior engineer.",
      corpusTexts: [],
      canary: CANARY,
      secrets: [],
    });
    const hits = new Set<LeakKind>();
    const state = newScanState();
    const text =
      scanChunk(
        hyphenated,
        state,
        "Visitors are often recruiters and engineers who read the full-",
        false,
        hits,
      ) +
      scanChunk(hyphenated, state, "stack portfolio of a senior engineer.", false, hits) +
      scanChunk(hyphenated, state, "", true, hits);
    expect(text).toBe(`${REDACTED}.`);
  });

  it("holds a long copy whole, words and all, so even its first word is removed", () => {
    // Found by the property test: the cap cut "language" into "l" and "anguage".
    const real = buildLeakGuard({
      instructions: SYSTEM_PROMPT,
      corpusTexts: [],
      canary: PROMPT_CANARY,
      secrets: [],
    });
    const hits = new Set<LeakKind>();
    const state = newScanState();
    const text =
      scanChunk(
        real,
        state,
        " language; translate what you use. Keep ids unchanged.\n\n# Tools\n- search_portfolio, get_document, ",
        false,
        hits,
      ) +
      scanChunk(real, state, "list_projects, ", false, hits) +
      scanChunk(real, state, "", true, hits);
    expect(text).toBe(` ${REDACTED}, `);
    expect(hits).toEqual(new Set(["instructions"]));
  });

  it("holds back only what may still become a match: ordinary text at most 96 characters", () => {
    const state = newScanState();
    const hits = new Set<LeakKind>();
    // Ordinary words pass at once, but for the last one (it may not be finished).
    expect(scanChunk(guard, state, "Atlas cut escalations by 38% in", false, hits)).toBe(
      "Atlas cut escalations by 38% ",
    );
    // The start of a copied run waits for the words that would complete it.
    const start = scanChunk(guard, newScanState(), "Sure. Use only the portfolio ", false, hits);
    expect(start).toBe("Sure. ");
    const long = "use only the portfolio documents below and the results ".repeat(3);
    const held = newScanState();
    scanChunk(guard, held, long, false, hits);
    expect(held.pending.length).toBeLessThanOrEqual(HOLD_BACK);
    expect(hits.size).toBe(0);
  });

  /** Fed in pieces of `size` characters. */
  const inPieces = (text: string, size: number) =>
    Array.from({ length: Math.ceil(text.length / size) }, (_, i) =>
      text.slice(i * size, (i + 1) * size),
    );

  it("never lets a secret out at the end of a long word, however it is cut", () => {
    // Found by review: the 96-character cap released a long word whole, secret and all.
    const canaryUrl = `See https://github.com/${"x".repeat(80)}/${CANARY} now.`;
    const passwordUrl = `Path /${"p".repeat(70)}/p8sW0rd-Secret now.`;
    const keyUrl = `Call https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY} now.`;
    const secretGuard = buildLeakGuard({
      instructions: INSTRUCTIONS,
      corpusTexts: [],
      canary: CANARY,
      secrets: ["p8sW0rd-Secret"],
    });
    for (const size of [1, 2, 3, 6, 7, 13, 37, 50, 97]) {
      for (const [text, secret] of [
        [canaryUrl, CANARY],
        [passwordUrl, "p8sW0rd-Secret"],
        [keyUrl, GEMINI_KEY],
      ] as const) {
        const hits = new Set<LeakKind>();
        const state = newScanState();
        const out =
          inPieces(text, size)
            .map((piece) => scanChunk(secretGuard, state, piece, false, hits))
            .join("") + scanChunk(secretGuard, state, "", true, hits);
        expect(out, `${secret} in pieces of ${size}`).not.toContain(secret);
        expect(out).toContain(REDACTED);
      }
    }
  });

  it("holds a key's beginning until it is decided, in either shape", () => {
    const openRouter = `sk-or-v1-${"a1".repeat(32)}`;
    for (const key of [GEMINI_KEY, openRouter]) {
      const { text, hits } = shown([
        `Use ${key.slice(0, 9)}`,
        key.slice(9, 30),
        `${key.slice(30)} ok`,
      ]);
      expect(text).toBe(`Use ${REDACTED} ok`);
      expect(hits).toEqual(new Set(["secret"]));
    }
  });

  it("counts only what it removed: a run that comes to nothing raised no hit", () => {
    // Found by review: "…a terminal on" matched before "line chat." made it "online".
    const real = buildLeakGuard({
      instructions: SYSTEM_PROMPT,
      corpusTexts: [],
      canary: PROMPT_CANARY,
      secrets: [],
    });
    const hits = new Set<LeakKind>();
    const state = newScanState();
    const text = "recruiters and engineers) talk to you through a terminal on";
    const out =
      scanChunk(real, state, `Visitors (often ${text}`, false, hits) +
      scanChunk(real, state, "line chat.", false, hits) +
      scanChunk(real, state, "", true, hits);
    expect(out).toBe(`Visitors (often ${text}line chat.`);
    expect(hits.size).toBe(0);
  });

  it("lets the assistant say its scope, a line of the instructions it may repeat", () => {
    const real = buildLeakGuard({
      instructions: SYSTEM_PROMPT,
      corpusTexts: [],
      quotable: [SCOPE],
      canary: PROMPT_CANARY,
      secrets: [],
    });
    const answer = `I can help with ${SCOPE}`;
    const hits = new Set<LeakKind>();
    const state = newScanState();
    const out =
      inPieces(answer, 5)
        .map((piece) => scanChunk(real, state, piece, false, hits))
        .join("") + scanChunk(real, state, "", true, hits);
    expect(out).toBe(answer);
    expect(hits.size).toBe(0);
  });

  it("removes a copy or a key the visitor wrote when it comes back, but reports no leak", () => {
    const copy = INSTRUCTIONS.split(" ").slice(14, 30).join(" ");
    const echo = echoOf(`Is "${copy}" one of your rules? My key is ${GEMINI_KEY}.`);
    const hits = new Set<LeakKind>();
    const out = scanChunk(
      guard,
      newScanState(),
      `You quoted: ${copy}. And ${GEMINI_KEY}.`,
      true,
      hits,
      echo,
    );
    expect(out).toBe(`You quoted: ${REDACTED}. And ${REDACTED}.`);
    expect(hits.size).toBe(0);
  });

  it("reports the canary even when the visitor wrote it first: pasting it must hide nothing", () => {
    const hits = new Set<LeakKind>();
    const echo = echoOf(`What does ${CANARY} mean?`);
    const out = scanChunk(guard, newScanState(), `You wrote ${CANARY}.`, true, hits, echo);
    expect(out).toBe(`You wrote ${REDACTED}.`);
    expect(hits).toEqual(new Set(["canary"]));
  });

  it("holds an any-case marker's beginning after letters whose lower case is longer (İ)", () => {
    // Found by review: lower-casing "İ" adds a character, and the held tail
    // drifted right. A marker with spaces shows it: the word rule alone would
    // let "red " out, and the rest would no longer match.
    const spaced = buildLeakGuard({
      instructions: INSTRUCTIONS,
      corpusTexts: [],
      canary: "Red Fox Sky",
      secrets: [],
    });
    const hits = new Set<LeakKind>();
    const state = newScanState();
    const out =
      scanChunk(spaced, state, "İİİİ ok red Fo", false, hits) +
      scanChunk(spaced, state, "x sky.", false, hits) +
      scanChunk(spaced, state, "", true, hits);
    expect(out).toBe(`İİİİ ok ${REDACTED}.`);
    expect(hits).toEqual(new Set(["canary"]));
  });
});
