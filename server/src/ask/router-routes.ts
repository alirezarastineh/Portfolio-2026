import { zValidator } from "@hono/zod-validator";
import { and, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import { aiFeedback, aiMessages } from "../db/schema.js";
import { OUTCOME_COLUMNS } from "./outcome-rows.js";
import { routerReport, type RouterRow } from "./router-report.js";

/**
 * The router's report (plan phase 20) under /admin/assistant/router (the
 * admin router's auth applies): a window of visitor answers by route tier,
 * the false-simple rate with its candidates, escalations and careful topics.
 * Read-only; no model call.
 */
export const routerReportRouter = new Hono();

const DAY_MS = 24 * 60 * 60 * 1000;

routerReportRouter.get(
  "/",
  zValidator(
    "query",
    z.object({ days: z.coerce.number().int().min(1).max(90).optional() }),
    (result, c) => (result.success ? undefined : c.json({ error: "invalid_input" }, 400)),
  ),
  async (c) => {
    // A week by default: the plan's weekly report, on demand.
    const days = c.req.valid("query").days ?? 7;
    const rows = await getDb()
      .select({
        ...OUTCOME_COLUMNS,
        route: aiMessages.route,
        ttftMs: aiMessages.ttftMs,
        trace: aiMessages.trace,
      })
      .from(aiMessages)
      .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
      .where(
        and(
          eq(aiMessages.source, "terminal"),
          gte(aiMessages.createdAt, new Date(Date.now() - days * DAY_MS)),
        ),
      );
    const report = routerReport(
      rows.map(({ trace, ...row }): RouterRow => ({
        ...row,
        routing: trace?.routing ?? null,
        escalation: trace?.escalation?.reason ?? null,
      })),
    );
    return c.json({ days, ...report });
  },
);
