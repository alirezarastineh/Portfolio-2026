import { describe, expect, it } from "vitest";

import {
  AnswerSignals,
  bump,
  MAX_SIGNAL_COUNT,
  MAX_SIGNAL_MS,
  signalMs,
  type SignalTotals,
} from "./answer-signals";

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
