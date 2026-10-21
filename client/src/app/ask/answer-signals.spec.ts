import { describe, expect, it } from "vitest";

import {
  AnswerSignals,
  bump,
  finishedTotals,
  hasWords,
  MAX_SIGNAL_COUNT,
  MAX_SIGNAL_MS,
  signalMs,
  signalRequest,
  type SignalTotals,
} from "./answer-signals";
import type { AskMessage } from "./ask-types";

/** A send that resolves only when told to, recording what it carried. */
function deferredSend() {
  const calls: { messageId: string; totals: SignalTotals; keepalive: boolean }[] = [];
  const resolvers: ((status: number) => void)[] = [];
  const send = (_session: string, messageId: string, totals: SignalTotals, keepalive: boolean) => {
    calls.push({ messageId, totals: { ...totals }, keepalive });
    return new Promise<{ status: number }>((resolve) => {
      resolvers.push((status) => resolve({ status }));
    });
  };
  return { calls, resolvers, send };
}

/** One attempt, no waiting: a 2xx lands, anything else does not. */
const once = async (post: () => Promise<{ status: number }>) => {
  const { status } = await post();
  return status >= 200 && status < 300;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the browser's signals (visitor plan V2)", () => {
  it("keep times and counts within the server's bounds", () => {
    expect(signalMs(1234.6)).toBe(1235);
    expect(signalMs(-3)).toBe(0);
    expect(signalMs(MAX_SIGNAL_MS + 1)).toBe(MAX_SIGNAL_MS);
    let totals: SignalTotals = {};
    for (let i = 0; i < MAX_SIGNAL_COUNT + 5; i++) totals = bump(totals, "copies");
    expect(totals).toEqual({ copies: MAX_SIGNAL_COUNT });
  });

  it("send the newest totals one request at a time, so an older total never lands last", async () => {
    const { calls, resolvers, send } = deferredSend();
    const signals = new AnswerSignals(send, once);
    signals.report("s", "m_1", () => ({ doneMs: 2000 }));
    // Two changes while the first request is out: one request follows, with both.
    signals.report("s", "m_1", (t) => bump(t, "followups"));
    signals.report("s", "m_1", (t) => bump(t, "citations"));
    expect(calls).toEqual([{ messageId: "m_1", totals: { doneMs: 2000 }, keepalive: false }]);

    resolvers[0]!(200);
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.totals).toEqual({ doneMs: 2000, followups: 1, citations: 1 });
    resolvers[1]!(200);
    await tick();

    // Everything landed: leaving the page sends nothing.
    signals.flush();
    expect(calls).toHaveLength(2);
  });

  it("send what never landed once more as the page goes, as plain keepalive requests", async () => {
    const { calls, resolvers, send } = deferredSend();
    const signals = new AnswerSignals(send, once);
    signals.report("s", "m_1", () => ({ doneMs: 900, stopped: true }));
    signals.report("s", "m_2", () => ({ copies: 1 }));
    resolvers[0]!(404);
    resolvers[1]!(200);
    await tick();

    signals.flush();
    expect(calls.slice(2)).toEqual([
      { messageId: "m_1", totals: { doneMs: 900, stopped: true }, keepalive: true },
    ]);
    // Said once: a second flush has nothing left.
    signals.flush();
    expect(calls).toHaveLength(3);
  });

  it("count an answer's first word only once it has words", () => {
    const answer = (...texts: string[]) =>
      ({
        id: "m_1",
        role: "assistant",
        parts: texts.map((text) => ({ type: "text", text })),
      }) as AskMessage;
    expect(hasWords(undefined)).toBe(false);
    expect(hasWords(answer())).toBe(false);
    expect(hasWords(answer("  ", "\n"))).toBe(false);
    expect(hasWords(answer("", "Berlin"))).toBe(true);
    const toolOnly = {
      id: "m_2",
      role: "assistant",
      parts: [{ type: "step-start" }],
    } as AskMessage;
    expect(hasWords(toolOnly)).toBe(false);
  });

  it("add the end of a stream: its time, its first word's, a stop and the retries", () => {
    // The first word showed while it streamed: that time stands.
    expect(
      finishedTotals({
        sentAt: 1000,
        shownAt: 1400,
        now: 3000,
        words: true,
        stopped: false,
        retries: 0,
      }),
    ).toEqual({ shownAt: 1400, totals: { doneMs: 2000, shownMs: 400 } });
    // The whole stream landed between two renders: its first word showed with its last.
    expect(
      finishedTotals({ sentAt: 1000, now: 1900, words: true, stopped: true, retries: 2 }),
    ).toEqual({ shownAt: 1900, totals: { doneMs: 900, shownMs: 900, stopped: true, retries: 2 } });
    // No words at all (stopped before any, or only a hand-off): no first word to time.
    expect(
      finishedTotals({ sentAt: 1000, now: 1500, words: false, stopped: true, retries: 0 }),
    ).toEqual({ shownAt: undefined, totals: { doneMs: 500, stopped: true } });
    // Within the server's bounds, which refuse a whole batch past them.
    expect(
      finishedTotals({
        sentAt: 0,
        now: MAX_SIGNAL_MS * 2,
        words: false,
        stopped: false,
        retries: 99,
      }).totals,
    ).toEqual({ doneMs: MAX_SIGNAL_MS, retries: MAX_SIGNAL_COUNT });
  });

  it("go as JSON, and as plain text when the page is closing", () => {
    const [url, init] = signalRequest("https://api.test", "s", "m_1", { copies: 1 }, false);
    expect(url).toBe("https://api.test/v1/ask/signal");
    expect(init).toMatchObject({
      method: "POST",
      keepalive: false,
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      sessionId: "s",
      messageId: "m_1",
      signals: { copies: 1 },
    });
    const [, last] = signalRequest("https://api.test", "s", "m_1", { copies: 1 }, true);
    expect(last).toMatchObject({
      keepalive: true,
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  });

  it("keep each answer's totals apart, and on the session that got the answer", async () => {
    const sessions: string[] = [];
    const signals = new AnswerSignals(async (session) => {
      sessions.push(session);
      return { status: 200 };
    }, once);
    signals.report("s1", "m_1", (t) => bump(t, "copies"));
    signals.report("s2", "m_2", (t) => bump(t, "followups"));
    await tick();
    expect(signals.of("m_1")).toEqual({ copies: 1 });
    expect(signals.of("m_2")).toEqual({ followups: 1 });
    expect(sessions).toEqual(["s1", "s2"]);
  });
});
