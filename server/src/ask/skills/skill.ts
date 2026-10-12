import { createHash } from "node:crypto";

import type { ModelMessage } from "ai";
import type { z } from "zod";

import type { AltImage } from "../alt-image.js";
import type { AskConfig } from "../config.js";
import type { AskCorpus } from "../corpus/index.js";
import type { ModelEntry } from "../models/registry.js";
import { protocolFor } from "./protocol.js";

/**
 * The copilot's skills (plan phase 27, the book's Skill Package): each task
 * the admin can ask for, as a unit with discovery metadata (what it does,
 * when to use it), an input, the models it needs, the request it builds, the
 * checks on its output, and a version. The version is a hash of what the
 * model receives on fixed samples (the runner's repair, ranking and critic
 * prompts included), the checks and the call settings: a change to any of
 * them is a new version, whose keep rate starts afresh (skills/stats.ts); a
 * change to the description, the code or the content is not.
 */

export const SKILL_IDS = [
  "translate",
  "tighten",
  "seo",
  "faq-question",
  "faq-answer",
  "alt",
  "describe",
] as const;
export type SkillId = (typeof SKILL_IDS)[number];

/** How every skill calls its model: part of each version. */
export const CALL = { maxRetries: 0, maxOutputTokens: 4_000, temperature: 0.2 } as const;

export const LANGUAGE = { en: "English", de: "German" } as const;

/** What a skill's preparation may read: the deploy's config, the published corpus, an image. */
export interface SkillContext {
  config: AskConfig;
  corpus(): Promise<AskCorpus>;
  image(mediaId: string): Promise<AltImage>;
}

/** A structurally different way into a draft (best-of-N, the book's Parallel Exploration). */
export interface Lead {
  id: string;
  /** Added after the skill's instructions for this lead's draft. */
  instruction: string;
}

/** A second model's reading of a draft against its source (the translation critic). */
export interface CriticBrief {
  instructions: string;
  source: string;
}

/** One gate a draft fails: its id (what the record keeps) and what is wrong (what the model and the admin read). */
export interface Failure {
  gate: string;
  message: string;
}

/**
 * What a request runs (plan phase 28): what the model is sent, the gates a
 * draft must pass, how the text the admin gets is made from it, and, for the
 * skills that have them, the leads to explore and the critic's brief.
 */
export interface SkillJob {
  instructions: string;
  prompt: string | ModelMessage[];
  /** The gates the draft fails, in order: empty when it passes. */
  check(text: string): Failure[];
  /** The text the admin gets from a draft (faq-answer's markers removed). */
  finish(text: string): string;
  leads: readonly Lead[];
  /** What the drafts are, for the judge that ranks them ("a search-result description"). */
  subject: string;
  /** What the judge reads the drafts against: the source. */
  evidence: string;
  critic: CriticBrief | null;
}

/** The answer when no model is needed (or the input cannot be used): sent as it is. */
export class SkillAnswer {
  constructor(
    readonly body: unknown,
    readonly status: 200 | 400 | 404,
  ) {}
}

/** A check on a skill's output: null when it passes, else what failed (plan phase 28). */
export interface Gate<P> {
  id: string;
  /** What the check is set to (a length, a ratio): part of the version. */
  params?: unknown;
  check(text: string, prepared: P): string | null;
}

export interface SkillDefinition<I extends { task: SkillId }, P> {
  id: I["task"];
  /** What it does (discovery: read before anything else). */
  description: string;
  /** When to use it: the editor's button, or a caller that picks skills (plan phase 29). */
  whenToUse: string;
  input: z.ZodType<I>;
  /** `"vision"`: it sends an image, so only a model that reads one (Gemini's) may take it. */
  models: "text" | "vision";
  /** What the request needs (an image, the corpus), or the answer without a model. */
  prepare?(input: I, ctx: SkillContext): P | SkillAnswer | Promise<P | SkillAnswer>;
  /** The request, from the prepared input: pure. */
  build(prepared: P): { instructions: string; prompt: string | ModelMessage[] };
  /** True when the output declines (faq-answer's `NO_ANSWER`): there is nothing to keep. */
  abstains?(text: string): boolean;
  gates: readonly Gate<P>[];
  /** Structurally different leads, each drafted, gated and ranked pairwise (seo, tighten). */
  explore?: {
    leads: readonly Lead[];
    /** What the drafts are, for the judge. */
    subject: string;
    /** What the judge reads them against. */
    evidence(prepared: P): string;
  };
  /** A second model reads the draft against its source; null for an input it skips. */
  critic?(prepared: P): CriticBrief | null;
  /** The text the admin gets from a draft that passed (or the best one). */
  finish?(text: string, prepared: P): string;
  /** Fixed prepared inputs, one per branch of `build`: the version is computed from them. */
  samples: readonly [P, ...P[]];
}

/** A registered skill, its types erased: what the route and the admin's table use. */
export interface Skill {
  id: SkillId;
  description: string;
  whenToUse: string;
  models: "text" | "vision";
  version: string;
  /** The checks' names, for the admin. */
  gates: readonly string[];
  /** The leads' names, when it explores. */
  leads: readonly string[];
  /** Whether a second model reads its drafts (for some inputs). */
  critic: boolean;
  /** The first sample's instructions: what the version's template reads like. */
  template: string;
  accepts(entry: ModelEntry): boolean;
  /** The job for an input the copilot's union already validated, or the answer. */
  request(input: unknown, ctx: SkillContext): Promise<SkillJob | SkillAnswer>;
  abstains(text: string): boolean;
}

/** A draft as a model might write it, citation marker and all: what `finish` makes of it is versioned. */
const FINISH_PROBE = "  A draft [^atlas] , as written. ";

/**
 * The version: 12 hex of what the model receives on the samples, the checks,
 * what the admin gets from a draft, the settings, and the runner's own
 * prompts for the steps the skill takes (protocol.ts).
 */
export function skillVersion<I extends { task: SkillId }, P>(
  def: SkillDefinition<I, P>,
  call: Readonly<Record<keyof typeof CALL, number>> = CALL,
  protocol: unknown = protocolFor({ explores: Boolean(def.explore), critic: Boolean(def.critic) }),
): string {
  const body = {
    id: def.id,
    models: def.models,
    call,
    protocol,
    gates: def.gates.map((gate) => [gate.id, gate.params ?? null]),
    explore: def.explore ? { leads: def.explore.leads, subject: def.explore.subject } : null,
    samples: def.samples.map((sample) => ({
      ...def.build(sample),
      // What the judge reads the drafts against, and what the critic reads them against.
      evidence: def.explore?.evidence(sample) ?? null,
      critic: def.critic?.(sample) ?? null,
      finish: def.finish ? def.finish(FINISH_PROBE, sample) : null,
    })),
  };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
}

export function defineSkill<I extends { task: SkillId }, P = I>(def: SkillDefinition<I, P>): Skill {
  const prepare = def.prepare ?? ((input: I) => input as unknown as P);
  return {
    id: def.id,
    description: def.description,
    whenToUse: def.whenToUse,
    models: def.models,
    version: skillVersion(def),
    gates: def.gates.map((gate) => gate.id),
    leads: def.explore?.leads.map((lead) => lead.id) ?? [],
    critic: Boolean(def.critic),
    template: def.build(def.samples[0]).instructions,
    accepts: def.models === "vision" ? (entry) => entry.provider === "gemini" : () => true,
    async request(input, ctx) {
      const prepared = await prepare(def.input.parse(input), ctx);
      if (prepared instanceof SkillAnswer) return prepared;
      return {
        ...def.build(prepared),
        check: (text) =>
          def.gates.flatMap((gate) => {
            const message = gate.check(text, prepared);
            return message === null ? [] : [{ gate: gate.id, message }];
          }),
        finish: (text) => def.finish?.(text, prepared) ?? text,
        leads: def.explore?.leads ?? [],
        subject: def.explore?.subject ?? "",
        evidence: def.explore?.evidence(prepared) ?? "",
        critic: def.critic?.(prepared) ?? null,
      };
    },
    abstains: (text) => def.abstains?.(text) ?? false,
  };
}
