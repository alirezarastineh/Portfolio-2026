import { z } from "zod";

import type { Failure } from "./skill.js";

/**
 * What the runner itself sends a model (skills/run.ts, plan phase 28): the
 * repair turn, the judge's brief and the shape of its answer, the critic's
 * prompt and the revision turn, and how many drafts a candidate may take. Each
 * is part of the version of every skill it serves (`protocolFor`), so a change
 * to one restarts their keep rates, as a change to a skill's instructions does.
 */

/** Drafts a candidate may take: the first and two repairs (the U-curve: more rarely helps). */
export const MAX_DRAFTS = 3;

/** The repair turn: the exact failures, so the next draft fixes them and nothing else. */
export function repairNote(failures: readonly Failure[]): string {
  const list = failures.map((f) => `- ${f.message}`).join("\n");
  return `That draft failed these checks:\n${list}\nWrite it again: fix exactly these and change nothing else. Return only the text.`;
}

/**
 * What the model's own stop says of a draft: cut at the output limit, stopped
 * by a safety filter, or empty. A draft so stopped ranks below every draft
 * that was not, and only an empty one is asked for again (the others would
 * stop the same way).
 */
export const STOPS = {
  length: { gate: "complete", message: "it stopped at the model's output limit before the end" },
  filter: { gate: "filtered", message: "the model's safety filter stopped it" },
  empty: { gate: "empty", message: "the draft is empty" },
} as const satisfies Record<string, Failure>;

const STOP_GATES = new Set<string>(Object.values(STOPS).map((stop) => stop.gate));

/** How a draft ranks, lower first: an empty one last, then one stopped short, then by failures. */
export function rankOf(draft: { text: string; failures: readonly Failure[] }): number {
  if (!draft.text) return 2_000;
  const stopped = draft.failures.some((f) => STOP_GATES.has(f.gate));
  return (stopped ? 1_000 : 0) + draft.failures.length;
}

/** How the judge chain is called, to rank drafts and to read a translation. */
export const JUDGE_CALL = { maxRetries: 0, temperature: 0 } as const;

export const pairSchema = z.object({
  better: z.enum(["1", "2", "tie"]).describe("The better draft, or tie"),
  reason: z.string().max(300).describe("Why, in one sentence"),
});

/** Faithful to the source first, then specific; length is named, since judges favour it. */
export function rankInstructions(subject: string): string {
  return `You compare two drafts of ${subject}, both written from the source below. Prefer the draft whose claims the source supports; between equally faithful drafts, prefer the more specific and clearer one. Length is not quality: never prefer a draft for being longer. Say tie when neither is better.`;
}

export const pairPrompt = (evidence: string, first: string, second: string): string =>
  `Source:\n${evidence}\n\nDraft 1:\n${first}\n\nDraft 2:\n${second}`;

export const criticSchema = z.object({
  ok: z.boolean().describe("True when the translation has no real problem"),
  problems: z.array(z.string().max(300)).max(5).describe("Each real problem, in one sentence"),
});

export const criticPrompt = (source: string, draft: string): string =>
  `Source:\n${source}\n\nTranslation:\n${draft}`;

/** The revision turn: the critic's problems, to fix and nothing else. */
export function revisionNote(problems: readonly string[]): string {
  const list = problems.map((p) => `- ${p}`).join("\n");
  return `A reviewer read your translation against the source and found:\n${list}\nRevise it to fix these, keeping everything else as it is. Return only the translation.`;
}

/** The protocol a skill's drafts go through, on placeholders: what its version hashes. */
export function protocolFor(skill: { explores: boolean; critic: boolean }): unknown {
  return {
    maxDrafts: MAX_DRAFTS,
    repair: repairNote([{ gate: "gate", message: "{failure}" }]),
    stops: STOPS,
    rank: skill.explores
      ? {
          call: JUDGE_CALL,
          instructions: rankInstructions("{subject}"),
          prompt: pairPrompt("{source}", "{first}", "{second}"),
          schema: z.toJSONSchema(pairSchema),
        }
      : null,
    critic: skill.critic
      ? {
          call: JUDGE_CALL,
          prompt: criticPrompt("{source}", "{draft}"),
          schema: z.toJSONSchema(criticSchema),
          revision: revisionNote(["{problem}"]),
        }
      : null,
  };
}
