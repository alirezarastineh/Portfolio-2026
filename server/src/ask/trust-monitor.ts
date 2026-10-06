import { and, desc, eq, gt, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";

import type { DbExecutor } from "../content/build.js";
import { getDb } from "../db/client.js";
import { aiAudit, aiMessages } from "../db/schema.js";
import { captureError } from "../lib/sentry.js";
import {
  audit,
  invalidateTrustCache,
  lastReinstated,
  notifyAlert,
  readDemotions,
} from "./audit.js";
import type { AskConfig } from "./config.js";
import { askChain, askConfig } from "./deps.js";
import { ESCALATED_ROUTE } from "./router.js";
import {
  DEEP_ROUTE,
  errorRateVerdict,
  faithfulnessVerdict,
  modelSubject,
  TRUST_RULES,
  type Verdict,
} from "./trust.js";

/**
 * The trust lifecycle's monitor → demote step (plan phase 14). Nightly, and
 * when the admin asks: every chat model's judged faithfulness and the deep
 * route's failures, each on its evidence since it was last reinstated. A
 * subject that falls below its rule is demoted (an audit row with an alert);
 * visitors stop getting it (route.ts) until the admin reinstates it. A
 * demotion that would leave a chain with no model is refused instead. Every
 * run writes one `trust.check` row with each verdict, kept or not: what was
 * considered but rejected. No model calls.
 */

/** After the runs' locks (8_741_210 + kind): one check at a time, across processes. */
const CHECK_LOCK = 8_741_220;

export interface TrustCheck {
  verdicts: Verdict[];
  /** Subjects demoted by this check. */
  demoted: string[];
  /** Demotions refused, because they would leave a chain with no model. */
  refused: string[];
}

/** A chat model's judged faithfulness on visitor answers, newest first. */
async function judgedScores(db: DbExecutor, model: string, since?: Date): Promise<number[]> {
  const faithfulness = sql<number>`(${aiMessages.judge} ->> 'faithfulness')::float8`;
  const conditions: SQL[] = [
    eq(aiMessages.source, "terminal"),
    eq(aiMessages.model, model),
    isNotNull(sql`${aiMessages.judge} ->> 'faithfulness'`),
  ];
  if (since) conditions.push(gt(aiMessages.createdAt, since));
  const rows = await db
    .select({ score: faithfulness })
    .from(aiMessages)
    .where(and(...conditions))
    .orderBy(desc(aiMessages.createdAt))
    .limit(TRUST_RULES.judgedWindow);
  return rows.map((row) => row.score);
}

/**
 * How the deep route's visitor answers ended, newest first, those that moved
 * up to it mid-way included (plan phase 20); an aborted one says nothing.
 */
async function deepEndings(db: DbExecutor, since?: Date): Promise<string[]> {
  const conditions: SQL[] = [
    eq(aiMessages.source, "terminal"),
    inArray(aiMessages.route, ["deep", ESCALATED_ROUTE]),
    ne(aiMessages.finishReason, "aborted"),
  ];
  if (since) conditions.push(gt(aiMessages.createdAt, since));
  const rows = await db
    .select({ finishReason: aiMessages.finishReason })
    .from(aiMessages)
    .where(and(...conditions))
    .orderBy(desc(aiMessages.createdAt))
    .limit(TRUST_RULES.deepWindow);
  return rows.map((row) => row.finishReason);
}

/** How long a refused demotion stays alerted before the same refusal alerts again. */
const REFUSAL_QUIET_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether `subject`'s demotion was refused, and alerted, within the quiet period. */
async function refusedLately(db: DbExecutor, subject: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiAudit.id })
    .from(aiAudit)
    .where(
      and(
        eq(aiAudit.action, "demote"),
        eq(aiAudit.target, subject),
        eq(aiAudit.decision, "denied"),
        gt(aiAudit.at, new Date(Date.now() - REFUSAL_QUIET_MS)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The chain a demotion of `id` would leave with no model, or null. */
function emptiedChain(config: AskConfig, id: string, demoted: ReadonlySet<string>): string | null {
  for (const role of ["lite", "deep"] as const) {
    const chain = askChain(config, role);
    if (!chain.some((e) => e.id === id)) continue;
    const left = chain.filter((e) => e.id !== id && !demoted.has(modelSubject(e.id)));
    if (!left.length) return role;
  }
  return null;
}

/**
 * One check, or null when another process is checking right now. Its rows
 * are written in one transaction; the alerts go out once it has committed.
 */
export async function runTrustCheck(config: AskConfig = askConfig()): Promise<TrustCheck | null> {
  const outcome = await getDb().transaction(async (tx) => {
    const { rows } = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${CHECK_LOCK}) as locked`,
    );
    if (!rows[0]?.locked) return null;

    const demoted = new Set((await readDemotions(tx)).map((d) => d.subject));
    const since = await lastReinstated(tx);
    const models = [
      ...new Set([...askChain(config, "lite"), ...askChain(config, "deep")].map((e) => e.id)),
    ];
    const activeModels = models
      .map((id) => ({ id, subject: modelSubject(id) }))
      .filter(({ subject }) => !demoted.has(subject));

    const modelVerdicts = await Promise.all(
      activeModels.map(async ({ id, subject }) =>
        faithfulnessVerdict(subject, await judgedScores(tx, id, since.get(subject))),
      ),
    );
    const verdicts: Verdict[] = [...modelVerdicts];
    if (!demoted.has(DEEP_ROUTE)) {
      verdicts.push(errorRateVerdict(DEEP_ROUTE, await deepEndings(tx, since.get(DEEP_ROUTE))));
    }

    const check: TrustCheck = { verdicts, demoted: [], refused: [] };
    const toRefuse: { subject: string; emptied: string; evidence: string }[] = [];
    const toDemote: { subject: string; evidence: string }[] = [];

    for (const verdict of verdicts.filter((v) => v.verdict === "demote")) {
      const model = verdict.subject.startsWith("model:") ? verdict.subject.slice(6) : null;
      const emptied = model ? emptiedChain(config, model, demoted) : null;
      if (emptied) {
        check.refused.push(verdict.subject);
        toRefuse.push({ subject: verdict.subject, emptied, evidence: verdict.evidence });
      } else {
        demoted.add(verdict.subject);
        check.demoted.push(verdict.subject);
        toDemote.push({ subject: verdict.subject, evidence: verdict.evidence });
      }
    }

    const unquietRefusals = (
      await Promise.all(
        toRefuse.map(async (r) => ({
          ...r,
          alreadyAlerted: await refusedLately(tx, r.subject),
        })),
      )
    ).filter((r) => !r.alreadyAlerted);

    const alerts = await Promise.all([
      ...unquietRefusals.map((r) =>
        audit(
          {
            actor: "system",
            action: "demote",
            target: r.subject,
            decision: "denied",
            reason: `${r.evidence}; it is the last model of the ${r.emptied} chain`,
            alternatives: [{ option: "demote", why: "visitors would get no answer at all" }],
            alert: true,
          },
          tx,
        ),
      ),
      ...toDemote.map((d) =>
        audit(
          {
            actor: "system",
            action: "demote",
            target: d.subject,
            decision: "allowed",
            reason: d.evidence,
            alternatives: [{ option: "keep", why: "below its rule" }],
            alert: true,
          },
          tx,
        ),
      ),
    ]);
    await audit(
      {
        actor: "system",
        action: "trust.check",
        target: "trust",
        decision: "allowed",
        reason: `${verdicts.length} checked, ${check.demoted.length} demoted, ${check.refused.length} refused`,
        alternatives: verdicts.map((v) => ({
          option: `demote ${v.subject}`,
          why: `${v.verdict}: ${v.evidence}`,
        })),
      },
      tx,
    );
    return { check, alerts };
  });
  invalidateTrustCache();
  if (!outcome) return null;
  for (const row of outcome.alerts) notifyAlert(row);
  return outcome.check;
}

const DAY_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | undefined;

/** The next 03:00 UTC after `now`. */
export function nextCheckAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Nightly at 03:00 UTC. Started only where migrations ran, so a laptop on the
 * tunnel never writes to the shared database; skipped while the deploy has
 * the assistant off. The check and the config can be swapped in tests.
 */
export function startTrustMonitor(
  options: {
    now?: Date;
    check?: (config: AskConfig) => Promise<unknown>;
    config?: () => AskConfig;
  } = {},
): void {
  if (timer) return;
  const { now = new Date(), check = runTrustCheck, config: read = askConfig } = options;
  const tick = () => {
    const config = read();
    if (config.enabled && !config.unavailableReason) {
      void check(config).catch((error: unknown) => {
        console.error("[trust] check failed", error);
        captureError(error, { phase: "trust-check" });
      });
    }
    timer = setTimeout(tick, DAY_MS);
    timer.unref?.();
  };
  timer = setTimeout(tick, nextCheckAt(now).getTime() - now.getTime());
  timer.unref?.();
}

/** Stops the nightly check (tests, and nothing else, start it twice). */
export function stopTrustMonitor(): void {
  clearTimeout(timer);
  timer = undefined;
}
