import { lt } from "drizzle-orm";

import type { Locale } from "../content/schema.js";
import { getDb } from "../db/client.js";
import { aiMessages } from "../db/schema.js";
import { pruneRateEvents } from "./guard.js";
import type { Attempt } from "./models/fallback.js";
import type { TokenCounts } from "./models/prices.js";

/**
 * One JSON line and one row per answer. Content is redacted before it is
 * stored — emails, phone numbers, long digit runs (cards, IBANs) — and no IP
 * is ever written. Rows are pruned after 90 days; the usage aggregates stay.
 */

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const EXCERPT_CHARS = 2_000;

const EMAIL = /[\p{L}\p{N}._%+-]{1,64}@(?:[\p{L}\p{N}-]{1,63}\.){1,8}\p{L}{2,24}/gu;
/** IBAN-like: two letters, two digits, then 10-30 letters or digits (spaces allowed). */
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){10,30}\b/g;
/** Seven or more digits, allowing the separators phone numbers and cards use. */
const DIGITS = /(?:\+|\b)\d[\d\s()./-]{5,}\d\b/g;

/** `2021-2023`, `2024-03-01`, `2019/20`: dates, which answers are full of. */
const DATE_LIKE = /^(?:19|20)\d{2}(?:\s*[-/.]\s*\d{2,4}){1,2}$/;

export function redact(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(IBAN, "[number]")
    .replace(DIGITS, (match) =>
      match.replace(/\D/g, "").length >= 7 && !DATE_LIKE.test(match.trim()) ? "[number]" : match,
    );
}

export interface AnswerLog {
  id: string;
  sessionHash: string;
  locale: Locale;
  source: "terminal" | "playground" | "eval";
  route: string;
  routeReason: string;
  question: string;
  answer: string;
  citedIds: string[];
  toolCalls: string[];
  model: string | null;
  attempts: Attempt[];
  ttftMs: number | null;
  totalMs: number;
  tokens: TokenCounts;
  usd: number;
  finishReason: string;
  promptVersion: string;
  droppedAnswers: number;
}

export async function logAnswer(entry: AnswerLog): Promise<void> {
  // Stdout gets the metrics only, never content.
  console.log(
    JSON.stringify({
      event: "ask_answer",
      id: entry.id,
      session: entry.sessionHash.slice(0, 12),
      locale: entry.locale,
      source: entry.source,
      route: entry.route,
      routeReason: entry.routeReason,
      model: entry.model,
      attempts: entry.attempts.map((a) => `${a.model}:${a.outcome}:${a.ms}`),
      ttftMs: entry.ttftMs,
      totalMs: entry.totalMs,
      tokens: entry.tokens,
      usd: Number(entry.usd.toFixed(6)),
      finish: entry.finishReason,
      tools: entry.toolCalls,
      citations: entry.citedIds.length,
      droppedAnswers: entry.droppedAnswers,
      prompt: entry.promptVersion,
    }),
  );

  await getDb()
    .insert(aiMessages)
    .values({
      id: entry.id,
      sessionHash: entry.sessionHash,
      locale: entry.locale,
      source: entry.source,
      route: entry.route,
      questionRedacted: redact(entry.question),
      answerExcerpt: redact(entry.answer.slice(0, EXCERPT_CHARS)),
      citedIds: entry.citedIds,
      toolCalls: entry.toolCalls,
      model: entry.model,
      attempts: entry.attempts,
      ttftMs: entry.ttftMs,
      totalMs: entry.totalMs,
      tokens: entry.tokens,
      usd: entry.usd,
      finishReason: entry.finishReason,
      promptVersion: entry.promptVersion,
    })
    .onConflictDoNothing();
}

export async function pruneAiMessages(now = Date.now()): Promise<void> {
  await getDb()
    .delete(aiMessages)
    .where(lt(aiMessages.createdAt, new Date(now - RETENTION_MS)));
}

let pruneTimer: NodeJS.Timeout | undefined;

export function startAskPruning(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(
    () => {
      void Promise.all([pruneAiMessages(), pruneRateEvents()]).catch((error: unknown) =>
        console.error("[ask] pruning failed", error),
      );
    },
    6 * 60 * 60 * 1000,
  );
  pruneTimer.unref?.();
}
