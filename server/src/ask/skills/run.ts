import { type FinishReason, generateText, type LanguageModel, type ModelMessage, Output } from "ai";

import { combineOrders, type PairChoice } from "../evals/pairwise.js";
import {
  criticPrompt,
  criticSchema,
  JUDGE_CALL,
  MAX_DRAFTS,
  pairPrompt,
  pairSchema,
  rankInstructions,
  rankOf,
  repairNote,
  revisionNote,
  STOPS,
} from "./protocol.js";
import { CALL, type Failure, type Lead, type SkillJob } from "./skill.js";

/**
 * Running a skill's job (plan phase 28):
 * - every draft passes the skill's gates or goes back to the model with the
 *   rejected draft and its exact failures, at most twice; then the draft with
 *   the fewest failures returns, flagged (the book's Self-Heal Loop: bounded,
 *   verifier-driven, a handoff instead of a silent fix);
 * - a skill with leads drafts each lead apart and ranks the drafts that pass
 *   with a judge reading each pair twice, positions swapped (Parallel
 *   Exploration; Phase 10's `combineOrders`);
 * - a translation long enough gets one reading by a critic and at most one
 *   revision, kept only if it passes the gates (Generator-Critic).
 * Nothing is cut: a draft over its limit returns with the limit named, and one
 * the model itself stopped short (its output limit, a safety filter) returns
 * flagged as such. What the runner sends a model lives in protocol.ts.
 */

/** One candidate: its best draft, what that still fails, the drafts written for it, its lead. */
export interface Candidate {
  text: string;
  failures: Failure[];
  drafts: number;
  lead: string | null;
}

export interface SkillModels {
  writer: LanguageModel;
  /** The judge chain's model, for ranking and the critic; null when none is configured. */
  judge: LanguageModel | null;
  /** Aborts every call in flight (a run's cancel or shutdown); a judge or critic aborted is not a failure. */
  signal?: AbortSignal;
}

export interface SkillRun {
  /** The text the admin gets: the top candidate, finished. */
  text: string;
  /** What the top candidate still fails: it needs the admin's eye. */
  failures: Failure[];
  /** Every candidate, the top first, its text finished. */
  candidates: Candidate[];
  /** Repairs across the candidates: drafts after each one's first. */
  repairs: number;
  /** The critic's reading, when one ran: no problem, a revision kept, or one refused. */
  critic: { result: "ok" | "revised" | "refused"; notes: string[] } | null;
}

function conversation(job: SkillJob): ModelMessage[] {
  return typeof job.prompt === "string" ? [{ role: "user", content: job.prompt }] : job.prompt;
}

/** A draft as the model left it: its text, and why its stop makes it unusable as it is. */
interface Draft {
  text: string;
  stop: Failure | null;
}

function stopOf(reason: FinishReason, text: string): Failure | null {
  if (reason === "length") return STOPS.length;
  if (reason === "content-filter") return STOPS.filter;
  return text ? null : STOPS.empty;
}

/** One draft: the job's instructions (and a lead's), its prompt, and the turns so far. */
async function write(
  model: LanguageModel,
  job: SkillJob,
  lead: Lead | undefined,
  turns: readonly ModelMessage[],
  signal?: AbortSignal,
): Promise<Draft> {
  const result = await generateText({
    model,
    abortSignal: signal,
    instructions: lead ? `${job.instructions}\n\n${lead.instruction}` : job.instructions,
    messages: [...conversation(job), ...turns],
    ...CALL,
  });
  const text = result.text.trim();
  return { text, stop: stopOf(result.finishReason, text) };
}

/** A draft's failures: its stop's, then its gates' (an empty draft has none to check). */
function failuresOf(job: SkillJob, draft: Draft): Failure[] {
  const gates = draft.text ? job.check(draft.text) : [];
  return draft.stop ? [draft.stop, ...gates] : gates;
}

/** A candidate: drafted, gated, repaired from its failures; the best draft when none passes. */
export async function repaired(
  model: LanguageModel,
  job: SkillJob,
  lead?: Lead,
  signal?: AbortSignal,
): Promise<Candidate> {
  const turns: ModelMessage[] = [];
  let best: Candidate | null = null;
  let written = 0;
  while (written < MAX_DRAFTS) {
    written++;
    const draft = await write(model, job, lead, turns, signal);
    const candidate = { text: draft.text, failures: failuresOf(job, draft) };
    const { failures } = candidate;
    // The earliest of equals: a repair that fixes nothing does not replace the draft it repaired.
    if (!best || rankOf(candidate) < rankOf(best)) {
      best = { ...candidate, drafts: written, lead: lead?.id ?? null };
    }
    if (!failures.length) break;
    // Cut at the output limit or stopped by a filter: another draft would stop the same way.
    if (draft.stop && draft.stop !== STOPS.empty) break;
    // An empty draft is asked for again as it was; any other goes back with its failures.
    if (draft.text) {
      turns.push(
        { role: "assistant", content: draft.text },
        { role: "user", content: repairNote(failures) },
      );
    }
  }
  return { ...best!, drafts: written };
}

const CHOICE: Record<"1" | "2" | "tie", PairChoice> = {
  "1": "first",
  "2": "second",
  tie: "tie",
};

/** One reading of a pair; null when the judge fails (the pair then counts as a tie). */
async function judgeOnce(
  judge: LanguageModel,
  job: SkillJob,
  first: string,
  second: string,
  signal?: AbortSignal,
): Promise<PairChoice | null> {
  try {
    const result = await generateText({
      model: judge,
      abortSignal: signal,
      ...JUDGE_CALL,
      output: Output.object({ schema: pairSchema }),
      instructions: rankInstructions(job.subject),
      prompt: pairPrompt(job.evidence, first, second),
    });
    return CHOICE[result.output.better];
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[copilot] the judge could not compare two drafts", (error as Error).message);
    return null;
  }
}

/**
 * Each lead drafted apart, then the drafts that pass ranked: every pair read
 * twice with positions swapped, a win 1 point, a tie or orders that disagree
 * ½ each. Passing drafts first, then points, then fewer failures (a draft the
 * model stopped short last), then fewer drafts, then the leads' order. With
 * fewer than two passing, or no judge, no judge call. A lead that could not
 * be drafted is left out, logged; none drafted throws.
 */
export async function explore(models: SkillModels, job: SkillJob): Promise<Candidate[]> {
  const settled = await Promise.allSettled(
    job.leads.map((lead) => repaired(models.writer, job, lead, models.signal)),
  );
  settled.forEach((s, i) => {
    if (s.status === "rejected") {
      console.warn(
        `[copilot] the ${job.leads[i]!.id} lead could not be drafted`,
        (s.reason as Error).message,
      );
    }
  });
  // Aborted (a run's cancel or shutdown): the leads that finished are no draft to offer.
  models.signal?.throwIfAborted();
  const candidates = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (!candidates.length) throw (settled[0] as PromiseRejectedResult).reason;

  const points = new Map<Candidate, number>(candidates.map((c) => [c, 0]));
  const passing = candidates.filter((c) => !c.failures.length);
  const { judge } = models;
  if (judge && passing.length > 1) {
    const pairs = passing.flatMap((a, i) => passing.slice(i + 1).map((b) => [a, b] as const));
    await Promise.all(
      pairs.map(async ([a, b]) => {
        const [aFirst, bFirst] = await Promise.all([
          judgeOnce(judge, job, a.text, b.text, models.signal),
          judgeOnce(judge, job, b.text, a.text, models.signal),
        ]);
        const outcome = aFirst && bFirst ? combineOrders(aFirst, bFirst) : "inconsistent";
        const add = (c: Candidate, n: number) => points.set(c, points.get(c)! + n);
        if (outcome === "a") add(a, 1);
        else if (outcome === "b") add(b, 1);
        else {
          add(a, 0.5);
          add(b, 0.5);
        }
      }),
    );
  }
  return [...candidates].sort(
    (x, y) =>
      Number(x.failures.length > 0) - Number(y.failures.length > 0) ||
      points.get(y)! - points.get(x)! ||
      rankOf(x) - rankOf(y) ||
      x.drafts - y.drafts,
  );
}

/**
 * The critic's reading of a draft that passed its gates, and at most one
 * revision, kept only if it passes them too. A critic that fails leaves the
 * draft unchecked (null).
 */
export async function critique(
  models: SkillModels,
  job: SkillJob,
  draft: Candidate,
): Promise<{ candidate: Candidate; critic: SkillRun["critic"] }> {
  const { judge } = models;
  if (!job.critic || !judge || draft.failures.length) return { candidate: draft, critic: null };
  let problems: string[];
  try {
    const result = await generateText({
      model: judge,
      abortSignal: models.signal,
      ...JUDGE_CALL,
      output: Output.object({ schema: criticSchema }),
      instructions: job.critic.instructions,
      prompt: criticPrompt(job.critic.source, draft.text),
    });
    problems = result.output.ok ? [] : result.output.problems;
  } catch (error) {
    if (models.signal?.aborted) throw error;
    console.warn("[copilot] the critic could not read the draft", (error as Error).message);
    return { candidate: draft, critic: null };
  }
  if (!problems.length) return { candidate: draft, critic: { result: "ok", notes: [] } };

  const turns: ModelMessage[] = [
    { role: "assistant", content: draft.text },
    { role: "user", content: revisionNote(problems) },
  ];
  let revision: Draft;
  try {
    revision = await write(models.writer, job, undefined, turns, models.signal);
  } catch (error) {
    if (models.signal?.aborted) throw error;
    console.warn("[copilot] the revision could not be written", (error as Error).message);
    return { candidate: draft, critic: { result: "refused", notes: problems } };
  }
  const failures = failuresOf(job, revision);
  return failures.length
    ? { candidate: draft, critic: { result: "refused", notes: problems } }
    : {
        candidate: { text: revision.text, failures, drafts: draft.drafts + 1, lead: null },
        critic: { result: "revised", notes: problems },
      };
}

/** The job, run: explored when it has leads, else one candidate and the critic's reading. */
export async function runSkill(models: SkillModels, job: SkillJob): Promise<SkillRun> {
  let candidates: Candidate[];
  let critic: SkillRun["critic"] = null;
  let repairs: number;
  if (job.leads.length) {
    candidates = await explore(models, job);
    repairs = candidates.reduce((sum, c) => sum + c.drafts - 1, 0);
  } else {
    const first = await repaired(models.writer, job, undefined, models.signal);
    repairs = first.drafts - 1;
    const read = await critique(models, job, first);
    candidates = [read.candidate];
    critic = read.critic;
  }
  // Aborted on the way: what was written is not the whole job.
  models.signal?.throwIfAborted();
  const finished = candidates.map((c) => ({ ...c, text: job.finish(c.text) }));
  // A lead whose every draft came back empty is not offered; with none left, the
  // empty top makes the route refuse (`empty_draft`). Its retries still count.
  const offered = finished.filter((c) => c.text);
  const shown = offered.length ? offered : finished.slice(0, 1);
  return {
    text: shown[0]!.text,
    failures: shown[0]!.failures,
    candidates: shown,
    repairs,
    critic,
  };
}
