import { describe, expect, it } from "vitest";

import { MAX_SIGNAL_COUNT, MAX_SIGNAL_MS, SignalLimiter, signalsSchema } from "./signals.js";

describe("the browser's signals (visitor plan V2)", () => {
  it("take times and counts within their bounds, at least one, nothing else", () => {
    expect(signalsSchema.safeParse({ shownMs: 0, doneMs: MAX_SIGNAL_MS }).success).toBe(true);
    expect(signalsSchema.safeParse({ copies: MAX_SIGNAL_COUNT, stopped: true }).success).toBe(true);
    for (const bad of [
      {},
      { copies: MAX_SIGNAL_COUNT + 1 },
      { doneMs: MAX_SIGNAL_MS + 1 },
      { shownMs: 2.5 },
      { followups: -1 },
      { answer: "text" },
    ]) {
      expect(signalsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("let a session send so many batches an hour, then refuse until its hour is over", () => {
    const limiter = new SignalLimiter(2);
    const at = 1_000_000;
    expect(limiter.take("s1", at)).toBe(true);
    expect(limiter.take("s1", at + 1)).toBe(true);
    expect(limiter.take("s1", at + 2)).toBe(false);
    // Another session has its own count.
    expect(limiter.take("s2", at + 3)).toBe(true);
    // An hour on, the first starts again.
    expect(limiter.take("s1", at + 3_600_000)).toBe(true);
  });

  it("remember a bounded number of sessions: expired ones go first, then the oldest", () => {
    const limiter = new SignalLimiter(1, 3);
    const at = 1_000_000;
    expect(limiter.take("s1", at)).toBe(true);
    expect(limiter.take("s1", at + 1)).toBe(false);
    for (const [i, session] of ["s2", "s3", "s4", "s5"].entries()) {
      expect(limiter.take(session, at + 2 + i)).toBe(true);
    }
    expect(limiter.sessions).toBe(3);
    // A flood pushed s1's window out: it starts again. The newest are still counted.
    expect(limiter.take("s1", at + 10)).toBe(true);
    expect(limiter.take("s5", at + 11)).toBe(false);
    expect(limiter.sessions).toBe(3);

    // Past their hour, the expired windows make room without pushing out a live one.
    const later = at + 5 + 3_600_000;
    expect(limiter.take("s6", later)).toBe(true);
    expect(limiter.take("s1", later + 1)).toBe(false);
    expect(limiter.sessions).toBeLessThanOrEqual(3);
  });
});
