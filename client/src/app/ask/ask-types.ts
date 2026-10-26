import type { UIMessage } from "ai";

import type { AskAbout } from "./ask-launcher.service";
import type { OutLine } from "./commands";
import type { TourRequest } from "./tour";

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
  /**
   * The hand-off the answer offers (visitor plan V6): by the model's tool, or
   * by the server when the visitor asked to reach him and the model did not,
   * with the summary the contact form gets.
   */
  handoff?: { by: "tool" | "fallback"; summary: string };
  /** What the answer did, as counts and codes (visitor plan V12, `server/src/ask/receipt.ts`). */
  receipt?: AnswerReceipt;
}

/** The server's receipt: the receipt line and the hero's trace panel read it, nothing else. */
export interface AnswerReceipt {
  lookups: number;
  sources: number;
  /** Invented references removed before the visitor saw them. */
  removed: number;
  escalation?: "projects-fetched" | "search-spans-projects";
  /** The careful topic's code; the receipt says only that it was one. */
  careful?: string;
  /** The case study or post asked on, by document id (`project:atlas@en`). */
  page?: string;
  focus?: { kind: "section" | "code" | "selection"; verified: boolean };
  level?: "plain" | "expert";
  repair?: {
    reason: "no-words" | "handoff-without-words" | "echo" | "stub";
    by: "model" | "fixed-line";
  };
}

export type AskMessage = UIMessage<AnswerMetadata>;

/**
 * A transient part during an answer (visitor plan V12): the server moved on
 * from a model that failed before its first chunk. Shown until the first
 * words; never part of the message.
 */
export interface FailoverStatus {
  code: "failover";
  position: number;
  of: number;
}

/**
 * Why a 👎, as the terminal offers it (`FEEDBACK_REASONS` on the server, the visitor plan's V2):
 * wrong or made up, did not answer the question, too long or too short.
 */
export const DOWN_REASONS = ["wrong", "unanswered", "length"] as const;
export type DownReason = (typeof DOWN_REASONS)[number];

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
  | {
      id: string;
      kind: "local";
      input: string;
      lines: OutLine[];
      /** Its text for a copy button, where the output is worth keeping (`inspect`). */
      copy?: string;
    }
  | {
      id: string;
      kind: "ask";
      input: string;
      /** The user message this entry sent; its answer is the message after it. */
      userId: string;
      deep: boolean;
      /** What a reader pointed at with it (visitor plan V9): sent again by a retry. */
      about?: AskAbout;
      /** A tour asked for (visitor plan V16): sent again by a retry. */
      tour?: TourRequest;
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
  /** Whether the scorecard is published (visitor plan V13); absent from an older API. */
  scorecard?: boolean;
}
