const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 5000;

export function tooManyRequests(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const previous = buckets.get(ip) ?? [];
  const fresh = previous.filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    buckets.set(ip, fresh);
    return true;
  }
  fresh.push(now);
  buckets.set(ip, fresh);
  if (buckets.size > MAX_BUCKETS) {
    pruneStale(now, windowMs);
  }
  return false;
}

function pruneStale(now: number, windowMs: number): void {
  for (const [ip, stamps] of buckets.entries()) {
    const fresh = stamps.filter((t) => now - t < windowMs);
    if (fresh.length === 0) {
      buckets.delete(ip);
    } else {
      buckets.set(ip, fresh);
    }
  }
}
