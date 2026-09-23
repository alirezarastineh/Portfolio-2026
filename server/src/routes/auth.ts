import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { clearSessionCookies, setSessionCookies, readSessionToken } from "../auth/cookies.js";
import {
  clientIp,
  clientIpOrNull,
  loadSession,
  requireCsrf,
  requireFullSession,
  requireTrustedOrigin,
} from "../auth/middleware.js";
import {
  createSession,
  listSessions,
  resolveSession,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
} from "../auth/session.js";
import { getDb } from "../db/client.js";
import { adminSessions, adminUsers } from "../db/schema.js";
import {
  backoffDelayMs,
  clearBucket,
  emailBucket,
  ipBucket,
  ipEmailBucket,
  IP_EMAIL_LIMIT,
  IP_LIMIT,
  recentFailures,
  recordAttempt,
  tooManyAttempts,
  totpBucket,
  TOTP_LIMIT,
} from "../lib/auth-rate-limit.js";
import { burnVerify, hashPassword, verifyPassword } from "../lib/password.js";
import { needsReseal, seal, unseal } from "../lib/secret-box.js";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  looksLikeRecoveryCode,
  matchTotpStep,
  normalizeRecoveryCode,
  totpQrSvg,
  totpUri,
  verifyTotp,
} from "../lib/totp.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Identical for unknown email and wrong password — no account enumeration. */
const INVALID_CREDENTIALS = { error: "invalid_credentials" } as const;

export const authRouter = new Hono();

authRouter.use("*", requireTrustedOrigin);

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

authRouter.post(
  "/login",
  zValidator(
    "json",
    z.object({ email: z.email().max(200), password: z.string().min(1).max(400) }),
    (result, c) => (result.success ? undefined : c.json({ error: "invalid_input" }, 400)),
  ),
  async (c) => {
    const { email, password } = c.req.valid("json");
    const ip = clientIp(c);
    const ipKey = ipBucket(ip);
    const emailKey = emailBucket(email);
    const pairKey = ipEmailBucket(ip, email);

    // No hard limit on the email alone — see IP_EMAIL_LIMIT for why.
    if (
      (await tooManyAttempts(ipKey, IP_LIMIT)) ||
      (await tooManyAttempts(pairKey, IP_EMAIL_LIMIT))
    ) {
      return c.json({ error: "rate_limited" }, 429);
    }

    // Slow a guessing run down in proportion to how much the account has
    // already failed, from every IP combined.
    await sleep(backoffDelayMs(await recentFailures(emailKey)));

    const [user] = await getDb()
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        passwordHash: adminUsers.passwordHash,
        totpSecret: adminUsers.totpSecret,
        isActive: adminUsers.isActive,
      })
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    const recordFailure = async () => {
      await recordAttempt(ipKey, "fail");
      await recordAttempt(emailKey, "fail");
      await recordAttempt(pairKey, "fail");
    };

    if (!user?.isActive) {
      // Burn equivalent CPU so timing does not reveal whether the email exists.
      await burnVerify(password);
      await recordFailure();
      return c.json(INVALID_CREDENTIALS, 401);
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      await recordFailure();
      return c.json(INVALID_CREDENTIALS, 401);
    }

    const pendingTotp = user.totpSecret !== null;
    const issued = await createSession({
      userId: user.id,
      pendingTotp,
      ip: clientIpOrNull(c),
      userAgent: c.req.header("user-agent"),
    });

    await recordAttempt(ipKey, "success");
    await clearBucket(emailKey);
    await clearBucket(pairKey);
    setSessionCookies(c, issued.token, issued.csrfToken);

    // Without TOTP there is no second step, so this branch is by definition an
    // account that has not enrolled — which is what drives the admin's nudge.
    return c.json({
      ok: true,
      totpRequired: pendingTotp,
      user: pendingTotp ? null : { id: user.id, email: user.email, totpEnrolled: false },
    });
  },
);

/* -------------------------------------------------------------------------- */
/* TOTP step                                                                   */
/* -------------------------------------------------------------------------- */

authRouter.post(
  "/totp",
  loadSession,
  requireCsrf,
  zValidator("json", z.object({ code: z.string().min(6).max(20) }), (result, c) =>
    result.success ? undefined : c.json({ error: "invalid_input" }, 400),
  ),
  async (c) => {
    const session = c.get("session");
    if (!session.pendingTotp) {
      return c.json({ error: "no_pending_totp" }, 400);
    }

    const ipKey = ipBucket(clientIp(c));
    // Per user as well as per IP: once the password is known, a distributed
    // run could otherwise work through the 10^6 code space from many IPs.
    const userKey = totpBucket(session.userId);
    if ((await tooManyAttempts(ipKey, IP_LIMIT)) || (await tooManyAttempts(userKey, TOTP_LIMIT))) {
      return c.json({ error: "rate_limited" }, 429);
    }

    const db = getDb();
    const [user] = await db
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        totpSecret: adminUsers.totpSecret,
        recoveryCodeHashes: adminUsers.recoveryCodeHashes,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, session.userId))
      .limit(1);

    if (!user?.totpSecret) {
      return c.json({ error: "no_pending_totp" }, 400);
    }

    const { code } = c.req.valid("json");
    const secret = unseal(user.totpSecret);
    const step = matchTotpStep(secret, code);
    let accepted = false;

    if (step !== null) {
      // Claimed atomically, so an intercepted code cannot be replayed inside its
      // validity window — not even by two requests racing each other.
      const claimed = await db
        .update(adminUsers)
        .set({
          totpLastStep: step,
          // Migrates a pre-encryption secret the first time it is used.
          ...(needsReseal(user.totpSecret) ? { totpSecret: seal(secret) } : {}),
        })
        .where(
          and(
            eq(adminUsers.id, user.id),
            or(isNull(adminUsers.totpLastStep), lt(adminUsers.totpLastStep, step)),
          ),
        )
        .returning({ id: adminUsers.id });
      accepted = claimed.length > 0;
    } else if (looksLikeRecoveryCode(code)) {
      // Fall back to a recovery code, consuming it on success.
      const normalized = normalizeRecoveryCode(code);
      const remaining: string[] = [];
      for (const hash of user.recoveryCodeHashes) {
        if (!accepted && (await verifyPassword(hash, normalized))) {
          accepted = true;
          continue; // single use: drop it
        }
        remaining.push(hash);
      }
      if (accepted) {
        await db
          .update(adminUsers)
          .set({ recoveryCodeHashes: remaining, updatedAt: new Date() })
          .where(eq(adminUsers.id, user.id));
      }
    }

    if (!accepted) {
      await recordAttempt(ipKey, "fail");
      await recordAttempt(userKey, "fail");
      return c.json({ error: "invalid_code" }, 401);
    }

    // Rotate: the half-authenticated session is destroyed and replaced, so a
    // token captured before the second factor is worthless afterwards.
    await revokeSession(session.id);
    const issued = await createSession({
      userId: user.id,
      pendingTotp: false,
      ip: clientIpOrNull(c),
      userAgent: c.req.header("user-agent"),
    });

    await recordAttempt(ipKey, "success");
    await clearBucket(userKey);
    setSessionCookies(c, issued.token, issued.csrfToken);

    return c.json({
      ok: true,
      user: { id: user.id, email: user.email, totpEnrolled: true },
    });
  },
);

/* -------------------------------------------------------------------------- */
/* Session introspection and logout                                            */
/* -------------------------------------------------------------------------- */

authRouter.get("/me", loadSession, (c) => {
  const session = c.get("session");
  return c.json({
    user: session.user,
    pendingTotp: session.pendingTotp,
    csrfToken: session.csrfToken,
  });
});

authRouter.post("/logout", async (c) => {
  const token = readSessionToken(c);
  if (token) {
    const session = await resolveSession(token);
    if (session) {
      if (c.req.query("all") === "1") {
        await revokeAllSessions(session.userId);
      } else {
        await revokeSession(session.id);
      }
    }
  }
  clearSessionCookies(c);
  return c.json({ ok: true });
});

authRouter.get("/sessions", loadSession, requireFullSession, async (c) => {
  const session = c.get("session");
  const rows = await listSessions(session.userId);
  return c.json({
    sessions: rows.map((row) => ({ ...row, current: row.id === session.id })),
  });
});

authRouter.delete("/sessions/:id", loadSession, requireFullSession, requireCsrf, async (c) => {
  const session = c.get("session");
  const target = c.req.param("id");

  if (target === "others") {
    const revoked = await revokeOtherSessions(session.userId, session.id);
    return c.json({ ok: true, revoked });
  }

  const [row] = await getDb()
    .select({ id: adminSessions.id, userId: adminSessions.userId })
    .from(adminSessions)
    .where(eq(adminSessions.id, target))
    .limit(1);

  if (row?.userId !== session.userId) {
    return c.json({ error: "not_found" }, 404);
  }

  await revokeSession(target);
  return c.json({ ok: true, selfRevoked: target === session.id });
});

/* -------------------------------------------------------------------------- */
/* Password                                                                    */
/* -------------------------------------------------------------------------- */

authRouter.post(
  "/password",
  loadSession,
  requireFullSession,
  requireCsrf,
  zValidator(
    "json",
    z.object({
      currentPassword: z.string().min(1).max(400),
      newPassword: z.string().min(12).max(400),
    }),
    (result, c) => (result.success ? undefined : c.json({ error: "invalid_input" }, 400)),
  ),
  async (c) => {
    const session = c.get("session");
    const { currentPassword, newPassword } = c.req.valid("json");
    const db = getDb();

    const [user] = await db
      .select({ passwordHash: adminUsers.passwordHash })
      .from(adminUsers)
      .where(eq(adminUsers.id, session.userId))
      .limit(1);

    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      return c.json(INVALID_CREDENTIALS, 401);
    }

    await db
      .update(adminUsers)
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(adminUsers.id, session.userId));

    // Everything else logs out; this session is re-issued so the admin is not
    // kicked out of the page they are standing on.
    await revokeAllSessions(session.userId);
    const issued = await createSession({
      userId: session.userId,
      pendingTotp: false,
      ip: clientIpOrNull(c),
      userAgent: c.req.header("user-agent"),
    });
    setSessionCookies(c, issued.token, issued.csrfToken);

    return c.json({ ok: true });
  },
);

/* -------------------------------------------------------------------------- */
/* TOTP enrolment                                                              */
/* -------------------------------------------------------------------------- */

authRouter.post(
  "/totp/setup",
  loadSession,
  requireFullSession,
  requireCsrf,
  zValidator(
    "json",
    z.object({
      password: z.string().min(1).max(400),
      /** Required only when replacing an enrolled factor. */
      code: z.string().min(6).max(20).optional(),
    }),
    (result, c) => (result.success ? undefined : c.json({ error: "invalid_input" }, 400)),
  ),
  async (c) => {
    const session = c.get("session");
    const { password, code } = c.req.valid("json");
    const db = getDb();

    const [user] = await db
      .select({
        email: adminUsers.email,
        passwordHash: adminUsers.passwordHash,
        totpSecret: adminUsers.totpSecret,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, session.userId))
      .limit(1);

    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      return c.json(INVALID_CREDENTIALS, 401);
    }

    // Replacing an enrolled factor is as sensitive as removing it, which already
    // needs a current code — the password alone must not be enough to swap in
    // an attacker's authenticator.
    if (user.totpSecret && !(code && verifyTotp(unseal(user.totpSecret), code))) {
      return c.json({ error: "invalid_code" }, 401);
    }

    // Held in `totp_pending_secret` until confirmed, so an abandoned enrolment
    // can never lock the account out.
    const secret = generateTotpSecret();
    await db
      .update(adminUsers)
      .set({ totpPendingSecret: seal(secret), updatedAt: new Date() })
      .where(eq(adminUsers.id, session.userId));

    return c.json({
      otpauthUri: totpUri(secret, user.email),
      qrSvg: await totpQrSvg(secret, user.email),
    });
  },
);

authRouter.post(
  "/totp/confirm",
  loadSession,
  requireFullSession,
  requireCsrf,
  zValidator("json", z.object({ code: z.string().min(6).max(10) }), (result, c) =>
    result.success ? undefined : c.json({ error: "invalid_input" }, 400),
  ),
  async (c) => {
    const session = c.get("session");
    const db = getDb();

    const [user] = await db
      .select({ totpPendingSecret: adminUsers.totpPendingSecret })
      .from(adminUsers)
      .where(eq(adminUsers.id, session.userId))
      .limit(1);

    if (!user?.totpPendingSecret) {
      return c.json({ error: "no_pending_enrolment" }, 400);
    }

    const pending = unseal(user.totpPendingSecret);
    const step = matchTotpStep(pending, c.req.valid("json").code);
    if (step === null) {
      return c.json({ error: "invalid_code" }, 401);
    }

    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map((code) => hashPassword(code)));

    await db
      .update(adminUsers)
      .set({
        totpSecret: seal(pending),
        totpPendingSecret: null,
        totpEnrolledAt: new Date(),
        // The confirming code is spent, so it cannot also complete a login.
        totpLastStep: step,
        recoveryCodeHashes: hashes,
        updatedAt: new Date(),
      })
      .where(eq(adminUsers.id, session.userId));

    // A new second factor is a credential change: any session opened before it
    // — possibly by whoever prompted the change — is signed out.
    await revokeOtherSessions(session.userId, session.id);

    // Returned exactly once; only hashes are retained.
    return c.json({ ok: true, recoveryCodes });
  },
);

authRouter.delete(
  "/totp",
  loadSession,
  requireFullSession,
  requireCsrf,
  zValidator(
    "json",
    z.object({ password: z.string().min(1).max(400), code: z.string().min(6).max(20) }),
    (result, c) => (result.success ? undefined : c.json({ error: "invalid_input" }, 400)),
  ),
  async (c) => {
    const session = c.get("session");
    const { password, code } = c.req.valid("json");
    const db = getDb();

    const [user] = await db
      .select({ passwordHash: adminUsers.passwordHash, totpSecret: adminUsers.totpSecret })
      .from(adminUsers)
      .where(eq(adminUsers.id, session.userId))
      .limit(1);

    if (!user?.totpSecret || !(await verifyPassword(user.passwordHash, password))) {
      return c.json(INVALID_CREDENTIALS, 401);
    }
    if (!verifyTotp(unseal(user.totpSecret), code)) {
      return c.json({ error: "invalid_code" }, 401);
    }

    await db
      .update(adminUsers)
      .set({
        totpSecret: null,
        totpPendingSecret: null,
        totpEnrolledAt: null,
        totpLastStep: null,
        recoveryCodeHashes: [],
        updatedAt: new Date(),
      })
      .where(eq(adminUsers.id, session.userId));

    return c.json({ ok: true });
  },
);
