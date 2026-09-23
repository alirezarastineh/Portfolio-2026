import { beforeEach, describe, expect, it, vi } from "vitest";

const mailer = vi.hoisted(() => ({
  isMailerConfigured: vi.fn(() => true),
  sendContactEmail: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../lib/mailer.js", () => mailer);

const { createApp } = await import("../app.js");
const { getDb } = await import("../db/client.js");
const { contactMessages } = await import("../db/schema.js");
const { resetDb } = await import("../test/helpers.js");
const { PER_IP_LIMIT, pruneContactMessages } = await import("./contact.js");

const app = createApp();
const VALID = { name: "Jane", email: "jane@example.com", message: "Hello there, a real message." };

let ipCounter = 0;

/** A fresh IP per call, so the per-sender limit stays out of tests that are not about it. */
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

async function stored() {
  return getDb().select().from(contactMessages);
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  mailer.isMailerConfigured.mockReturnValue(true);
  mailer.sendContactEmail.mockResolvedValue({ ok: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /contact", () => {
  it("stores the message, then emails it", async () => {
    const res = await send({ ...VALID, locale: "de" });
    expect(res.status).toBe(200);
    expect(mailer.sendContactEmail).toHaveBeenCalledWith(VALID);

    const [row] = await stored();
    expect(row).toMatchObject({ ...VALID, locale: "de", status: "new", mailStatus: "sent" });
  });

  /** The point of storing first: a mail outage must not lose the message. */
  it("keeps the message when the email fails, and tells the sender it arrived", async () => {
    mailer.sendContactEmail.mockResolvedValue({ ok: false, error: "resend down" } as never);
    const res = await send(VALID);
    expect(res.status).toBe(200);

    const [row] = await stored();
    expect(row).toMatchObject({ mailStatus: "failed", mailError: "resend down" });
  });

  it("stores the message even with no mailer configured", async () => {
    mailer.isMailerConfigured.mockReturnValue(false);
    expect((await send(VALID)).status).toBe(200);
    expect(mailer.sendContactEmail).not.toHaveBeenCalled();
    expect((await stored())[0]).toMatchObject({ mailStatus: "skipped" });
  });

  it("never stores the sender's raw IP", async () => {
    await send(VALID, "203.0.113.77");
    const [row] = await stored();
    expect(row!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.77");
  });

  it("rejects invalid input without storing anything", async () => {
    const res = await send({ ...VALID, email: "not-an-email", message: "short" });
    expect(res.status).toBe(400);
    expect(await stored()).toHaveLength(0);
  });

  /** A bot that fills the hidden field is told it worked, so it does not adapt. */
  it("silently drops a filled honeypot", async () => {
    const res = await send({ ...VALID, website: "https://spam.example" });
    expect(res.status).toBe(200);
    expect(await stored()).toHaveLength(0);
    expect(mailer.sendContactEmail).not.toHaveBeenCalled();
  });

  /** Database-backed now, so a deploy or restart no longer resets it. */
  it("limits one sender per window", async () => {
    const ip = "203.0.113.200";
    for (let i = 0; i < PER_IP_LIMIT; i++) expect((await send(VALID, ip)).status).toBe(200);
    expect((await send(VALID, ip)).status).toBe(429);
    expect((await send(VALID)).status).toBe(200); // someone else still gets through
  });

  it("caps the total per day across all senders", async () => {
    vi.stubEnv("CONTACT_DAILY_CAP", "3");
    try {
      for (let i = 0; i < 3; i++) expect((await send(VALID)).status).toBe(200);
      expect((await send(VALID)).status).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("admin inbox", () => {
  it("lists stored messages, including ones whose email failed, and marks them", async () => {
    const { createAdmin, TestClient } = await import("../test/helpers.js");
    mailer.sendContactEmail.mockResolvedValue({ ok: false, error: "resend down" } as never);
    await send(VALID);

    await createAdmin();
    const admin = new TestClient(app);
    await admin.login();

    const list = await admin.get("/admin/messages");
    const { messages } = (await list.json()) as {
      messages: { id: string; mailStatus: string; status: string }[];
    };
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ mailStatus: "failed", status: "new" });

    const patch = await admin.patch(`/admin/messages/${messages[0]!.id}`, { status: "archived" });
    expect(patch.status).toBe(200);
    // Archived messages drop out of the default view.
    const after = (await (await admin.get("/admin/messages")).json()) as { messages: unknown[] };
    expect(after.messages).toHaveLength(0);
  });

  it("is not readable without an admin session", async () => {
    await send(VALID);
    expect((await app.request("/admin/messages")).status).toBe(401);
  });
});

describe("pruneContactMessages", () => {
  it("removes messages older than 180 days and keeps recent ones", async () => {
    await getDb()
      .insert(contactMessages)
      .values([
        { ...VALID, ipHash: "a", createdAt: new Date(Date.now() - 181 * 24 * 60 * 60 * 1000) },
        { ...VALID, ipHash: "b", createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      ]);
    await pruneContactMessages();
    const rows = await stored();
    expect(rows.map((r) => r.ipHash)).toEqual(["b"]);
  });
});
