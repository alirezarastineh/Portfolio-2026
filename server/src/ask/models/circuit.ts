/**
 * A breaker per model, in memory. It opens after three failures in a row or
 * any rate limit (for as long as the provider's Retry-After asks, at least a
 * minute), so a model that is down is skipped instead of costing every visitor
 * a timeout. Once the pause is over, one request probes it (half-open): success
 * closes the breaker, failure opens it again.
 */

export const FAILURES_TO_OPEN = 3;
export const DEFAULT_OPEN_MS = 60_000;
const MAX_OPEN_MS = 30 * 60_000;
const TTFT_SAMPLES = 50;

interface Breaker {
  consecutiveFailures: number;
  openUntil: number;
  probing: boolean;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  ttft: number[];
}

const breakers = new Map<string, Breaker>();

function get(model: string): Breaker {
  let breaker = breakers.get(model);
  if (!breaker) {
    breaker = {
      consecutiveFailures: 0,
      openUntil: 0,
      probing: false,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      ttft: [],
    };
    breakers.set(model, breaker);
  }
  return breaker;
}

/** Whether a request may go to this model now; claims the probe when half-open. */
export function tryAcquire(model: string, now = Date.now()): boolean {
  const breaker = get(model);
  if (breaker.openUntil === 0) return true;
  if (now < breaker.openUntil || breaker.probing) return false;
  breaker.probing = true;
  return true;
}

export function recordSuccess(model: string, ttftMs: number | null, now = Date.now()): void {
  const breaker = get(model);
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
  breaker.probing = false;
  breaker.lastSuccessAt = now;
  if (ttftMs !== null) {
    breaker.ttft.push(ttftMs);
    if (breaker.ttft.length > TTFT_SAMPLES) breaker.ttft.shift();
  }
}

export function recordFailure(
  model: string,
  failure: { error: string; rateLimited?: boolean; retryAfterMs?: number | null },
  now = Date.now(),
): void {
  const breaker = get(model);
  breaker.consecutiveFailures++;
  breaker.lastFailureAt = now;
  breaker.lastError = failure.error.slice(0, 200);
  const wasProbe = breaker.probing;
  breaker.probing = false;
  if (failure.rateLimited || wasProbe || breaker.consecutiveFailures >= FAILURES_TO_OPEN) {
    const pause = Math.min(Math.max(failure.retryAfterMs ?? 0, DEFAULT_OPEN_MS), MAX_OPEN_MS);
    breaker.openUntil = now + pause;
  }
}

/**
 * A probe that ended without a verdict (the visitor left) must not hold the
 * half-open slot forever.
 */
export function releaseProbe(model: string): void {
  get(model).probing = false;
}

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerSnapshot {
  model: string;
  state: BreakerState;
  openUntil: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  p50TtftMs: number | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

export function breakerSnapshot(models: string[], now = Date.now()): BreakerSnapshot[] {
  return models.map((model) => {
    const b = get(model);
    let state: BreakerState = "closed";
    if (b.openUntil !== 0) state = now < b.openUntil ? "open" : "half-open";
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    return {
      model,
      state,
      openUntil: b.openUntil ? new Date(b.openUntil).toISOString() : null,
      consecutiveFailures: b.consecutiveFailures,
      lastSuccessAt: iso(b.lastSuccessAt),
      lastFailureAt: iso(b.lastFailureAt),
      lastError: b.lastError,
      p50TtftMs: median(b.ttft),
    };
  });
}

/** Tests only. */
export function resetBreakers(): void {
  breakers.clear();
}
