import { afterEach, describe, expect, it, vi } from "vitest";

import { turnstileEnabled, VerifiedSessions, verifyTurnstile } from "./turnstile.js";

function answer(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

function bodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  return "";
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
    const call = fetchImpl.mock.calls[0];
    if (!call) {
      throw new Error("expected fetch to be called");
    }
    const [url, init] = call;
    expect(url).toContain("siteverify");
    expect(bodyText(init)).toBe("secret=secret&response=token&remoteip=203.0.113.1");
  });

  it("refuses a missing or rejected token", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(await verifyTurnstile(undefined, "ip", answer({ success: true }))).toBe(false);
    expect(await verifyTurnstile("forged", "ip", answer({ success: false }))).toBe(false);
  });

  it("lets a request through when Cloudflare cannot answer", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const down = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await verifyTurnstile("token", "ip", down)).toBe(true);
    expect(await verifyTurnstile("token", "ip", answer({}, 502))).toBe(true);
  });
});

describe("VerifiedSessions", () => {
  it("remembers a session until it expires, and forgets the oldest past the cap", () => {
    const sessions = new VerifiedSessions(1000, 2);
    sessions.add("a", 0);
    expect(sessions.has("a", 999)).toBe(true);
    expect(sessions.has("a", 1000)).toBe(false);

    sessions.add("b", 0);
    sessions.add("c", 0);
    sessions.add("d", 0);
    expect(sessions.has("b", 1)).toBe(false);
    expect(sessions.has("d", 1)).toBe(true);
  });
});
