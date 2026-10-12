import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiRunItems, type ProposalStatus } from "../../db/schema.js";
import { altImage } from "../alt-image.js";
import { askChain, askConfig, askCorpus } from "../deps.js";
import type { ModelCall } from "../models/fallback.js";
import { skillModels } from "../one-shot.js";
import { paidItems, PROVIDER_DOWN } from "../runs/paid.js";
import type { RunWork, WorkFn, WorkOutcome } from "../runs/runner.js";
import { getRun } from "../runs/store.js";
import { skillFor } from "../skills/registry.js";
import { runSkill, type SkillRun } from "../skills/run.js";
import { SkillAnswer, type SkillContext, type SkillId } from "../skills/skill.js";
import { recordUse } from "../skills/uses.js";
import { contentGlossary } from "./glossary.js";
import { insertProposal, proposalFor } from "./proposals.js";
import { contentTargets, readTarget, type ContentGoal, type Target } from "./targets.js";
import { criticNotes } from "./verdicts.js";

/**
 * The content agent (plan phase 29, the book's Plan-and-Execute): a run of
 * kind `agent`, task `content`. The plan is the targets (targets.ts: no
 * model); each item is drafted by a worker with fresh context (the target, its
 * skill, the glossary), through the Phase 28 gates and repairs, into a
 * proposal (`ai_proposals`), never into the content: the admin applies it
 * (phase 30). An item filled meanwhile is stale and costs nothing; a draft
 * that still fails a check, or an item whose models failed twice, needs the
 * admin. The run's own spend limit, the `agent` switch and cap, and the
 * visitors' reserve stop it (paid.ts); a restart leaves it resumable.
 */

export const DEFAULT_ITEMS = 20;
export const MAX_ITEMS = 100;
export const DEFAULT_USD = 0.05;
export const MAX_USD = 1;
/** What a search description is drafted to: the editors' Suggest's length. */
const SEO_CAP = 155;
/** The longest source the translate skill takes in one draft. */
const TRANSLATE_MAX = 20_000;

export const RUN_LIMIT = "This run reached its own spend limit; start a new run to draft more.";
export const DRAFTED_TWICE =
  "Could not be drafted: no model of the chain answered, twice. Draft it in the editor, or in a later run.";

/** A content run's params: its goals and its own limits (no content: the keys name the targets). */
export interface ContentParams {
  task: "content";
  goals: ContentGoal[];
  maxItems: number;
  maxUsd: number;
}

/** A content run's items, or why there is nothing to start. */
export async function planContent(input: {
  goals: ContentGoal[];
  maxItems?: number;
  maxUsd?: number;
}): Promise<{ params: Record<string, unknown>; keys: string[] } | { error: string; status: 400 }> {
  if (!askChain(askConfig(), "copilot").length) return { error: "no_chain", status: 400 };
  const maxItems = input.maxItems ?? DEFAULT_ITEMS;
  const targets = await contentTargets(input.goals, maxItems);
  if (!targets.length) return { error: "nothing_to_do", status: 400 };
  const params: ContentParams = {
    task: "content",
    goals: input.goals,
    maxItems,
    maxUsd: input.maxUsd ?? DEFAULT_USD,
  };
  return { params: { ...params }, keys: targets.map((t) => t.key) };
}

/** The skill a target is drafted by, and its input; or why it cannot be (no model call). */
function draftPlan(
  target: Target,
  glossary: readonly string[],
): { skill: SkillId; input: Record<string, unknown>; missing?: string } {
  if (target.goal === "alt") {
    return {
      skill: "alt",
      input: { task: "alt", mediaId: target.entityId, locale: target.locale },
    };
  }
  const source = target.source ?? "";
  if (target.goal === "seo") {
    return {
      skill: "seo",
      input: {
        task: "seo",
        text: source.slice(0, TRANSLATE_MAX),
        locale: target.locale,
        maxLength: SEO_CAP,
      },
    };
  }
  const limit = target.maxLength;
  return {
    skill: "translate",
    input: {
      task: "translate",
      text: source,
      from: target.locale === "en" ? "de" : "en",
      to: target.locale,
      html: /<[a-z][^>]*>/i.test(source),
      ...(limit && limit >= 10 && limit <= TRANSLATE_MAX ? { maxLength: limit } : {}),
      ...(glossary.length ? { glossary } : {}),
    },
    ...(source.length > TRANSLATE_MAX
      ? {
          missing: `The source has ${source.length} characters, more than one draft takes (${TRANSLATE_MAX}): translate it in the editor, a part at a time.`,
        }
      : {}),
  };
}

/** Why an image skill answered without a model (`alt-image.ts`), in words. */
const IMAGE_NOTES: Record<string, string> = {
  not_found: "The image is gone from the media library.",
  not_an_image: "It is a document, not an image: it takes no alt text.",
  unreadable: "Its file could not be read: write the alt text in the media library.",
};

function answerNote(answer: SkillAnswer): string {
  const error = (answer.body as { error?: unknown } | null)?.error;
  return (typeof error === "string" && IMAGE_NOTES[error]) || "The image could not be read.";
}

/**
 * How often this item's models failed before: an item is started again after
 * a restart or a cancel too, so only a failure recorded in its result counts.
 */
async function failuresOf(runId: string, key: string): Promise<number> {
  const [row] = await getDb()
    .select({ result: aiRunItems.result })
    .from(aiRunItems)
    .where(and(eq(aiRunItems.runId, runId), eq(aiRunItems.key, key)));
  const failures = (row?.result as { failures?: unknown } | null)?.failures;
  return typeof failures === "number" ? failures : 0;
}

/** What the run has spent, and its dearest item so far (a resume counts what came before). */
async function spendOf(runId: string): Promise<{ spent: number; dearest: number }> {
  // Raw and qualified: Drizzle leaves a single table's columns unqualified in a subquery.
  const { rows } = await getDb().execute<{ spent: number; dearest: number }>(sql`
    select r.usd::float8 as spent,
      coalesce((select max(i.usd) from ai_run_items i where i.run_id = r.id), 0)::float8 as dearest
    from ai_runs r where r.id = ${runId}`);
  return { spent: Number(rows[0]?.spent ?? 0), dearest: Number(rows[0]?.dearest ?? 0) };
}

interface ItemContext {
  work: RunWork;
  paid: ReturnType<typeof paidItems>;
  calls: ModelCall[];
  goals: readonly ContentGoal[];
  glossary: readonly string[];
  skills: SkillContext;
}

/** A target's draft, as its proposal records it. */
interface Drafted {
  skill: SkillId;
  /** Null when there is no draft (the notes say why). */
  after: string | null;
  flags?: string[];
  notes?: string[];
  useId?: string | null;
}

/** A proposal for the item's target, and the item done with it. */
async function propose(
  ctx: ItemContext,
  key: string,
  target: Target,
  draft: Drafted,
): Promise<void> {
  const flags = draft.flags ?? [];
  const status: ProposalStatus = draft.after && !flags.length ? "proposed" : "needs_you";
  const id = await insertProposal({
    runId: ctx.work.run.id,
    goal: target.goal,
    kind: target.kind,
    entityId: target.entityId,
    field: target.field,
    locale: target.locale,
    label: target.label,
    before: target.current,
    after: draft.after,
    skill: draft.skill,
    version: skillFor(draft.skill).version,
    useId: draft.useId ?? null,
    flags,
    notes: draft.notes ?? [],
    status,
  });
  await ctx.paid.finish(key, "done", { proposal: id, status });
}

/**
 * The target drafted by its skill, with fresh context (the target, the skill,
 * the glossary): the proposal to write; "down" when no model answered (the
 * models' failures counted so far, this one included); "aborted" when a cancel
 * or a shutdown stopped it (the item stays to do, and no failure counts).
 */
async function draft(
  ctx: ItemContext,
  key: string,
  target: Target,
): Promise<Drafted | { down: number } | "aborted"> {
  const plan = draftPlan(target, ctx.glossary);
  const none = (note: string): Drafted => ({ skill: plan.skill, after: null, notes: [note] });
  if (plan.missing) return none(plan.missing);

  const skill = skillFor(plan.skill);
  // The models first: no image is read for a request no model can take.
  const session = skillModels(askConfig(), skill.accepts);
  if (!session.ok) {
    return none(
      session.error === "no_model_for_this"
        ? "No model of the copilot's chain can take it: it needs one that reads images."
        : "The assistant has no model in this deploy.",
    );
  }
  const job = await skill.request(plan.input, ctx.skills);
  if (job instanceof SkillAnswer) return none(answerNote(job));

  let run: SkillRun;
  try {
    run = await runSkill({ ...session.models, signal: ctx.paid.signal }, job);
  } catch (error) {
    if (ctx.paid.signal.aborted) return "aborted";
    console.warn(
      `[agent] content run ${ctx.work.run.id}: ${key} not drafted`,
      (error as Error).message,
    );
    // The models' second failure for this item hands it to the admin, and the run goes on.
    const failures = (await failuresOf(ctx.work.run.id, key)) + 1;
    return failures >= 2 ? none(DRAFTED_TWICE) : { down: failures };
  } finally {
    ctx.calls.push(...session.calls());
  }
  // Cut off after the draft came back: not proposed, so a resume drafts it whole.
  if (ctx.paid.signal.aborted) return "aborted";

  if (!run.text)
    return none("Every draft came back empty (a safety filter, maybe): draft it in the editor.");
  const flags = run.failures.map((f) => f.gate);
  const useId = await recordUse({
    skill: skill.id,
    version: skill.version,
    model: session.model(),
    text: run.text,
    abstained: false,
    repairs: run.repairs,
    flags,
    candidates: run.candidates.length,
    critic: run.critic?.result ?? null,
    source: "agent",
  }).catch((error: unknown) => {
    console.error(`[agent] content run ${ctx.work.run.id}: draft not recorded`, error);
    return null;
  });
  return {
    skill: plan.skill,
    after: run.text,
    flags,
    notes: [...run.failures.map((f) => f.message), ...criticNotes(run.critic)],
    useId,
  };
}

/**
 * One item: re-read its target and draft it into a proposal. A target filled
 * or gone meanwhile is stale; one this run already proposed (before a cancel
 * or a restart cut the item off) is not drafted again. "halt" when the models
 * are down: the run stops, resumable.
 */
async function draftItem(ctx: ItemContext, key: string): Promise<"halt" | null> {
  const { work, paid } = ctx;
  await paid.start(key);
  if (paid.signal.aborted) return null;

  const target = await readTarget(key, ctx.goals);
  const proposed = target ? await proposalFor(work.run.id, target) : null;
  if (proposed) {
    await paid.finish(key, "done", { proposal: proposed.id, status: proposed.status });
    return null;
  }
  if (!target?.gap) {
    await paid.finish(key, "done", { stale: true });
    return null;
  }
  const drafted = await draft(ctx, key, target);
  if (drafted === "aborted") {
    // Cut off by a cancel or a shutdown: still to do (`paidItems` marks it pending).
    await paid.finish(key, "pending");
    return null;
  }
  if ("down" in drafted) {
    await paid.finish(key, "unavailable", { unavailable: true, failures: drafted.down });
    return "halt";
  }
  await propose(ctx, key, target, drafted);
  return null;
}

/** What the run came to: proposals drafted, those that need the admin, items gone stale. */
async function summaryOf(
  runId: string,
): Promise<{ proposed: number; needsYou: number; stale: number }> {
  const items = (await getRun(runId))?.items ?? [];
  const results = items.flatMap((i) =>
    i.status === "done" && i.result
      ? [i.result as { stale?: boolean; status?: ProposalStatus }]
      : [],
  );
  return {
    proposed: results.filter((r) => r.status === "proposed").length,
    needsYou: results.filter((r) => r.status === "needs_you").length,
    stale: results.filter((r) => r.stale).length,
  };
}

/**
 * The items from `from` on, drafted one at a time, each only after the one before:
 * the run's spend limit is read between them, and an item as dear as the dearest so far
 * must still fit. The outcome that stopped the run, or null when it got to the end (or
 * was cut off, which the caller reads from the signal).
 */
async function draftFrom(
  ctx: ItemContext,
  keys: readonly string[],
  from: number,
  maxUsd: number,
): Promise<WorkOutcome | null> {
  const key = keys[from];
  if (key === undefined || ctx.paid.signal.aborted) return null;
  const runId = ctx.work.run.id;
  // The run's own limit: what it has spent, and an item as dear as its dearest so far.
  const { spent, dearest } = await spendOf(runId);
  if (spent + dearest > maxUsd) {
    return { status: "failed", error: RUN_LIMIT, summary: await summaryOf(runId) };
  }
  if ((await draftItem(ctx, key)) === "halt") {
    return { status: "failed", error: PROVIDER_DOWN, summary: await summaryOf(runId) };
  }
  return draftFrom(ctx, keys, from + 1, maxUsd);
}

export const contentWork: WorkFn = async (work): Promise<WorkOutcome> => {
  const params = work.run.params as Partial<ContentParams>;
  if (params.task !== "content" || !params.goals?.length) {
    return { status: "failed", error: "Not a content run: an agent run of another task." };
  }
  const config = askConfig();
  const calls: ModelCall[] = [];
  const paid = paidItems(work, calls);
  const ctx: ItemContext = {
    work,
    paid,
    calls,
    goals: params.goals,
    glossary: await contentGlossary(),
    skills: { config, corpus: () => askCorpus(config), image: altImage },
  };
  const maxUsd = params.maxUsd ?? DEFAULT_USD;

  const halted = await draftFrom(ctx, work.keys, 0, maxUsd);
  if (halted) return halted;

  const summary = await summaryOf(work.run.id);
  const stopped = paid.stoppedBy();
  if (stopped) return { status: "failed", error: stopped, summary };
  // Cancelled or interrupted: the runner records which; a resume drafts what is left.
  return { status: "done", summary };
};
