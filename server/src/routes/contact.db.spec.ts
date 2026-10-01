import { beforeEach, describe, expect, it, vi } from "vitest";

const mailer = vi.hoisted(() => ({
  isMailerConfigured: vi.fn(() => true),
  sendContactEmail: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../lib/mailer.js", () => mailer);

const { eq } = await import("drizzle-orm");
const { createApp } = await import("../app.js");
const { hashWithSalt } = await import("../ask/guard.js");
const { getDb } = await import("../db/client.js");
const { aiMessages, contactMessages } = await import("../db/schema.js");
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
    // What the previous client sends still stores as a plain form message.
    expect(row).toMatchObject({ origin: "form", askMessageId: null, askTranscript: null });
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

describe("the assistant's hand-off", () => {
  const SESSION = "session-abcdefghijkl";
  const OTHER = "someone-else-abcdefgh";
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 30, 10, minute));

  /** Twelve answers in the visitor's session, one in another, one after the hand-off. */
  async function seedConversation(): Promise<void> {
    const base = {
      locale: "en" as const,
      route: "lite",
      totalMs: 100,
      tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
      finishReason: "stop",
      promptVersion: "p",
      citedIds: ["profile@en"],
    };
    const mine = hashWithSalt("session", SESSION);
    await getDb()
      .insert(aiMessages)
      .values([
        ...Array.from({ length: 12 }, (_, i) => ({
          ...base,
          id: `m_mine_${String(i).padStart(2, "0")}`,
          sessionHash: mine,
          createdAt: at(i),
          questionRedacted: `question ${i}`,
          answerExcerpt: `answer ${i}`,
        })),
        {
          ...base,
          id: "m_other_00",
          sessionHash: hashWithSalt("session", OTHER),
          createdAt: at(5),
          questionRedacted: "someone else's question",
          answerExcerpt: "not yours",
        },
        {
          ...base,
          id: "m_mine_later",
          sessionHash: mine,
          createdAt: at(30),
          questionRedacted: "asked after the hand-off",
          answerExcerpt: "later",
        },
      ]);
  }

  it("says the message came through the hand-off, and attaches nothing unless asked", async () => {
    expect((await send({ ...VALID, origin: "ask" })).status).toBe(200);
    const [row] = await stored();
    expect(row).toMatchObject({ origin: "ask", askMessageId: null, askTranscript: null });
  });

  it("attaches the visitor's own conversation up to the answer, the last ten turns", async () => {
    await seedConversation();
    const ask = { sessionId: SESSION, messageId: "m_mine_11" };
    expect((await send({ ...VALID, origin: "ask", ask })).status).toBe(200);
    const [row] = await stored();
    expect(row).toMatchObject({ origin: "ask", askMessageId: "m_mine_11" });
    const turns = row!.askTranscript!.turns;
    // Oldest first, ending at the hand-off's answer; never another session's.
    expect(turns.map((t) => t.question)).toEqual(
      Array.from({ length: 10 }, (_, i) => `question ${i + 2}`),
    );
    expect(turns.at(-1)).toMatchObject({ answer: "answer 11", cited: ["profile@en"] });
  });

  it("serves the attached conversation to the admin inbox", async () => {
    const { createAdmin, TestClient } = await import("../test/helpers.js");
    await seedConversation();
    const ask = { sessionId: SESSION, messageId: "m_mine_11" };
    await send({ ...VALID, origin: "ask", ask });
    await createAdmin();
    const admin = new TestClient(app);
    await admin.login();

    const { messages } = (await (await admin.get("/admin/messages")).json()) as {
      messages: { origin: string; askTranscript: { turns: { question: string }[] } | null }[];
    };
    expect(messages[0]).toMatchObject({ origin: "ask" });
    expect(messages[0]!.askTranscript!.turns.map((t) => t.question).at(-1)).toBe("question 11");
  });

  it("stores the message without a conversation that is not the visitor's", async () => {
    await seedConversation();
    const ask = { sessionId: OTHER, messageId: "m_mine_11" };
    expect((await send({ ...VALID, origin: "ask", ask })).status).toBe(200);
    const [row] = await stored();
    expect(row).toMatchObject({ message: VALID.message, askMessageId: null, askTranscript: null });
  });

  it("keeps the message when its answer is pruned", async () => {
    await seedConversation();
    await send({ ...VALID, origin: "ask", ask: { sessionId: SESSION, messageId: "m_mine_11" } });
    await getDb().delete(aiMessages).where(eq(aiMessages.id, "m_mine_11"));
    const [row] = await stored();
    expect(row).toMatchObject({ askMessageId: null, origin: "ask" });
    expect(row!.askTranscript!.turns).toHaveLength(10);
  });

  it("rejects an origin or a conversation of the wrong shape", async () => {
    expect((await send({ ...VALID, origin: "email" })).status).toBe(400);
    expect((await send({ ...VALID, ask: { sessionId: "short", messageId: "m" } })).status).toBe(
      400,
    );
    expect(await stored()).toHaveLength(0);
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
