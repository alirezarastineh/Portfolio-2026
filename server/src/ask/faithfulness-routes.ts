import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import { aiMessages, aiRuns } from "../db/schema.js";
import { askConfig, askVisitorJudges } from "./deps.js";
import type { NightlyPick } from "./evals/calibration.js";
import { faithfulnessBy } from "./faithfulness.js";

/**
 * Overview → Faithfulness (plan phase 26), under
 * /admin/assistant/faithfulness (the admin router's auth applies): judged
 * faithfulness and helpfulness per model and per route over the window, the
 * random sample apart from all, the judge now and the judges of the rows, and
 * the last nightly run. No model call.
 */
export const faithfulnessRouter = new Hono();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each model that judged the rows, with how many, most first. */
function judgedBy(rows: readonly { judge: string }[]): { model: string; judged: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.judge, (counts.get(row.judge) ?? 0) + 1);
  return [...counts]
    .map(([model, judged]) => ({ model, judged }))
    .sort((a, b) => b.judged - a.judged || a.model.localeCompare(b.model));
}

const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

faithfulnessRouter.get(
  "/",
  zValidator("query", query, (result, c) =>
    result.success ? undefined : c.json({ error: "invalid_input" }, 400),
  ),
  async (c) => {
    const { days } = c.req.valid("query");
    const db = getDb();
    const rows = await db
      .select({
        model: aiMessages.model,
        route: aiMessages.route,
        faithfulness: sql<number>`(${aiMessages.judge} ->> 'faithfulness')::float8`,
        helpfulness: sql<number>`(${aiMessages.judge} ->> 'helpfulness')::float8`,
        pick: sql<NightlyPick | null>`${aiMessages.judge} ->> 'pick'`,
        judge: sql<string>`${aiMessages.judge} ->> 'model'`,
      })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.source, "terminal"),
          gte(aiMessages.createdAt, new Date(Date.now() - days * DAY_MS)),
          sql`${aiMessages.judge} ->> 'faithfulness' is not null`,
        ),
      );
    const [last] = await db
      .select({
        id: aiRuns.id,
        at: aiRuns.createdAt,
        status: aiRuns.status,
        progress: aiRuns.progress,
        usd: aiRuns.usd,
        error: aiRuns.error,
        day: sql<string | null>`${aiRuns.params} ->> 'day'`,
      })
      .from(aiRuns)
      .where(and(eq(aiRuns.kind, "judge"), sql`${aiRuns.params} ->> 'nightly' = 'true'`))
      .orderBy(desc(aiRuns.createdAt))
      .limit(1);
    return c.json({
      days,
      judge: askVisitorJudges(askConfig())[0]?.id ?? null,
      // Who judged the rows shown: a chain fails over, and the judge may have changed since.
      judges: judgedBy(rows),
      byModel: faithfulnessBy(rows, (r) => r.model ?? "none"),
      byRoute: faithfulnessBy(rows, (r) => r.route),
      nightly: last
        ? {
            id: last.id,
            at: last.at,
            day: last.day,
            status: last.status,
            judged: last.progress.done,
            total: last.progress.total,
            usd: last.usd,
            error: last.error,
          }
        : null,
    });
  },
);
