import type { UIMessage } from "ai";

import type { OutLine } from "./commands";

/**
 * What the server attaches to an answer (see `server/src/ask/agent.ts`,
 * `AnswerMetadata`). `sig` lets the answer be replayed as history; the rest
 * feeds the `stats` line.
 */
export interface AnswerMetadata {
  createdAt?: number;
  sig?: string;
  model?: string | null;
  fallback?: boolean;
  answerOnly?: boolean;
  route?: "lite" | "deep";
  ttftMs?: number | null;
  totalMs?: number;
  tokens?: { input: number; cached: number; output: number };
  finishReason?: string | null;
}

export type AskMessage = UIMessage<AnswerMetadata>;

/** Why an answer did not arrive, as the terminal words it. */
export type Failure =
  | "unavailable"
  | "timeout"
  | "error"
  | "rateLimited"
  | "busy"
  | "resting"
  | "off"
  | "offline"
  | "invalid"
  | "tooLong";

/** One thing typed at the prompt and what came back. */
export type Entry =
  | { id: string; kind: "local"; input: string; lines: OutLine[] }
  | {
      id: string;
      kind: "ask";
      input: string;
      /** The user message this entry sent; its answer is the message after it. */
      userId: string;
      deep: boolean;
      failure?: Failure;
      /** Seconds to wait, for `rateLimited`. */
      retryAfter?: number;
      /** What the offline shell could say instead. */
      offline?: OutLine[];
    };

export interface RemoteConfig {
  state: "ok" | "off" | "resting";
  deep: boolean;
  suggestions: Record<string, string[]>;
  limits: { maxChars: number; historyTurns: number };
  model: string;
}
