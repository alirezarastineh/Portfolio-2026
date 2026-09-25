import { afterEach, describe, expect, it, vi } from "vitest";

import { turnstileEnabled, VerifiedSessions, verifyTurnstile } from "./turnstile.js";

function answer(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe("verifyTurnstile", () => {
  it("is off, and lets everything through, without a secret", async () => {
    expect(turnstileEnabled()).toBe(false);
    const fetchImpl = answer({ success: false });
    expect(await verifyTurnstile(undefined, "203.0.113.1", fetchImpl)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks Cloudflare, with the secret, the token and the IP", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const fetchImpl = answer({ success: true });
    expect(await verifyTurnstile("token", "203.0.113.1", fetchImpl)).toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("siteverify");
    expect(String((init as RequestInit).body)).toBe(
      "secret=secret&response=token&remoteip=203.0.113.1",
    );
  });

  it("refuses a missing or rejected token", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(await verifyTurnstile(undefined, "ip", answer({ success: true }))).toBe(false);
    expect(await verifyTurnstile("forged", "ip", answer({ success: false }))).toBe(false);
  });

  it("lets a request through when Cloudflare cannot answer", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await verifyTurnstile("token", "ip", down)).toBe(true);
    expect(await verifyTurnstile("token", "ip", answer({}, 502))).toBe(true);
  });
});

describe("VerifiedSessions", () => {
  it("remembers a session until it expires, and forgets the oldest past the cap", () => {
    const sessions = new VerifiedSessions(1_000, 2);
    sessions.add("a", 0);
    expect(sessions.has("a", 999)).toBe(true);
    expect(sessions.has("a", 1_000)).toBe(false);

    sessions.add("b", 0);
    sessions.add("c", 0);
    sessions.add("d", 0);
    expect(sessions.has("b", 1)).toBe(false);
    expect(sessions.has("d", 1)).toBe(true);
  });
});
