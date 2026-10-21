import type { AskMessage } from "./ask-types";
import { confirmHandoff } from "./handoff-confirm";

/**
 * What the visitor's browser saw of an answer (the visitor plan's V2): when its
 * first word showed and when it ended, a stop, follow-ups and citations
 * followed, copies, retries. Kept as totals and sent whole whenever they
 * change; the server sets them (`POST /v1/ask/signal`), so a batch that lands
 * twice counts once. Times and counts only: no content.
 */
export interface SignalTotals {
  shownMs?: number;
  doneMs?: number;
  stopped?: boolean;
  followups?: number;
  citations?: number;
  copies?: number;
  retries?: number;
}

export type SignalCount = "followups" | "citations" | "copies" | "retries";

/** The most a count may say, and the longest time, as the server takes them (`ask/signals.ts`). */
export const MAX_SIGNAL_COUNT = 20;
export const MAX_SIGNAL_MS = 600_000;

/** A time for the server: whole milliseconds, within its bounds. */
export function signalMs(ms: number): number {
  return Math.min(MAX_SIGNAL_MS, Math.max(0, Math.round(ms)));
}

/** One more of a count, within the server's bound. */
export function bump(totals: SignalTotals, count: SignalCount): SignalTotals {
  return { ...totals, [count]: Math.min(MAX_SIGNAL_COUNT, (totals[count] ?? 0) + 1) };
}

/** Whether an answer has words to show yet: its first visible word. */
export function hasWords(message: AskMessage | undefined): boolean {
  return !!message?.parts.some((p) => p.type === "text" && p.text.trim());
}

/**
 * What the end of an answer's stream adds to its totals: the time to its end and to its first
 * visible word, a stop, and how often its question was asked again before it. A stream that
 * ended between two renders shows its first word with its last.
 */
export function finishedTotals(finish: {
  sentAt: number;
  shownAt?: number;
  now: number;
  words: boolean;
  stopped: boolean;
  retries: number;
}): { shownAt: number | undefined; totals: SignalTotals } {
  const shownAt = finish.shownAt ?? (finish.words ? finish.now : undefined);
  return {
    shownAt,
    totals: {
      doneMs: signalMs(finish.now - finish.sentAt),
      ...(shownAt === undefined ? {} : { shownMs: signalMs(shownAt - finish.sentAt) }),
      ...(finish.stopped ? { stopped: true } : {}),
      ...(finish.retries ? { retries: Math.min(MAX_SIGNAL_COUNT, finish.retries) } : {}),
    },
  };
}

/**
 * The request that carries an answer's totals. The page's last word goes as plain text, a type a
 * keepalive request may send to another origin without asking first; the API reads JSON either way.
 */
export function signalRequest(
  apiBase: string,
  sessionId: string,
  messageId: string,
  totals: SignalTotals,
  keepalive: boolean,
): [url: string, init: RequestInit] {
  return [
    `${apiBase}/v1/ask/signal`,
    {
      method: "POST",
      keepalive,
      headers: { "content-type": keepalive ? "text/plain;charset=UTF-8" : "application/json" },
      body: JSON.stringify({ sessionId, messageId, signals: totals }),
    },
  ];
}

/** Sends one answer's totals; `keepalive` for the page's last word. */
export type SendSignals = (
  sessionId: string,
  messageId: string,
  totals: SignalTotals,
  keepalive: boolean,
) => Promise<{ status: number }>;

/**
 * Each answer's totals, sent one request at a time and always the newest: an
 * answer is logged once its stream ends, so a 404 is tried again for a few
 * seconds (as the hand-off's yes is). A change made while a request is out is
 * sent after it, never beside it, so an older total cannot land last. What
 * never landed goes once more as the page is left.
 */
export class AnswerSignals {
  private readonly totals = new Map<string, { sessionId: string; totals: SignalTotals }>();
  private readonly pending = new Set<string>();
  private readonly running = new Set<string>();
  private readonly dirty = new Set<string>();

  constructor(
    private readonly send: SendSignals,
    private readonly retry: typeof confirmHandoff = confirmHandoff,
  ) {}

  /** The answer's totals so far (tests). */
  of(messageId: string): SignalTotals | undefined {
    return this.totals.get(messageId)?.totals;
  }

  /** Changes the answer's totals and sends them. */
  report(sessionId: string, messageId: string, change: (totals: SignalTotals) => SignalTotals) {
    const current = this.totals.get(messageId)?.totals ?? {};
    this.totals.set(messageId, { sessionId, totals: change(current) });
    this.pending.add(messageId);
    if (this.running.has(messageId)) {
      this.dirty.add(messageId);
      return;
    }
    void this.drain(messageId);
  }

  private async drain(messageId: string): Promise<void> {
    this.running.add(messageId);
    try {
      do {
        this.dirty.delete(messageId);
        const { sessionId, totals } = this.totals.get(messageId)!;
        const landed = await this.retry(() => this.send(sessionId, messageId, totals, false));
        // It stays pending when it did not land: the page's last word sends it.
        if (!landed) return;
        if (!this.dirty.has(messageId)) this.pending.delete(messageId);
      } while (this.dirty.has(messageId));
    } finally {
      this.running.delete(messageId);
    }
  }

  /** What has not landed, once more, as the page goes: a `keepalive` request outlives it. */
  flush(): void {
    for (const messageId of this.pending) {
      const { sessionId, totals } = this.totals.get(messageId)!;
      void this.send(sessionId, messageId, totals, true).catch(() => undefined);
    }
    this.pending.clear();
  }
}
