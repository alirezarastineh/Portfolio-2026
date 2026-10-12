import { z } from "zod";

import { alt, altInput } from "./alt.js";
import { describe, describeInput } from "./describe.js";
import { faqAnswer, faqAnswerInput } from "./faq-answer.js";
import { faqQuestion, faqQuestionInput } from "./faq-question.js";
import { seo, seoInput } from "./seo.js";
import type { Skill, SkillId } from "./skill.js";
import { tighten, tightenInput } from "./tighten.js";
import { translate, translateInput } from "./translate.js";

/** Every skill, in the order the admin lists them. */
export const SKILLS: readonly Skill[] = [
  translate,
  tighten,
  seo,
  faqQuestion,
  faqAnswer,
  alt,
  describe,
];

const BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));

export function skillFor(id: SkillId): Skill {
  const skill = BY_ID.get(id);
  if (!skill) throw new Error(`no skill ${id}`);
  return skill;
}

/** What `POST /admin/ai/copilot` takes: one skill's input, by `task` (the shapes the admin sends). */
export const copilotInput = z.discriminatedUnion("task", [
  translateInput,
  tightenInput,
  seoInput,
  faqQuestionInput,
  faqAnswerInput,
  altInput,
  describeInput,
]);

export type CopilotInput = z.infer<typeof copilotInput>;
