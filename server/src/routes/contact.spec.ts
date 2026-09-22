import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mailer = vi.hoisted(() => ({
  isMailerConfigured: vi.fn(() => true),
  sendContactEmail: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../lib/mailer.js", () => mailer);

const { contactRouter } = await import("./contact.js");
const app = new Hono().route("/contact", contactRouter);

const VALID = { name: "Jane", email: "jane@example.com", message: "Hello there, a real message." };

let ipCounter = 0;

/** A fresh IP per call, so the in-memory limiter (5 per IP) stays out of tests that are not about it. */
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function send(body: unknown, ip = nextIp()) {
  return app.request("/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mailer.isMailerConfigured.mockReturnValue(true);
  mailer.sendContactEmail.mockResolvedValue({ ok: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /contact", () => {
  it("sends a valid message", async () => {
    const res = await send(VALID);
    expect(res.status).toBe(200);
    expect(mailer.sendContactEmail).toHaveBeenCalledWith({
      name: VALID.name,
      email: VALID.email,
      message: VALID.message,
    });
  });

  it("rejects invalid input", async () => {
    const res = await send({ ...VALID, email: "not-an-email", message: "short" });
    expect(res.status).toBe(400);
    expect(mailer.sendContactEmail).not.toHaveBeenCalled();
  });

  /** A bot that fills the hidden field is told it worked, so it does not adapt. */
  it("silently drops a filled honeypot", async () => {
    const res = await send({ ...VALID, website: "https://spam.example" });
    expect(res.status).toBe(200);
    expect(mailer.sendContactEmail).not.toHaveBeenCalled();
  });

  it("limits one IP to five messages per window", async () => {
    const ip = "203.0.113.200";
    for (let i = 0; i < 5; i++) expect((await send(VALID, ip)).status).toBe(200);
    expect((await send(VALID, ip)).status).toBe(429);
  });

  it("reports an unconfigured mailer as unavailable", async () => {
    mailer.isMailerConfigured.mockReturnValue(false);
    expect((await send(VALID)).status).toBe(503);
  });

  it("reports a failed send as a bad gateway", async () => {
    mailer.sendContactEmail.mockResolvedValue({ ok: false, error: "boom" } as never);
    expect((await send(VALID)).status).toBe(502);
  });
});
