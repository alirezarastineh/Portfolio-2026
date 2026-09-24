import type { Tiktoken } from "js-tiktoken/lite";

/**
 * Local token estimates, for trimming history and skipping models whose
 * context window is too small. Gemini's tokenizer differs from o200k, so this
 * is an estimate by design; the admin can ask Gemini for the exact count.
 *
 * The encoder (a few MB of ranks) loads lazily, once; until it has, a
 * characters-per-token ratio stands in.
 */

let encoder: Tiktoken | undefined;
let loading: Promise<void> | undefined;

export function loadEncoder(): Promise<void> {
  loading ??= Promise.all([import("js-tiktoken/lite"), import("js-tiktoken/ranks/o200k_base")])
    .then(([{ Tiktoken }, ranks]) => {
      encoder = new Tiktoken(ranks.default);
    })
    .catch((error: unknown) => {
      console.warn("[ask] token encoder unavailable, estimating by length", error);
    });
  return loading;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  if (encoder) {
    try {
      return encoder.encode(text).length;
    } catch {
      // Falls through to the estimate (e.g. a lone surrogate).
    }
  }
  return Math.ceil(text.length / 3.5);
}
