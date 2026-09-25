import { createHash, randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { clientIp } from "../auth/middleware.js";
import { getDb } from "../db/client.js";
import { contactMessages } from "../db/schema.js";
import { isMailerConfigured, sendContactEmail } from "../lib/mailer.js";
import { verifyTurnstile } from "../lib/turnstile.js";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  message: z.string().trim().min(10).max(4000),
  website: z.string().max(200).optional(),
  locale: z.enum(["en", "de"]).optional(),
  /** Required only while Turnstile is on (TURNSTILE_SECRET_KEY). */
  turnstileToken: z.string().max(2048).optional(),
});

/** Per sender: survives restarts and deploys, unlike the old in-memory limiter. */
export const PER_IP_LIMIT = 5;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
/** Across all senders: a flood from many IPs cannot exhaust the mail quota. */
function dailyCap(): number {
  const parsed = Number.parseInt(process.env.CONTACT_DAILY_CAP ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Only a salted hash of the IP is stored: enough to rate-limit a sender, not to
 * identify one. Without IP_HASH_SALT a per-process salt is used, which only
 * means the limiter forgets senders across a restart.
 */
const processSalt = randomBytes(16).toString("hex");
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT?.trim() || processSalt;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

async function countSince(since: Date, ipHash?: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(contactMessages)
    .where(
      ipHash
        ? and(eq(contactMessages.ipHash, ipHash), gte(contactMessages.createdAt, since))
        : gte(contactMessages.createdAt, since),
    );
  return row?.n ?? 0;
}

export const contactRouter = new Hono();

contactRouter.post(
  "/",
  zValidator("json", contactSchema, (result, c) => {
    if (!result.success) {
      return c.json({ ok: false, error: "invalid_input" }, 400);
    }
    return undefined;
  }),
  async (c) => {
    const body = c.req.valid("json");

    // A bot that fills the hidden field is told it worked, so it does not adapt.
    if (typeof body.website === "string" && body.website.length > 0) {
      return c.json({ ok: true });
    }

    if (!(await verifyTurnstile(body.turnstileToken, clientIp(c)))) {
      return c.json({ ok: false, error: "turnstile_failed" }, 403);
    }

    const ipHash = hashIp(clientIp(c));
    const now = Date.now();
    if (
      (await countSince(new Date(now - PER_IP_WINDOW_MS), ipHash)) >= PER_IP_LIMIT ||
      (await countSince(new Date(now - 24 * 60 * 60 * 1000))) >= dailyCap()
    ) {
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }

    const mailer = isMailerConfigured();
    const [stored] = await getDb()
      .insert(contactMessages)
      .values({
        name: body.name,
        email: body.email,
        message: body.message,
        locale: body.locale ?? null,
        ipHash,
        mailStatus: mailer ? "pending" : "skipped",
      })
      .returning({ id: contactMessages.id });

    if (!mailer) {
      console.warn("[contact] RESEND_API_KEY missing; message stored, email skipped");
    } else {
      const result = await sendContactEmail({
        name: body.name,
        email: body.email,
        message: body.message,
      });
      if (!result.ok) console.error("[contact] send failed:", result.error);
      await getDb()
        .update(contactMessages)
        .set(
          result.ok
            ? { mailStatus: "sent" }
            : { mailStatus: "failed", mailError: (result.error ?? "send_failed").slice(0, 500) },
        )
        .where(eq(contactMessages.id, stored!.id));
    }

    // Stored is what matters to the sender: the message is safe even when the
    // email could not go out, and it waits in the admin's inbox.
    return c.json({ ok: true });
  },
);

export async function pruneContactMessages(): Promise<void> {
  await getDb()
    .delete(contactMessages)
    .where(lt(contactMessages.createdAt, new Date(Date.now() - RETENTION_MS)));
}

let pruneTimer: NodeJS.Timeout | undefined;

export function startContactPruning(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(
    () => {
      void pruneContactMessages().catch((error) =>
        console.error("[contact] pruning messages failed", error),
      );
    },
    6 * 60 * 60 * 1000,
  );
  pruneTimer.unref?.();
}
