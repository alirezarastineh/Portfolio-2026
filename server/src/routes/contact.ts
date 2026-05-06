import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { isMailerConfigured, sendContactEmail } from "../lib/mailer.js";
import { tooManyRequests } from "../lib/rate-limit.js";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  message: z.string().trim().min(10).max(4000),
  website: z.string().max(200).optional(),
});

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

    if (typeof body.website === "string" && body.website.length > 0) {
      return c.json({ ok: true });
    }

    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    if (tooManyRequests(ip, 5, 10 * 60 * 1000)) {
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }

    if (!isMailerConfigured()) {
      console.warn("[contact] RESEND_API_KEY missing; submission dropped");
      return c.json({ ok: false, error: "mailer_unavailable" }, 503);
    }

    const result = await sendContactEmail({
      name: body.name,
      email: body.email,
      message: body.message,
    });

    if (!result.ok) {
      console.error("[contact] send failed:", result.error);
      return c.json({ ok: false, error: "send_failed" }, 502);
    }

    return c.json({ ok: true });
  },
);
