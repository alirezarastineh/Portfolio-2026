import { and, desc, eq, sql } from "drizzle-orm";

import { getDb, getPool } from "../db/client.js";
import { aiAudit, aiFeedback, aiLessons, aiMessages } from "../db/schema.js";
import { captureError } from "../lib/sentry.js";
import { audit, type AuditAlternative } from "./audit.js";
import type { AskConfig } from "./config.js";
import { askConfig } from "./deps.js";
import { pruneInsightSnapshots, runInsights } from "./insights.js";
import {
  evictionReason,
  failed,
  lessonEffect,
  triggerVerdict,
  type TriggerVerdict,
} from "./lessons.js";
import { OUTCOME_COLUMNS } from "./outcome-rows.js";
import { rephrased, type OutcomeRow } from "./outcomes.js";

/**
 * The nightly learning check (plan phase 25), after the trust check: the
 * adaptive trigger (insights run on their own when failures rise, if the
 * admin switched `autoInsights` on), and every applied lesson measured on
 * the answers since its fix, a failing one retired. One audit row says what
 * it looked at and what it did, the considered-but-rejected record. It reads
 * stored answers only; the one model call is the insights run. The same
 * nightly tick prunes the insights runs (they quote visitors' questions),
 * whatever the assistant's state.
 */

const LOCK = 8_741_221;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Why insights did not run, in words: the audit row and the Insights tab say it. */
const NOT_RUN: Record<string, string> = {
  feature_off: "automatic insights are switched off",
  cap_reached: "automatic insights reached their cap",
  reserve_reached: "today's spend reached the share kept for visitors",
  assistant_resting: "today's budget is spent",
  assistant_off: "the assistant is off",
  unavailable: "no model answered",
};

export interface LearningCheck {
  trigger: TriggerVerdict & {
    /** Insights ran, and the snapshot they left. */
    ran: boolean;
    snapshot: string | null;
    /** Why a trigger that fired did not run them (switched off, a cap, the reserve, an outage). */
    skipped: string | null;
  };
  lessons: { measured: number; retired: string[] };
}

/** The visitor answers kept (90 days), newest first, as the outcomes read them. */
async function keptAnswers(): Promise<OutcomeRow[]> {
  return getDb()
    .select(OUTCOME_COLUMNS)
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(eq(aiMessages.source, "terminal"))
    .orderBy(desc(aiMessages.createdAt));
}

/** Answers newer than the newest one the last insights read; compared in SQL. */
async function newSinceInsights(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.source, "terminal"),
        sql`${aiMessages.createdAt} > coalesce((select newest_at from ai_insight_snapshots order by created_at desc limit 1), '-infinity'::timestamptz)`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * One applied lesson's effect, stored; below the floor, retired (audited).
 * The row is locked while it is measured, as the admin's PATCH locks it while
 * deciding: an apply, a scope edit or a retirement in between is measured the
 * next night, never written over. True when retired.
 */
async function measureLesson(id: string, rows: readonly OutcomeRow[], now: Date): Promise<boolean> {
  const reason = await getDb().transaction(async (tx) => {
    const [lesson] = await tx.select().from(aiLessons).where(eq(aiLessons.id, id)).for("update");
    if (lesson?.status !== "active" || !lesson.appliedAt) return null;
    const effect = lessonEffect(rows, lesson.scope, lesson.appliedAt, now, lesson.reopenedAt);
    const why = evictionReason(effect);
    await tx
      .update(aiLessons)
      .set({
        effectiveness: effect,
        ...(why
          ? { status: "retired", retiredReason: why, decidedBy: "system", decidedAt: now }
          : {}),
        updatedAt: now,
      })
      .where(eq(aiLessons.id, id));
    return why;
  });
  if (!reason) return false;
  await audit({
    actor: "system",
    action: "lesson.retire",
    target: id,
    decision: "allowed",
    reason,
  });
  return true;
}

/** Every applied lesson's effect, stored; one below the floor retired. */
async function measureLessons(
  rows: readonly OutcomeRow[],
  now: Date,
): Promise<LearningCheck["lessons"]> {
  const active = await getDb()
    .select({ id: aiLessons.id })
    .from(aiLessons)
    .where(eq(aiLessons.status, "active"));
  const retired = await Promise.all(active.map((lesson) => measureLesson(lesson.id, rows, now)));
  return { measured: active.length, retired: active.filter((_, i) => retired[i]).map((l) => l.id) };
}

/** What the trigger did, in words. */
function triggerWords(verdict: TriggerVerdict, ran: boolean, skipped: string | null): string {
  if (!verdict.fire) return `the trigger held: ${verdict.reason}`;
  if (ran) return `the trigger fired and insights ran (${verdict.reason})`;
  const why = skipped ? (NOT_RUN[skipped] ?? skipped) : "nothing to read";
  return `the trigger fired and insights did not run: ${why} (${verdict.reason})`;
}

async function check(config: AskConfig, now: Date): Promise<LearningCheck> {
  const rows = await keptAnswers();
  const again = rephrased(rows);
  const verdict = triggerVerdict(
    rows.map((row) => failed(row, again)),
    await newSinceInsights(),
  );
  let ran = false;
  let snapshot: string | null = null;
  let skipped: string | null = null;
  if (verdict.fire) {
    // Fenced as `autoInsights`: off until the admin switches it on, and its own cap.
    const result = await runInsights(config, "auto", verdict.reason);
    if (!result.ok) skipped = result.error;
    else {
      ran = !!result.snapshot;
      snapshot = result.snapshot?.id ?? null;
    }
  }
  const lessons = await measureLessons(rows, now);

  const trigger = triggerWords(verdict, ran, skipped);
  const alternatives: AuditAlternative[] = [
    { option: "run insights", why: trigger },
    ...lessons.retired.map((id) => ({ option: `keep lesson ${id}`, why: "below the floor" })),
  ];
  await audit({
    actor: "system",
    action: "learning.check",
    target: "learning",
    decision: verdict.fire && !ran ? "denied" : "allowed",
    reason: `${trigger}; ${lessons.measured} ${lessons.measured === 1 ? "lesson" : "lessons"} measured, ${lessons.retired.length} retired`,
    alternatives,
  });
  return { trigger: { ...verdict, ran, snapshot, skipped }, lessons };
}

/**
 * One check, or null when another process is checking. A session-level lock
 * on its own connection, held through the insights call, so a deploy's two
 * processes never both spend on the same rise.
 */
export async function runLearningCheck(
  config: AskConfig = askConfig(),
  now = new Date(),
): Promise<LearningCheck | null> {
  const client = await getPool().connect();
  let locked = false;
  let broken = false;
  try {
    const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [
      LOCK,
    ]);
    locked = rows[0]?.ok === true;
    if (!locked) return null;
    return await check(config, now);
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => {
        broken = true; // closing the connection releases the lock anyway
      });
    }
    client.release(broken);
  }
}

/** The last check's verdict on the trigger, for the Insights tab. */
export async function lastLearningCheck() {
  const [row] = await getDb()
    .select({ at: aiAudit.at, decision: aiAudit.decision, reason: aiAudit.reason })
    .from(aiAudit)
    .where(eq(aiAudit.action, "learning.check"))
    .orderBy(desc(aiAudit.at))
    .limit(1);
  return row ?? null;
}

let timer: NodeJS.Timeout | undefined;

/** The next 03:30 UTC after `now`: after the trust check, which reads the judge's verdicts. */
export function nextLearningCheckAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(3, 30, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Nightly at 03:30 UTC. Started only where migrations ran, so a laptop on the
 * tunnel never writes to the shared database. The check is skipped while the
 * deploy has the assistant off; the insights runs are pruned either way. The
 * check, the prune and the config can be swapped in tests.
 */
export function startLearningMonitor(
  options: {
    now?: Date;
    check?: (config: AskConfig) => Promise<unknown>;
    prune?: () => Promise<void>;
    config?: () => AskConfig;
  } = {},
): void {
  if (timer) return;
  const {
    now = new Date(),
    check: run = runLearningCheck,
    prune = pruneInsightSnapshots,
    config: read = askConfig,
  } = options;
  const tick = () => {
    void prune().catch((error: unknown) => {
      console.error("[learning] pruning insights runs failed", error);
      captureError(error, { phase: "insights-prune" });
    });
    const config = read();
    if (config.enabled && !config.unavailableReason) {
      void run(config).catch((error: unknown) => {
        console.error("[learning] check failed", error);
        captureError(error, { phase: "learning-check" });
      });
    }
    timer = setTimeout(tick, DAY_MS);
    timer.unref?.();
  };
  timer = setTimeout(tick, nextLearningCheckAt(now).getTime() - now.getTime());
  timer.unref?.();
}

/** Stops the nightly check. */
export function stopLearningMonitor(): void {
  clearTimeout(timer);
  timer = undefined;
}
