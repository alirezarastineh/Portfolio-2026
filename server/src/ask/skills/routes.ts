import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { altImage } from "../alt-image.js";
import { askConfig, askCorpus } from "../deps.js";
import { shortName } from "../models/registry.js";
import { copilotSession } from "../one-shot.js";
import { copilotInput, SKILLS, skillFor } from "./registry.js";
import { runSkill } from "./run.js";
import { SkillAnswer } from "./skill.js";
import { SKILL_RULES, skillTable } from "./stats.js";
import { decideUses, recordUse, useAggregates } from "./uses.js";

/**
 * The editor copilot (plan phases 27–28), under /admin/ai (the admin
 * router's auth and CSRF apply): a draft from a skill (gated, repaired,
 * explored, read by a critic: skills/run.ts), the editor's verdict on it, and
 * the skills' table. A draft is only text for a field: nothing is saved until
 * the admin saves, nothing is live until a publish.
 */
export const skillsRouter = new Hono();

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

skillsRouter.post("/copilot", zValidator("json", copilotInput, invalid), async (c) => {
  const input = c.req.valid("json");
  const config = askConfig();
  const skill = skillFor(input.task);

  const job = await skill.request(input, {
    config,
    corpus: () => askCorpus(config),
    image: altImage,
  });
  if (job instanceof SkillAnswer) return c.json(job.body, job.status);

  const result = await copilotSession(config, skill.accepts, (models) => runSkill(models, job));
  if (!result.ok) return c.json({ error: result.error }, 503);
  const { model, value: run } = result;
  // Every draft empty (a safety filter, say): nothing to put in a field, and nothing offered.
  if (!run.text) return c.json({ error: "empty_draft" }, 502);
  const [top, ...others] = run.candidates;

  // The draft's record; an abstention is decided at once and has nothing to report.
  const abstained = skill.abstains(run.text);
  const suggestionId = await recordUse({
    skill: skill.id,
    version: skill.version,
    model,
    text: run.text,
    abstained,
    repairs: run.repairs,
    flags: run.failures.map((f) => f.gate),
    candidates: run.candidates.length,
    critic: run.critic?.result ?? null,
  }).then(
    (id) => (abstained ? null : id),
    (error: unknown) => {
      console.error("[ask] copilot draft not recorded", error);
      return null;
    },
  );
  const needsReview = (failures: { message: string }[]) =>
    failures.length ? { needsReview: failures.map((f) => f.message) } : {};
  return c.json({
    text: run.text,
    model: shortName(model),
    ...(suggestionId ? { suggestionId } : {}),
    ...needsReview(run.failures),
    ...(others.length
      ? {
          lead: top!.lead,
          alternatives: others.map((c) => ({
            text: c.text,
            lead: c.lead,
            ...needsReview(c.failures),
          })),
        }
      : {}),
    ...(run.critic
      ? { critic: { revised: run.critic.result === "revised", notes: run.critic.notes } }
      : {}),
  });
});

/** Which of the drafts offered the admin kept: 0 the top pick, 1–2 an alternative (plan phase 28). */
const pick = z.number().int().min(0).max(2).optional();

// Strict: a draft kept as it was has no edit to measure, an edited one has one.
const verdict = z.discriminatedUnion("outcome", [
  z.strictObject({ id: z.uuid(), outcome: z.literal("kept"), pick }),
  z.strictObject({
    id: z.uuid(),
    outcome: z.literal("edited"),
    distance: z.number().int().min(1).max(100_000),
    pick,
  }),
  z.strictObject({
    id: z.uuid(),
    outcome: z.literal("discarded"),
    distance: z.number().int().min(0).max(100_000).nullish(),
  }),
]);

/** What the editor did with drafts, at a save, a discard or when it closed. */
skillsRouter.post(
  "/copilot/outcomes",
  zValidator("json", z.object({ outcomes: z.array(verdict).min(1).max(50) }), invalid),
  async (c) => c.json({ recorded: await decideUses(c.req.valid("json").outcomes) }),
);

skillsRouter.get("/skills", async (c) =>
  c.json({ rules: SKILL_RULES, skills: skillTable(SKILLS, await useAggregates()) }),
);
