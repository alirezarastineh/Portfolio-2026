import { zValidator } from "@hono/zod-validator";
import { desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import { contactMessages } from "../db/schema.js";

const STATUSES = ["new", "read", "archived", "spam"] as const;

/**
 * The contact inbox. Messages are stored before any email is attempted, so
 * this is the place to see ones whose email failed (`mailStatus: "failed"`).
 * Mounted under /admin, which supplies auth and CSRF.
 */
export const adminMessagesRouter = new Hono();

adminMessagesRouter.get("/messages", async (c) => {
  const status = c.req.query("status");
  const filter = STATUSES.includes(status as (typeof STATUSES)[number])
    ? eq(contactMessages.status, status as (typeof STATUSES)[number])
    : // By default everything that is still worth seeing.
      ne(contactMessages.status, "archived");

  const messages = await getDb()
    .select({
      id: contactMessages.id,
      createdAt: contactMessages.createdAt,
      locale: contactMessages.locale,
      name: contactMessages.name,
      email: contactMessages.email,
      message: contactMessages.message,
      status: contactMessages.status,
      mailStatus: contactMessages.mailStatus,
      mailError: contactMessages.mailError,
    })
    .from(contactMessages)
    .where(filter)
    .orderBy(desc(contactMessages.createdAt))
    .limit(200);

  return c.json({ messages });
});

adminMessagesRouter.patch(
  "/messages/:id",
  zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
    result.success ? undefined : c.json({ error: "invalid_id" }, 400),
  ),
  zValidator("json", z.object({ status: z.enum(STATUSES) }), (result, c) =>
    result.success ? undefined : c.json({ error: "invalid_input" }, 400),
  ),
  async (c) => {
    const [row] = await getDb()
      .update(contactMessages)
      .set({ status: c.req.valid("json").status })
      .where(eq(contactMessages.id, c.req.valid("param").id))
      .returning({ id: contactMessages.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);
