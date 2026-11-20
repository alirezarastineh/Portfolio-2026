import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { agentWords, runWords } from "./agent";
import { apiWords } from "./api-words";
import { faqProposalWords } from "./faq-proposals";
import { refusal } from "./journal";
import { lessonRefusal } from "./lessons";
import { publicationProblem, publishRefusal } from "./review-words";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(here, "../../../../server/src");

/** The server's sources, specs aside. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

/**
 * Codes only a visitor's request gets (the terminal, the contact form, the scorecard), and a tool's
 * outcome inside an answer (`ask/tools.ts`), which the trace words (`answer-trace.ts`).
 */
const VISITORS_ONLY = new Set([
  "busy",
  "not_allowed",
  "not_published",
  "too_large",
  "turnstile_failed",
  "turnstile_required",
]);

/** Codes the server picks at run time (`guard.ts refusal`, `respond`, `one-shot.ts`), and the client's own. */
const NOT_LITERAL = [
  "assistant_off",
  "assistant_resting",
  "cap_reached",
  "duplicate",
  "feature_off",
  "no_model_for_this",
  "reserve_reached",
  "network_error",
  "request_failed",
  "upload_failed",
];

/** Every code the server writes as `error: "…"` or throws with a status, and the ones it picks at run time. */
function adminCodes(): string[] {
  const codes = new Set(NOT_LITERAL);
  for (const file of sources(SERVER)) {
    const text = readFileSync(file, "utf8");
    for (const [, code] of text.matchAll(/\berror: "([a-z0-9_]+)"/g)) {
      codes.add(code);
    }
    for (const [, code] of text.matchAll(
      /(?:PublicationError|InputError)\(\d{3}, "([a-z0-9_]+)"/g,
    )) {
      codes.add(code);
    }
  }
  return [...codes].filter((code) => !VISITORS_ONLY.has(code));
}

const UNKNOWN = "The server refused this. Try again; if it happens again, its log says why.";

describe("apiWords", () => {
  it("has words for every code the server sends the admin", () => {
    const codes = adminCodes();
    expect(codes.length).toBeGreaterThan(80);
    expect(codes.filter((code) => apiWords(code) === UNKNOWN)).toEqual([]);
  });

  it("says each as a sentence, with no code in it", () => {
    for (const code of adminCodes()) {
      const words = apiWords(code);
      expect(words, code).toMatch(/^[A-Z].*\.$/);
      expect(words, code).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    }
  });

  it("gives a code it does not know a plain sentence, never the code", () => {
    expect(apiWords("a_code_nobody_sends")).toBe(UNKNOWN);
    // A map, not an object: "constructor" is no word of its.
    expect(apiWords("constructor")).toBe(UNKNOWN);
  });

  it("says what a failed request's status means", () => {
    expect(apiWords("http_503")).toBe("The API failed (HTTP 503): try again; its log says why.");
    expect(apiWords("http_404")).toBe("This API does not have that yet: deploy the API first.");
    expect(apiWords("http_413")).toBe(
      "The API refused the request: reload the page and try again.",
    );
    expect(apiWords("network_error")).toBe(
      "The API did not answer: check the connection, then try again.",
    );
  });

  it("is where every area's words fall back, so no area shows a code", () => {
    for (const words of [
      agentWords,
      runWords,
      faqProposalWords,
      refusal,
      lessonRefusal,
      publicationProblem,
    ]) {
      expect(words("a_code_nobody_sends")).toBe(UNKNOWN);
    }
    expect(publishRefusal("a_code_nobody_sends")).toBe(`Not published. ${UNKNOWN}`);
    // An area's own word wins where a code means more there.
    expect(faqProposalWords("not_found")).toBe("That proposal is gone.");
    expect(runWords("not_found")).toBe("That run is gone.");
  });
});
