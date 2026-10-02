import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import {
  audit,
  invalidateTrustCache,
  lastCheck,
  markSeen,
  openAlerts,
  readDemotions,
  recentAudit,
} from "./audit.js";
import { askOnTunnel } from "./deps.js";
import { runTrustCheck } from "./trust-monitor.js";
import { TRUST_REGISTRY, TRUST_RULES } from "./trust.js";

/**
 * The admin's view of trust (plan phase 14), under /admin/assistant/trust (the
 * admin router's auth and CSRF apply): who may do what, what is demoted, the
 * open alerts and the audit log; a check on demand, a reinstatement, an alert
 * marked seen.
 */
export const trustRouter = new Hono();

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

trustRouter.get("/", async (c) => {
  const [demoted, alerts, log, check] = await Promise.all([
    readDemotions(),
    openAlerts(),
    recentAudit(100),
    lastCheck(),
  ]);
  return c.json({
    registry: TRUST_REGISTRY,
    rules: TRUST_RULES,
    demoted,
    alerts,
    audit: log,
    lastCheck: check,
  });
});

/**
 * The nightly check, now. It reads stored judgments and endings: no model
 * calls. Like the nightly one, never from a laptop on the production tunnel.
 */
trustRouter.post("/check", async (c) => {
  if (askOnTunnel()) return c.json({ error: "remote_database" }, 409);
  const check = await runTrustCheck();
  if (!check) return c.json({ error: "already_checking" }, 409);
  return c.json({
    checked: check.verdicts.length,
    demoted: check.demoted,
    refused: check.refused,
  });
});

/** Back in service: only the admin reinstates, and evidence from before no longer counts. */
trustRouter.post(
  "/reinstate",
  zValidator("json", z.object({ subject: z.string().min(1).max(200) }), invalid),
  async (c) => {
    const { subject } = c.req.valid("json");
    if (!(await readDemotions()).some((d) => d.subject === subject)) {
      return c.json({ error: "not_demoted" }, 404);
    }
    await audit({
      actor: "admin",
      action: "reinstate",
      target: subject,
      decision: "allowed",
      reason: "reinstated by the admin",
    });
    invalidateTrustCache();
    return c.json({ ok: true });
  },
);

trustRouter.post(
  "/alerts/:id/seen",
  zValidator("param", z.object({ id: z.coerce.number().int().positive() }), (result, c) =>
    result.success ? undefined : c.json({ error: "invalid_id" }, 400),
  ),
  async (c) => {
    if (!(await markSeen(c.req.valid("param").id))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);
