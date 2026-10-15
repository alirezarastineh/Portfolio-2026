import { and, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";

import { sanitizeRichText } from "../../content/sanitize.js";
import { saveSection } from "../../content/sections.js";
import { seoSchema, uiSchema, type Locale } from "../../content/schema.js";
import { getDb } from "../../db/client.js";
import {
  aiProposals,
  experienceTranslations,
  mediaAssets,
  postTranslations,
  projectTranslations,
  skillTranslations,
} from "../../db/schema.js";
import { audit } from "../audit.js";
import type { Proposal } from "./proposals.js";
import { TEXT_FIELDS } from "./targets.js";
import { decideUse, verdictOn } from "./verdicts.js";

/**
 * The admin's decisions on the content agent's proposals (plan phase 30, the
 * book's Approval Gate and L1 for reversible writes). Apply writes the draft
 * content (never the live site), with the editors' rules: the field's own
 * schema, rich text sanitized, a section through `saveSection`'s row lock.
 * Every write is a compare-and-set: the field must still hold what the
 * proposal saw, or nothing is written and the proposal is stale. Revert is the
 * compensating step: it puts `before` back while the field still holds what
 * was applied. Each decision is audited and decides the draft's skill use.
 */

/** The longest alt text the media route takes. */
export const ALT_MAX = 300;

/** Fields holding HTML, sanitized as their editors' saves sanitize them. */
const RICH: Partial<Record<Proposal["kind"], readonly string[]>> = {
  project: ["problem", "aiArchitecture", "fullStackInfra", "body"],
  post: ["body"],
};

/** Where an entity's text lives: its translations table, the column naming the entity. */
const TABLES = {
  project: { texts: projectTranslations, owner: projectTranslations.projectId, stamped: true },
  experience: {
    texts: experienceTranslations,
    owner: experienceTranslations.experienceId,
    stamped: true,
  },
  skill: { texts: skillTranslations, owner: skillTranslations.skillId, stamped: false },
  post: { texts: postTranslations, owner: postTranslations.postId, stamped: true },
} as const;

export type DecisionError =
  "not_found" | "not_open" | "no_text" | "stale" | "not_applied" | "changed_since";

export type Decided =
  | { ok: true; proposal: Proposal }
  | { ok: false; error: DecisionError }
  | { ok: false; error: "invalid_input"; issues: z.core.$ZodIssue[] };

/** The field moved on (or is gone): nothing is written. */
class Moved extends Error {}

const isOpen = (p: Proposal) => p.status === "proposed" || p.status === "needs_you";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** The section documents an apply writes into, by their schemas. */
const SECTION_SCHEMAS: Readonly<Record<string, z.ZodType>> = { ui: uiSchema, seo: seoSchema };

/** A schema with its optional, default and nullable wrappers taken off. */
function unwrapped(schema: unknown): unknown {
  let node = schema;
  while (
    node instanceof z.ZodOptional ||
    node instanceof z.ZodDefault ||
    node instanceof z.ZodNullable
  ) {
    node = node.unwrap();
  }
  return node;
}

/** A section leaf's own schema at a dotted path (`experience.years`), or null. */
function leafSchema(section: string, path: string): z.ZodType | null {
  let node: unknown = Object.hasOwn(SECTION_SCHEMAS, section) ? SECTION_SCHEMAS[section] : null;
  for (const key of path.split(".")) {
    node = unwrapped(node);
    if (!(node instanceof z.ZodObject) || !Object.hasOwn(node.shape, key)) return null;
    node = node.shape[key];
  }
  return node instanceof z.ZodType ? node : null;
}

const notText = (field: string, text: string) => ({
  ok: false as const,
  issues: [
    { code: "custom", path: [field], message: "Not a text field", input: text },
  ] as z.core.$ZodIssue[],
});

/** The text a proposal may write, as its field's own schema takes it, or why not. */
function checked(
  p: Proposal,
  text: string,
): { ok: true; text: string } | { ok: false; issues: z.core.$ZodIssue[] } {
  if (p.kind === "media") {
    const result = z.string().trim().min(1).max(ALT_MAX).safeParse(text);
    return result.success
      ? { ok: true, text: result.data }
      : { ok: false, issues: result.error.issues };
  }
  if (p.kind === "section") {
    // The leaf's own rule: required text, and its token where it has one (`{n}` in "{n} years").
    const schema = leafSchema(p.entityId, p.field);
    if (!schema) return notText(p.field, text);
    const result = schema.safeParse(text.trim());
    if (!result.success) return { ok: false, issues: result.error.issues };
    return typeof result.data === "string"
      ? { ok: true, text: result.data }
      : notText(p.field, text);
  }
  const fields = TEXT_FIELDS[p.kind];
  if (!fields.fields.includes(p.field)) return notText(p.field, text);
  const result = (fields.schema.shape[p.field] as z.ZodType).safeParse(text);
  if (!result.success) return { ok: false, issues: result.error.issues };
  if (typeof result.data !== "string") return notText(p.field, text);
  const value = result.data;
  return { ok: true, text: RICH[p.kind]?.includes(p.field) ? sanitizeRichText(value) : value };
}

/** A dotted path's value in a section's document. */
function leafOf(doc: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      doc,
    );
}

function withLeaf(
  doc: Record<string, unknown>,
  path: string,
  value: string,
): Record<string, unknown> {
  const next = structuredClone(doc);
  const keys = path.split(".");
  let node = next;
  for (const key of keys.slice(0, -1)) {
    const child = node[key];
    if (!child || typeof child !== "object") throw new Moved();
    node = child as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
  return next;
}

/**
 * A decision's own date (`applied_at` where no translation is dated,
 * `decided_at`): the transaction's `now()`, to the millisecond, as the
 * editors' saves keep dates (a JS `Date`).
 */
const appliedStamp = () => sql`date_trunc('milliseconds', now())`;

/**
 * The date a write gives a translation: now, to the millisecond, and always
 * after the one it has. Two applies on one row in the same millisecond (a
 * batch) would otherwise share a date, and a revert of the first, finding its
 * date still on the row, would take the second's date back.
 */
const nextStamp = () =>
  sql`date_trunc('milliseconds', greatest(now(), updated_at + interval '1 millisecond'))`;

/**
 * The date a revert gives a translation: the one from before the apply while
 * the row still has the apply's (nothing else in it changed since); else a
 * new one. Compared and copied in SQL, microseconds and all.
 */
const revertedStamp = (id: string) =>
  sql`case when updated_at = (select ap.applied_at from ${aiProposals} as ap where ap.id = ${id})
    then coalesce((select ap.stamped_before from ${aiProposals} as ap where ap.id = ${id}), ${nextStamp()})
    else ${nextStamp()} end`;

/** An image's alt text in one language, compare-and-set. */
async function swapAlt(tx: Tx, p: Proposal, expected: string, next: string): Promise<void> {
  const en = p.locale === "en";
  const column = en ? mediaAssets.altEn : mediaAssets.altDe;
  const rows = await tx
    .update(mediaAssets)
    .set(en ? { altEn: next } : { altDe: next })
    .where(and(eq(mediaAssets.id, p.entityId), sql`coalesce(${column}, '') = ${expected}`))
    .returning({ id: mediaAssets.id });
  if (!rows.length) throw new Moved();
}

/** A section's leaf in one language, inside `saveSection`'s row lock (its token moves). */
async function swapLeaf(
  tx: Tx,
  p: Proposal,
  expected: string,
  next: string,
  adminId: string,
): Promise<void> {
  const locale = p.locale as Locale;
  const other: Locale = locale === "en" ? "de" : "en";
  await saveSection(
    tx,
    p.entityId,
    (current) => {
      const doc = current[locale];
      if (!doc || typeof doc !== "object" || !(other in current)) throw new Moved();
      if ((leafOf(doc, p.field) ?? "") !== expected) throw new Moved();
      return {
        [locale]: withLeaf(doc as Record<string, unknown>, p.field, next),
        [other]: current[other],
      } as Record<Locale, unknown>;
    },
    null,
    adminId,
  );
}

/**
 * One text column of an entity's translation, compare-and-set. Its date moves
 * with an apply, as an editor's save moves it (the date before kept on the
 * proposal); a revert puts the earlier one back (`revertedStamp`). Returns
 * the apply's date for the proposal (`applied_at`): the row's own, copied in
 * SQL, where the row is dated.
 */
async function swapText(
  tx: Tx,
  p: Proposal & { kind: keyof typeof TABLES },
  expected: string,
  next: string,
  mode: "apply" | "revert",
): Promise<SQL> {
  const locale = p.locale as Locale;
  const { texts, owner, stamped } = TABLES[p.kind];
  if (!TEXT_FIELDS[p.kind].fields.includes(p.field)) throw new Moved();
  const column = (texts as unknown as Record<string, AnyColumn>)[p.field]!;
  const row = sql`from ${texts} as t
    where t.${sql.identifier(owner.name)} = ${p.entityId} and t.locale = ${locale}`;
  if (stamped && mode === "apply") {
    // The row locked first: an editor's save cannot land between reading its date here and
    // the write below, so the date kept for a revert is the one this apply replaces.
    await tx.execute(sql`select 1 ${row} for update of t`);
    await tx
      .update(aiProposals)
      .set({ stampedBefore: sql`(select t.updated_at ${row})` })
      .where(eq(aiProposals.id, p.id));
  }
  const stamp = mode === "apply" ? nextStamp() : revertedStamp(p.id);
  const rows = await tx
    .update(texts)
    // One text column of a translations table, checked against `TEXT_FIELDS` above.
    .set({ [p.field]: next, ...(stamped ? { updatedAt: stamp } : {}) } as never)
    .where(and(eq(owner, p.entityId), eq(texts.locale, locale), eq(column, expected)))
    .returning({ id: owner });
  if (!rows.length) throw new Moved();
  return stamped ? sql`(select t.updated_at ${row})` : appliedStamp();
}

/**
 * Writes `next` into the proposal's field if it still holds `expected`; throws
 * `Moved` otherwise. The check and the write are one statement (or, for a
 * section, one row lock), so an edit landing in between is never overwritten.
 * Returns the date the apply is recorded with (`applied_at`).
 */
async function swap(
  tx: Tx,
  p: Proposal,
  expected: string,
  next: string,
  adminId: string,
  mode: "apply" | "revert",
): Promise<SQL> {
  if (p.kind === "media") {
    await swapAlt(tx, p, expected, next);
    return appliedStamp();
  }
  if (p.kind === "section") {
    await swapLeaf(tx, p, expected, next, adminId);
    return appliedStamp();
  }
  return swapText(tx, { ...p, kind: p.kind }, expected, next, mode);
}

/** The proposal, locked for this decision. */
async function locked(tx: Tx, id: string): Promise<Proposal | null> {
  const [row] = await tx.select().from(aiProposals).where(eq(aiProposals.id, id)).for("update");
  return row ?? null;
}

async function settle(
  tx: Tx,
  id: string,
  change: PgUpdateSetSource<typeof aiProposals>,
): Promise<Proposal> {
  const [row] = await tx
    .update(aiProposals)
    .set({ ...change, updatedAt: new Date() })
    .where(eq(aiProposals.id, id))
    .returning();
  return row!;
}

/**
 * Applies a proposal: the admin's text, or its draft. The field must still
 * hold `before`; else the proposal turns stale and nothing is written.
 */
export async function applyProposal(id: string, adminId: string, text?: string): Promise<Decided> {
  const outcome = await getDb().transaction(async (tx) => {
    const p = await locked(tx, id);
    if (!p) return { ok: false as const, error: "not_found" as const };
    if (!isOpen(p)) return { ok: false as const, error: "not_open" as const };
    const wanted = text ?? p.after;
    if (wanted === null) return { ok: false as const, error: "no_text" as const };
    const value = checked(p, wanted);
    if (!value.ok)
      return { ok: false as const, error: "invalid_input" as const, issues: value.issues };
    let at: SQL;
    try {
      at = await swap(tx, p, p.before, value.text, adminId, "apply");
    } catch (error) {
      if (!(error instanceof Moved)) throw error;
      const stale = await settle(tx, id, { status: "stale", stampedBefore: null });
      await audit(
        {
          actor: "admin",
          action: "agent.apply",
          target: id,
          decision: "denied",
          reason: `${p.label}: the field changed since the draft; nothing was overwritten`,
        },
        tx,
      );
      return { ok: false as const, error: "stale" as const, stale };
    }
    // The translation's new date (`swap`), to the microsecond: a revert compares the two.
    const applied = await settle(tx, id, {
      status: "applied",
      after: value.text,
      appliedAt: at,
      decidedAt: at,
    });
    await audit(
      {
        actor: "admin",
        action: "agent.apply",
        target: id,
        decision: "allowed",
        reason: `${p.label}${text === undefined ? "" : " (edited)"}`,
      },
      tx,
    );
    return { ok: true as const, proposal: applied, draft: p.after, wanted };
  });

  if (outcome.ok) {
    // Judged on what the admin sent, before sanitizing: a draft applied as it was is kept,
    // even where the sanitizer rewrites its markup (`&` → `&amp;`).
    if (outcome.draft !== null)
      await decideUse(outcome.proposal.useId, verdictOn(outcome.draft, outcome.wanted));
    return { ok: true, proposal: outcome.proposal };
  }
  if (outcome.error === "stale") {
    // Never used: the draft goes with the gap it was for.
    await decideUse(outcome.stale.useId, { outcome: "discarded", distance: null });
    return { ok: false, error: "stale" };
  }
  return outcome;
}

/** Rejects a proposal: nothing is written to the content. */
export async function rejectProposal(id: string): Promise<Decided> {
  const outcome = await getDb().transaction(async (tx) => {
    const p = await locked(tx, id);
    if (!p) return { ok: false as const, error: "not_found" as const };
    if (!isOpen(p)) return { ok: false as const, error: "not_open" as const };
    const rejected = await settle(tx, id, { status: "rejected", decidedAt: new Date() });
    await audit(
      { actor: "admin", action: "agent.reject", target: id, decision: "allowed", reason: p.label },
      tx,
    );
    return { ok: true as const, proposal: rejected };
  });
  if (outcome.ok) await decideUse(outcome.proposal.useId, { outcome: "discarded", distance: null });
  return outcome;
}

/**
 * Reverts an applied proposal: `before` goes back while the field still holds
 * what was applied. A field edited since stays as it is (`changed_since`).
 * The skill use keeps its verdict: the draft was used; the audit has the revert.
 */
export async function revertProposal(id: string, adminId: string): Promise<Decided> {
  return getDb().transaction(async (tx) => {
    const p = await locked(tx, id);
    if (!p) return { ok: false as const, error: "not_found" as const };
    if (p.status !== "applied" || p.after === null) {
      return { ok: false as const, error: "not_applied" as const };
    }
    try {
      await swap(tx, p, p.after, p.before, adminId, "revert");
    } catch (error) {
      if (!(error instanceof Moved)) throw error;
      await audit(
        {
          actor: "admin",
          action: "agent.revert",
          target: id,
          decision: "denied",
          reason: `${p.label}: the field changed since it was applied; left as it is`,
        },
        tx,
      );
      return { ok: false as const, error: "changed_since" as const };
    }
    const reverted = await settle(tx, id, { status: "reverted", revertedAt: new Date() });
    await audit(
      { actor: "admin", action: "agent.revert", target: id, decision: "allowed", reason: p.label },
      tx,
    );
    return { ok: true as const, proposal: reverted };
  });
}
