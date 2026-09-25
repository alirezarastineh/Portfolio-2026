import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ModelMessage, UIMessage } from "ai";
import { safeValidateUIMessages } from "ai";
import { z } from "zod";

import type { Locale } from "../content/schema.js";
import { visitorLanguage } from "./language.js";
import { wrapVisitor } from "./prompt.js";
import { countTokens } from "./tokens.js";

/**
 * The conversation arrives from the browser, which could send anything. The
 * visitor's own messages are replayed as visitor text (fenced, never
 * instructions). An earlier answer is replayed only if it carries the
 * signature this server gave it — a keyed hash over the session, the message
 * id and the exact text — so an edited or invented "assistant" turn cannot
 * plant facts; unsigned ones are dropped. Tool parts from the browser are
 * never replayed.
 */

export const ASK_MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface AskMetadata {
  createdAt?: number;
  sig?: string;
  [key: string]: unknown;
}

export type AskUIMessage = UIMessage<AskMetadata>;

const metadataSchema = z.looseObject({ sig: z.string().max(200).optional() }).optional();

const processKey = randomBytes(32);

function signingKey(): Buffer {
  const secret = process.env.ASK_SIGNING_KEY?.trim() || process.env.IP_HASH_SALT?.trim();
  // Without a secret, signatures last until the next restart: older answers
  // then simply stop being replayed.
  return secret ? createHash("sha256").update(`ask-signing:${secret}`).digest() : processKey;
}

export function signAnswer(sessionId: string, messageId: string, text: string): string {
  return createHmac("sha256", signingKey())
    .update(`${sessionId}\n${messageId}\n`)
    .update(createHash("sha256").update(text).digest())
    .digest("base64url");
}

export function verifyAnswer(
  sessionId: string,
  messageId: string,
  text: string,
  sig: string,
): boolean {
  const expected = Buffer.from(signAnswer(sessionId, messageId, text));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Text parts in order, empty ones dropped: the same rule the recorder signs. */
export function messageText(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n");
}

/** Controls, and the bidi overrides that could make logged text read backwards. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

export function cleanVisitorText(text: string): string {
  return text.replace(UNSAFE_CHARS, "").replace(/\r\n?/g, "\n").trim();
}

export type HistoryResult =
  | {
      ok: true;
      messages: ModelMessage[];
      question: string;
      /** The language the visitor writes in, when any of their messages shows it. */
      language: Locale | null;
      droppedAnswers: number;
    }
  | { ok: false; error: "invalid_input" | "too_long" };

function verifyAssistantTurn(
  message: AskUIMessage,
  sessionId: string,
): { text: string; valid: boolean } | null {
  const text = messageText(message);
  if (!text) return null;
  const sig = message.metadata?.sig;
  const valid = Boolean(
    sig && ASK_MESSAGE_ID.test(message.id) && verifyAnswer(sessionId, message.id, text, sig),
  );
  return { text, valid };
}

function replayTurns(
  incoming: AskUIMessage[],
  options: { sessionId: string; locale: Locale; maxChars: number },
): { turns: ModelMessage[]; droppedAnswers: number } {
  let droppedAnswers = 0;
  const turns: ModelMessage[] = [];

  for (const message of incoming.slice(0, -1)) {
    if (message.role === "user") {
      const text = cleanVisitorText(messageText(message)).slice(0, options.maxChars);
      if (text) turns.push({ role: "user", content: wrapVisitor(text, options.locale) });
      continue;
    }
    if (message.role === "assistant") {
      const verified = verifyAssistantTurn(message, options.sessionId);
      if (!verified) continue;
      if (verified.valid) {
        turns.push({ role: "assistant", content: verified.text });
      } else {
        droppedAnswers++;
      }
    }
  }

  return { turns, droppedAnswers };
}

function totalTokens(list: ModelMessage[]): number {
  return list.reduce(
    (sum, m) => sum + countTokens(typeof m.content === "string" ? m.content : ""),
    0,
  );
}

function trimHistory(
  turns: ModelMessage[],
  current: ModelMessage,
  options: { historyTurns: number; maxInputTokens: number },
): ModelMessage[] {
  let kept = turns.slice(-options.historyTurns * 2);
  while (kept[0]?.role === "assistant") {
    kept = kept.slice(1);
  }
  while (kept.length > 0 && totalTokens([...kept, current]) > options.maxInputTokens) {
    const dropCount = kept[1]?.role === "assistant" ? 2 : 1;
    kept = kept.slice(dropCount);
  }
  return kept;
}

export async function buildHistory(options: {
  messages: unknown;
  sessionId: string;
  locale: Locale;
  historyTurns: number;
  maxInputTokens: number;
  maxChars: number;
}): Promise<HistoryResult> {
  const validated = await safeValidateUIMessages<AskUIMessage>({
    messages: options.messages,
    metadataSchema,
  });
  if (!validated.success) return { ok: false, error: "invalid_input" };

  const incoming = validated.data;
  const last = incoming.at(-1);
  if (last?.role !== "user") return { ok: false, error: "invalid_input" };

  const question = cleanVisitorText(messageText(last));
  if (!question) return { ok: false, error: "invalid_input" };
  if (question.length > options.maxChars) return { ok: false, error: "too_long" };

  const { turns, droppedAnswers } = replayTurns(incoming, options);
  const current: ModelMessage = { role: "user", content: wrapVisitor(question, options.locale) };
  const kept = trimHistory(turns, current, options);
  const language = visitorLanguage(
    incoming.filter((m) => m.role === "user").map((m) => messageText(m)),
  );

  return { ok: true, messages: [...kept, current], question, language, droppedAnswers };
}
