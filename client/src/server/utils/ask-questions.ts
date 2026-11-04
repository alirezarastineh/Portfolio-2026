import { z } from "zod";

import { apiBase } from "./content-upstream";

const TTL_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 2_000;

const configSchema = z.object({ suggestions: z.record(z.string(), z.array(z.string())) });

export type AskQuestions = Record<string, string[]>;

let cached: { questions: AskQuestions; fetchedAt: number } | null = null;

/** Forgets what is cached (tests). */
export function resetAskQuestions(): void {
  cached = null;
}

/**
 * The admin's suggested questions, at most a minute old. The stage must not wait on them or fail
 * with them: on any trouble the last good ones stand, or none, and the built-in three show.
 */
export async function getAskQuestions(): Promise<AskQuestions> {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.questions;
  const base = apiBase();
  if (!base) return {};
  try {
    const response = await fetch(`${base}/v1/ask/config`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const parsed = response.ok ? configSchema.safeParse(await response.json()) : null;
    if (parsed?.success) {
      cached = { questions: parsed.data.suggestions, fetchedAt: Date.now() };
      return cached.questions;
    }
  } catch {
    // Unreachable: as below.
  }
  // Keeps the last good ones, and spares the API a retry on every render for a minute.
  cached = { questions: cached?.questions ?? {}, fetchedAt: Date.now() };
  return cached.questions;
}
