import { createHash } from "node:crypto";

import { and, eq, gte, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiFeedback, aiMessages } from "../db/schema.js";
import { captureError } from "../lib/sentry.js";
import { audit } from "./audit.js";
import { QUESTION_FLAGS } from "./checks.js";
import type { AskConfig } from "./config.js";
import { askConfig, askVisitorJudges } from "./deps.js";
import type { NightlyPick } from "./evals/calibration.js";
import { spendBlocked } from "./runs/budget.js";
import type { NightlyParams } from "./runs/judge-work.js";
import { startRun, whileStarting } from "./runs/runner.js";
import { activeRuns } from "./runs/store.js";

/**
 * The nightly sampled judge (plan phase 26), the book's Generator-Critic run
 * offline: each night, a run of kind `judge` over the previous UTC day's
 * visitor answers, a random sample plus every flagged one, each judged for
 * faithfulness against the documents it cited as its snapshot holds them, and
 * for helpfulness (`runs/judge-work.ts`). It spends as `nightlyJudge`: off
 * until the admin switches it on, with its own cap. The flagged picks feed
 * the review queue, never the trust monitor's demotions (a biased sample).
 */

export const NIGHTLY_RULES = {
  /** The random sample: this share of the day's answers… */
  share: 0.05,
  /** …and at least this many (all of them when fewer)… */
  minSample: 3,
  /** …with the flagged ones, at most this many answers a night, the sample first. */
  max: 40,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day before `now`, as "2026-10-06", with its bounds. */
export function previousDay(now: Date): { day: string; start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - DAY_MS);
  return { day: start.toISOString().slice(0, 10), start, end };
}

/** The random sample's size: 5 %, at least 3, never more than there are. */
export function sampleCount(total: number): number {
  return Math.min(total, Math.max(NIGHTLY_RULES.minSample, Math.ceil(total * NIGHTLY_RULES.share)));
}

export interface NightlyCandidate {
  id: string;
  /** An answer flag (a question flag says nothing about the answer), or a thumbs-down. */
  flagged: boolean;
}

/** The review queue's way: a hash of the day and the id, so a day always draws the same. */
const rank = (day: string, id: string) => createHash("sha256").update(`${day}:${id}`).digest("hex");

/** The night's picks: the random sample, then the flagged answers it did not draw; at most 40. */
export function pickNightly(
  day: string,
  candidates: readonly NightlyCandidate[],
): { id: string; pick: NightlyPick }[] {
  const ordered = [...candidates].sort((a, b) => rank(day, a.id).localeCompare(rank(day, b.id)));
  const sample = ordered.slice(0, sampleCount(ordered.length));
  const drawn = new Set(sample.map((c) => c.id));
  return [
    ...sample.map((c) => ({ id: c.id, pick: "sample" as const })),
    ...ordered
      .filter((c) => c.flagged && !drawn.has(c.id))
      .map((c) => ({ id: c.id, pick: "flagged" as const })),
  ].slice(0, NIGHTLY_RULES.max);
}

/** Whether an answer's flags or its feedback flag it. */
export function isFlagged(flags: readonly string[], thumbsDown: boolean): boolean {
  return thumbsDown || flags.some((f) => !(QUESTION_FLAGS as readonly string[]).includes(f));
}

/**
 * The day's visitor answers worth judging: answered, with text, and not
 * judged yet. A verdict already there (a calibration run's, by whichever
 * model of the judge chain answered) is never written over.
 */
async function candidates(bounds: { start: Date; end: Date }): Promise<NightlyCandidate[]> {
  const rows = await getDb()
    .select({
      id: aiMessages.id,
      flags: sql<string[]>`coalesce(${aiMessages.checks} -> 'flags', '[]'::jsonb)`,
      down: sql<boolean>`coalesce(${aiFeedback.value} = -1, false)`,
    })
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(
      and(
        eq(aiMessages.source, "terminal"),
        gte(aiMessages.createdAt, bounds.start),
        lt(aiMessages.createdAt, bounds.end),
        sql`${aiMessages.answerExcerpt} <> ''`,
        sql`not (${aiMessages.finishReason} like 'error%' or ${aiMessages.finishReason} = 'aborted')`,
        sql`${aiMessages.judge} is null`,
      ),
    );
  return rows.map((row) => ({ id: row.id, flagged: isFlagged(row.flags, row.down) }));
}

/** Why a night did not run, in words: the audit row says it. */
const REFUSED: Record<string, string> = {
  feature_off: "the nightly judge is switched off",
  cap_reached: "the nightly judge reached its cap",
  reserve_reached: "today's spend reached the share kept for visitors",
  assistant_resting: "today's budget is spent",
  assistant_off: "the assistant is off",
  no_visitor_judge: "no judge may read visitor answers (SERVER_AI_JUDGE_MODELS)",
  nothing_to_judge: "no visitor answers to judge that day",
  already_running: "another paid run is going",
};

export type NightlyStart = { run: string; picks: number } | { refused: string };

/**
 * Starts the night's run, or says why not (audited `judge.nightly`): the
 * fences of `nightlyJudge`, a judge that may read visitor answers, answers to
 * judge, and the one paid run at a time.
 */
export async function startNightly(
  config: AskConfig = askConfig(),
  now = new Date(),
): Promise<NightlyStart> {
  const bounds = previousDay(now);
  const refuse = async (code: string): Promise<NightlyStart> => {
    await audit({
      actor: "system",
      action: "judge.nightly",
      target: bounds.day,
      decision: "denied",
      reason: REFUSED[code] ?? code,
    });
    return { refused: code };
  };

  const blocked = await spendBlocked("nightlyJudge");
  if (blocked) return refuse(blocked);
  const judge = askVisitorJudges(config)[0]?.id;
  if (!judge) return refuse("no_visitor_judge");
  const picks = pickNightly(bounds.day, await candidates(bounds));
  if (!picks.length) return refuse("nothing_to_judge");

  const params: NightlyParams = { nightly: true, day: bounds.day, judge, picks };
  const started = await whileStarting(async () => {
    // One paid run at a time, whatever its kind: they share the providers' quota.
    if ((await activeRuns()).length) return null;
    return startRun(
      "judge",
      { ...params },
      picks.map((p) => p.id),
    );
  });
  if (started === "busy" || !started) return refuse("already_running");

  const sampled = picks.filter((p) => p.pick === "sample").length;
  await audit({
    actor: "system",
    action: "judge.nightly",
    target: started.id,
    decision: "allowed",
    reason: `${picks.length} answers of ${bounds.day} to judge: ${sampled} sampled, ${picks.length - sampled} flagged`,
  });
  return { run: started.id, picks: picks.length };
}

let timer: NodeJS.Timeout | undefined;

/** The next 02:30 UTC after `now`: before the trust check (03:00), which reads the verdicts. */
export function nextNightlyJudgeAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(2, 30, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Nightly at 02:30 UTC. Started only where migrations ran, so a laptop on the
 * tunnel never writes to the shared database; skipped while the deploy has
 * the assistant off. The start and the config can be swapped in tests.
 */
export function startNightlyJudge(
  options: {
    now?: Date;
    start?: (config: AskConfig) => Promise<unknown>;
    config?: () => AskConfig;
  } = {},
): void {
  if (timer) return;
  const { now = new Date(), start = startNightly, config: read = askConfig } = options;
  const tick = () => {
    const config = read();
    if (config.enabled && !config.unavailableReason) {
      void start(config).catch((error: unknown) => {
        console.error("[judge] nightly start failed", error);
        captureError(error, { phase: "nightly-judge" });
      });
    }
    timer = setTimeout(tick, DAY_MS);
    timer.unref?.();
  };
  timer = setTimeout(tick, nextNightlyJudgeAt(now).getTime() - now.getTime());
  timer.unref?.();
}

/** Stops the nightly judge's timer (a run under way goes on). */
export function stopNightlyJudge(): void {
  clearTimeout(timer);
  timer = undefined;
}
