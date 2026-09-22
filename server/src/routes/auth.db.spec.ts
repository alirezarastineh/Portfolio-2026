import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { adminSessions, adminUsers } from "../db/schema.js";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createAdmin,
  resetDb,
  TestClient,
  totpCode,
} from "../test/helpers.js";

const app = createApp();

beforeEach(async () => {
  vi.unstubAllEnvs();
  await resetDb();
  await createAdmin();
});

/** Enrols TOTP for the logged-in client; returns the otpauth URI and recovery codes. */
async function enrolTotp(client: TestClient) {
  const setup = await client.post("/auth/totp/setup", { password: ADMIN_PASSWORD });
  expect(setup.status).toBe(200);
  const { otpauthUri } = (await setup.json()) as { otpauthUri: string };

  const confirm = await client.post("/auth/totp/confirm", { code: totpCode(otpauthUri) });
  expect(confirm.status).toBe(200);
  const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
  return { otpauthUri, recoveryCodes };
}

describe("login", () => {
  it("issues a session for correct credentials", async () => {
    const client = new TestClient(app);
    const res = await client.login();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, totpRequired: false });
    expect(client.cookie("pf_sid")).toBeTruthy();

    const me = await client.get("/auth/me");
    expect(me.status).toBe(200);
  });

  it("answers a wrong password and an unknown email identically", async () => {
    const wrongPassword = await new TestClient(app).login(ADMIN_EMAIL, "nope nope nope");
    const unknownEmail = await new TestClient(app).login("ghost@example.test", "nope nope nope");
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });
});

describe("CSRF layers", () => {
  it("rejects a state-changing request without a trusted Origin", async () => {
    const res = await new TestClient(app).post(
      "/auth/login",
      { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      { origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "origin_rejected" });
  });

  it("rejects an admin write whose CSRF header does not match", async () => {
    const client = new TestClient(app);
    await client.login();
    const res = await client.post("/admin/publish", {}, { "x-csrf-token": "forged" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_invalid" });
  });
});

describe("login rate limiting", () => {
  it("locks an IP out of an account after 5 failures, but not the account itself", async () => {
    const attacker = new TestClient(app, "198.51.100.66");
    for (let i = 0; i < 5; i++) {
      expect((await attacker.login(ADMIN_EMAIL, "wrong password!")).status).toBe(401);
    }
    expect((await attacker.login()).status).toBe(429);

    // The real admin, elsewhere, still gets in: knowing the address is not
    // enough to lock the only operator out.
    const admin = new TestClient(app, "192.0.2.10");
    expect((await admin.login()).status).toBe(200);
  });
});

describe("TOTP", () => {
  it("requires the second factor once enrolled", async () => {
    const setupClient = new TestClient(app);
    await setupClient.login();
    const { otpauthUri } = await enrolTotp(setupClient);

    const client = new TestClient(app);
    const login = await client.login();
    expect(await login.json()).toMatchObject({ totpRequired: true });
    expect((await client.get("/auth/sessions")).status).toBe(401);

    // The confirming code's step is already spent, so log in with the next one.
    const totp = await client.post("/auth/totp", { code: totpCode(otpauthUri, 1) });
    expect(totp.status).toBe(200);
    expect((await client.get("/auth/sessions")).status).toBe(200);
  });

  it("refuses to accept the same code twice", async () => {
    const setupClient = new TestClient(app);
    await setupClient.login();
    const { otpauthUri } = await enrolTotp(setupClient);
    const code = totpCode(otpauthUri, 1);

    const first = new TestClient(app);
    await first.login();
    expect((await first.post("/auth/totp", { code })).status).toBe(200);

    const replay = new TestClient(app);
    await replay.login();
    const res = await replay.post("/auth/totp", { code });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("does not accept the enrolment code for a login", async () => {
    const client = new TestClient(app);
    await client.login();
    const setup = await client.post("/auth/totp/setup", { password: ADMIN_PASSWORD });
    const { otpauthUri } = (await setup.json()) as { otpauthUri: string };
    const code = totpCode(otpauthUri);
    expect((await client.post("/auth/totp/confirm", { code })).status).toBe(200);

    const next = new TestClient(app);
    await next.login();
    expect((await next.post("/auth/totp", { code })).status).toBe(401);
  });

  it("accepts a recovery code typed without its hyphen, exactly once", async () => {
    const setupClient = new TestClient(app);
    await setupClient.login();
    const { recoveryCodes } = await enrolTotp(setupClient);
    const typed = recoveryCodes[0]!.replace("-", "").toLowerCase();

    const first = new TestClient(app);
    await first.login();
    expect((await first.post("/auth/totp", { code: typed })).status).toBe(200);

    const again = new TestClient(app);
    await again.login();
    expect((await again.post("/auth/totp", { code: typed })).status).toBe(401);
  });

  it("stores the secret encrypted when TOTP_ENC_KEY is set", async () => {
    vi.stubEnv("TOTP_ENC_KEY", randomBytes(32).toString("base64"));

    const setupClient = new TestClient(app);
    await setupClient.login();
    const { otpauthUri } = await enrolTotp(setupClient);

    const [row] = await getDb()
      .select({ secret: adminUsers.totpSecret })
      .from(adminUsers)
      .where(eq(adminUsers.email, ADMIN_EMAIL));
    expect(row?.secret).toMatch(/^v1:/);

    const client = new TestClient(app);
    await client.login();
    expect((await client.post("/auth/totp", { code: totpCode(otpauthUri, 1) })).status).toBe(200);
  });

  it("needs a current code to replace an enrolled factor, and signs out other sessions", async () => {
    const owner = new TestClient(app);
    await owner.login();
    const { otpauthUri } = await enrolTotp(owner);

    const other = new TestClient(app, "192.0.2.77");
    await other.login();
    await other.post("/auth/totp", { code: totpCode(otpauthUri, 1) });
    expect((await other.get("/auth/sessions")).status).toBe(200);

    // The password alone must not be enough to swap in a new authenticator.
    const withoutCode = await owner.post("/auth/totp/setup", { password: ADMIN_PASSWORD });
    expect(withoutCode.status).toBe(401);

    const setup = await owner.post("/auth/totp/setup", {
      password: ADMIN_PASSWORD,
      code: totpCode(otpauthUri),
    });
    expect(setup.status).toBe(200);
    const { otpauthUri: nextUri } = (await setup.json()) as { otpauthUri: string };
    expect((await owner.post("/auth/totp/confirm", { code: totpCode(nextUri) })).status).toBe(200);

    expect((await other.get("/auth/sessions")).status).toBe(401);
    expect((await owner.get("/auth/sessions")).status).toBe(200);
  });
});

describe("session cookie", () => {
  async function ageSession(sessionFilter: { pendingTotp: boolean }) {
    const db = getDb();
    const [row] = await db
      .select({ id: adminSessions.id, idleExpiresAt: adminSessions.idleExpiresAt })
      .from(adminSessions)
      .where(eq(adminSessions.pendingTotp, sessionFilter.pendingTotp));
    await db
      .update(adminSessions)
      .set({ lastSeenAt: new Date(Date.now() - 2 * 60 * 1000) })
      .where(eq(adminSessions.id, row!.id));
    return row!;
  }

  it("is re-issued when activity slides the idle window", async () => {
    const client = new TestClient(app);
    await client.login();
    const before = await ageSession({ pendingTotp: false });
    const token = client.cookie("pf_sid");

    const res = await client.get("/auth/me");
    expect(res.status).toBe(200);
    expect(client.lastSetCookies.some((c) => c.startsWith("pf_sid="))).toBe(true);
    expect(client.cookie("pf_sid")).toBe(token);

    const [after] = await getDb()
      .select({ idleExpiresAt: adminSessions.idleExpiresAt })
      .from(adminSessions)
      .where(eq(adminSessions.id, before.id));
    expect(after!.idleExpiresAt.getTime()).toBeGreaterThan(before.idleExpiresAt.getTime());
  });

  it("never slides a half-authenticated (pending TOTP) session", async () => {
    const setupClient = new TestClient(app);
    await setupClient.login();
    await enrolTotp(setupClient);
    await getDb().delete(adminSessions);

    const client = new TestClient(app);
    await client.login();
    const before = await ageSession({ pendingTotp: true });

    await client.get("/auth/me");
    expect(client.lastSetCookies).toEqual([]);

    const [after] = await getDb()
      .select({ idleExpiresAt: adminSessions.idleExpiresAt })
      .from(adminSessions)
      .where(eq(adminSessions.id, before.id));
    expect(after!.idleExpiresAt.getTime()).toBe(before.idleExpiresAt.getTime());
  });
});
