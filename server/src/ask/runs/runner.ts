import type pg from "pg";

import { getPool } from "../../db/client.js";
import {
  activeRuns,
  createRun,
  endRun,
  finishItem,
  reopenRun,
  RUN_KINDS,
  startItem,
  unfinishedKeys,
  type ItemStatus,
  type RunKind,
  type RunRow,
} from "./store.js";

/**
 * Runs long, paid work (an eval suite today; the pairwise judge, the nightly
 * judge and the content agent later) in the background, one run per kind at
 * a time. The work checkpoints item by item (store.ts); a cancel stops it
 * between items and aborts the one in flight; a run that a restart cut off is
 * found at boot and can be resumed without redoing finished items.
 *
 * A worker holds a session-level advisory lock for its kind for the whole
 * run. That lock is how boot tells a dead run from a live one in another
 * process: only a run whose lock anyone can take is marked interrupted.
 */

/** What a kind's work gets: the keys still to do, and how to report each one. */
export interface RunWork {
  run: RunRow;
  keys: string[];
  signal: AbortSignal;
  startItem(key: string): Promise<void>;
  finishItem(
    key: string,
    outcome: { status: ItemStatus; result?: unknown; usd?: number },
  ): Promise<void>;
}

/** How a kind's work ended; `summary` is stored on the run. */
export type WorkOutcome =
  { status: "done"; summary?: unknown } | { status: "failed"; error: string; summary?: unknown };

export type WorkFn = (work: RunWork) => Promise<WorkOutcome>;

/** After the migration (8_741_203) and publish (8_741_204) locks: one per kind. */
const LOCK_BASE = 8_741_210;
/** The advisory lock a kind's worker holds for the whole run. */
export const runLockId = (kind: RunKind) => LOCK_BASE + RUN_KINDS.indexOf(kind);

const workers = new Map<RunKind, WorkFn>();
const inFlight = new Map<string, AbortController>();
/**
 * Paid work begins one thing at a time in this process. The old one-request
 * eval route (admin.ts, kept for the previous admin during a deploy) and the
 * start or resume of a run of any kind each claim the slot synchronously,
 * before their first await. A start holds it until its run's row exists, and
 * from then on every starter sees that row and refuses. So no two paid runs
 * go at once, whatever order their requests arrive in.
 */
let requestEval = false;
let starting = false;

export function registerWork(kind: RunKind, work: WorkFn): void {
  workers.set(kind, work);
}

export function runInFlight(id: string): boolean {
  return inFlight.has(id);
}

/** The old route's side: false while it runs already or a run is being started. */
export function claimRequestEval(): boolean {
  if (requestEval || starting) return false;
  requestEval = true;
  return true;
}

export function releaseRequestEval(): void {
  requestEval = false;
}

/**
 * A run's side: `start` (the checks, then writing the run's row) runs alone,
 * or not at all ("busy") while the old route or another start holds the slot.
 */
export async function whileStarting<T>(start: () => Promise<T>): Promise<T | "busy"> {
  if (requestEval || starting) return "busy";
  starting = true;
  try {
    return await start();
  } finally {
    starting = false;
  }
}

async function tryLock(client: pg.PoolClient, kind: RunKind): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [
    runLockId(kind),
  ]);
  return rows[0]?.ok === true;
}

async function execute(run: RunRow, controller: AbortController): Promise<void> {
  const kind = run.kind as RunKind;
  const work = workers.get(kind);
  const client = await getPool().connect();
  let locked = false;
  let broken = false;
  try {
    locked = await tryLock(client, kind);
    if (!locked) {
      await endRun(run.id, "failed", { error: "another worker holds this kind's lock" });
      return;
    }
    if (!work) {
      await endRun(run.id, "failed", { error: `no work registered for ${kind}` });
      return;
    }
    console.log(`[runs] ${kind} run ${run.id} started`);
    const outcome = await work({
      run,
      keys: await unfinishedKeys(run.id),
      signal: controller.signal,
      startItem: (key) => startItem(run.id, key),
      finishItem: (key, result) => finishItem(run.id, key, result),
    });
    if (controller.signal.aborted) {
      const shutdown = String(controller.signal.reason?.message ?? "") === "shutdown";
      await endRun(run.id, shutdown ? "interrupted" : "cancelled", { summary: outcome.summary });
    } else if (outcome.status === "done") {
      await endRun(run.id, "done", { summary: outcome.summary });
    } else {
      await endRun(run.id, "failed", { summary: outcome.summary, error: outcome.error });
    }
    console.log(`[runs] ${kind} run ${run.id} ended`);
  } catch (error) {
    console.error(`[runs] ${kind} run ${run.id} failed`, error);
    await endRun(run.id, "failed", {
      error: (error as Error).message?.slice(0, 500) ?? "error",
    }).catch(() => undefined);
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [runLockId(kind)]).catch(() => {
        broken = true; // closing the connection releases the lock anyway
      });
    }
    client.release(broken);
  }
}

function launch(run: RunRow): void {
  const controller = new AbortController();
  inFlight.set(run.id, controller);
  void execute(run, controller).finally(() => inFlight.delete(run.id));
}

/** Starts a run of `kind` over `keys`; null when one of the kind is already active. */
export async function startRun(
  kind: RunKind,
  params: Record<string, unknown>,
  keys: string[],
): Promise<RunRow | null> {
  const run = await createRun(kind, params, keys);
  if (run) launch(run);
  return run;
}

/** Continues an interrupted, failed or cancelled run from where it stopped. */
export async function resumeRun(id: string): Promise<RunRow | null> {
  if (inFlight.has(id)) return null;
  const run = await reopenRun(id);
  if (run) launch(run);
  return run;
}

/** Stops a run in this process (the worker records it), or marks a stopped one cancelled. */
export async function cancelRun(id: string, status: RunRow["status"]): Promise<boolean> {
  const controller = inFlight.get(id);
  if (controller) {
    controller.abort(new Error("cancelled"));
    return true;
  }
  if (status === "interrupted" || status === "failed") {
    await endRun(id, "cancelled");
    return true;
  }
  return false;
}

async function recoverRun(run: RunRow): Promise<boolean> {
  if (inFlight.has(run.id)) return false;
  const client = await getPool().connect();
  let broken = false;
  try {
    if (await tryLock(client, run.kind as RunKind)) {
      try {
        await endRun(run.id, "interrupted");
        return true;
      } finally {
        await client
          .query("SELECT pg_advisory_unlock($1)", [runLockId(run.kind as RunKind)])
          .catch(() => {
            broken = true;
          });
      }
    }
    return false;
  } finally {
    client.release(broken);
  }
}

/**
 * At boot: a queued or running run whose kind lock anyone can take has no
 * live worker (the process that ran it is gone), so it is interrupted.
 */
export async function recoverRuns(): Promise<number> {
  const runs = await activeRuns();
  const results = await Promise.all(runs.map((run) => recoverRun(run)));
  const recovered = results.filter(Boolean).length;
  if (recovered) console.log(`[runs] ${recovered} interrupted run(s) can be resumed`);
  return recovered;
}

/** On shutdown: stop every run here; each ends as interrupted, resumable after the restart. */
export function abortAllRuns(): void {
  for (const controller of inFlight.values()) controller.abort(new Error("shutdown"));
}
