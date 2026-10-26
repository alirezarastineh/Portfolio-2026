import { z } from "zod";

/**
 * What the visitor's browser saw of an answer (the visitor plan's V2): when
 * its first word showed and when it ended, whether the visitor stopped it, and
 * how often they followed a follow-up or a citation, copied it or asked it
 * again. The browser sends totals and `POST /v1/ask/signal` sets them, never
 * adds them, so a retried batch cannot count twice. Times and counts only: no
 * content of any kind.
 */
export interface AnswerSignals {
  v: 1;
  /** From the question's send to the answer's first visible word, in the browser. */
  shownMs?: number;
  /** From the question's send to the answer's end, in the browser. */
  doneMs?: number;
  /** The visitor stopped the answer while it was being written. */
  stopped?: boolean;
  /** Follow-up questions clicked. */
  followups?: number;
  /** Citations or source chips followed. */
  citations?: number;
  copies?: number;
  /** How often the question was asked again after it failed. */
  retries?: number;
  /** A tour's stops the visitor reached (visitor plan V16). */
  tourSteps?: number;
  /** The visitor reached the tour's last stop. */
  tourDone?: boolean;
}

/** The most a count may say: more is not one visitor reading one answer. */
export const MAX_SIGNAL_COUNT = 20;
/** The longest time a browser may report: a stream ends long before (`streamTimeoutMs`). */
export const MAX_SIGNAL_MS = 600_000;

const count = z.int().min(0).max(MAX_SIGNAL_COUNT);
const ms = z.int().min(0).max(MAX_SIGNAL_MS);

/** One batch from the browser: any of the totals, at least one. */
export const signalsSchema = z
  .strictObject({
    shownMs: ms.optional(),
    doneMs: ms.optional(),
    stopped: z.boolean().optional(),
    followups: count.optional(),
    citations: count.optional(),
    copies: count.optional(),
    retries: count.optional(),
    tourSteps: count.optional(),
    tourDone: z.boolean().optional(),
  })
  .refine((signals) => Object.keys(signals).length > 0, "no signal");

/**
 * Why a 👎 (V2): a code the terminal offers as a button, never free text.
 * `wrong`: wrong or made up; `unanswered`: it did not answer the question;
 * `length`: too long or too short.
 */
export const FEEDBACK_REASONS = ["wrong", "unanswered", "length"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/** Signal requests one session may send in an hour: a few per answer, a long conversation's worth. */
export const SIGNALS_PER_HOUR = 240;

/** The most sessions the limiter remembers at once: its memory stays bounded under a flood. */
export const SIGNAL_SESSIONS = 10_000;

const HOUR_MS = 3_600_000;

/**
 * A per-session limit kept in memory: signals are cheap writes to a row the
 * session already owns, so a table of rate events would cost more than it
 * guards. One API process; a restart forgets the counts, which only lets a
 * session start its hour again. So does a flood of new sessions, which pushes
 * the oldest windows out: new session ids get fresh windows anyway, and a
 * signal for a session that got no answer writes nothing.
 */
export class SignalLimiter {
  /** In the order the windows opened, so the expired ones come first. */
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly perHour = SIGNALS_PER_HOUR,
    private readonly maxSessions = SIGNAL_SESSIONS,
  ) {}

  /** Whether this session may send one more batch now; counts it if so. */
  take(sessionHash: string, now = Date.now()): boolean {
    const window = this.windows.get(sessionHash);
    if (window && window.resetAt > now) {
      if (window.count >= this.perHour) return false;
      window.count++;
      return true;
    }
    // A new window goes last, keeping the order.
    this.windows.delete(sessionHash);
    this.makeRoom(now);
    this.windows.set(sessionHash, { count: 1, resetAt: now + HOUR_MS });
    return true;
  }

  /** How many sessions it remembers (tests). */
  get sessions(): number {
    return this.windows.size;
  }

  /** Drops expired windows from the front, then the oldest while it is full. */
  private makeRoom(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt > now && this.windows.size < this.maxSessions) return;
      this.windows.delete(key);
    }
  }
}
