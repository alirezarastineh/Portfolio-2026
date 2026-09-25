const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare Turnstile in front of the contact form and the assistant. Off
 * unless TURNSTILE_SECRET_KEY is set (the client needs the matching
 * VITE_TURNSTILE_SITE_KEY at build time).
 */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

/**
 * Whether a widget token is genuine. Tokens are single use and short-lived.
 *
 * When Cloudflare cannot be reached the request is let through: the honeypot
 * and the rate limits still stand, and a third party's outage should not close
 * the contact form. A token Cloudflare rejects is refused.
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true;
  if (!token || token.length > 2048) return false;

  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      console.warn(`[turnstile] siteverify answered ${response.status}; letting it through`);
      return true;
    }
    const body = (await response.json()) as { success?: unknown };
    return body.success === true;
  } catch (error) {
    console.warn("[turnstile] siteverify unreachable; letting it through", error);
    return true;
  }
}

/**
 * Sessions that already passed, so the assistant checks once per visit rather
 * than before every question (a token per question would add a second to
 * each answer). In memory: a restart only means one more check.
 */
export class VerifiedSessions {
  private readonly until = new Map<string, number>();

  constructor(
    private readonly ttlMs = 12 * 60 * 60 * 1000,
    private readonly max = 10_000,
  ) {}

  has(key: string, now = Date.now()): boolean {
    const expires = this.until.get(key);
    if (expires === undefined) return false;
    if (expires > now) return true;
    this.until.delete(key);
    return false;
  }

  add(key: string, now = Date.now()): void {
    this.until.delete(key);
    this.until.set(key, now + this.ttlMs);
    // Maps keep insertion order: the first key is the oldest.
    while (this.until.size > this.max) {
      const oldest = this.until.keys().next().value;
      if (oldest === undefined) break;
      this.until.delete(oldest);
    }
  }
}
