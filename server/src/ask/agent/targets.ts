import { asc, desc } from "drizzle-orm";
import { z } from "zod";

import {
  experienceTranslationInput,
  postTranslationInput,
  projectTranslationInput,
  skillTranslationInput,
} from "../../content/admin-schema.js";
import { isEmpty } from "../../content/i18n-status.js";
import type { Locale } from "../../content/schema.js";
import { getDb } from "../../db/client.js";
import {
  contentDocuments,
  experiences,
  experienceTranslations,
  mediaAssets,
  posts,
  postTranslations,
  projects,
  projectTranslations,
  skills,
  skillTranslations,
} from "../../db/schema.js";

/**
 * The content agent's plan (plan phase 29): the gaps in the draft content a
 * skill can fill, read from the editors' own tables with no model. Each gap is
 * a target, keyed `goal|kind|id|field|locale`; a run lists the keys, and its
 * work reads each target again before drafting it (`readTarget`), so one
 * filled meanwhile is stale and costs nothing.
 */

export const CONTENT_GOALS = ["translations", "alt", "seo"] as const;
export type ContentGoal = (typeof CONTENT_GOALS)[number];

/** In the order a run takes them: site-wide copy first, images last. */
export const TARGET_KINDS = ["section", "project", "experience", "skill", "post", "media"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** Where a draft goes. */
export interface TargetRef {
  goal: ContentGoal;
  kind: TargetKind;
  /** The row's id; a section's name; the image's id. */
  entityId: string;
  /** A column; a section's dotted path; `alt` for an image. */
  field: string;
  /** The language the draft is written in. */
  locale: Locale;
}

/** A target as the content reads now. */
export interface Target extends TargetRef {
  key: string;
  /** What the admin reads: "Atlas · Hook (DE)". */
  label: string;
  /** The field's text now: what a proposal records as `before`. */
  current: string;
  /** What the draft is made from: the other language's text, or the page's (seo); null for an image. */
  source: string | null;
  /** The field's own limit, from the schema its editor saves through; null without one. */
  maxLength: number | null;
  /** Still a gap: false once filled, so the item is stale. */
  gap: boolean;
}

/** A search description longer than this is drafted again (search results cut it). */
export const SEO_LONG = 160;

const overLong = (description: string) => description.trim().length > SEO_LONG;

const LOCALES = ["en", "de"] as const satisfies readonly Locale[];
const otherOf = (locale: Locale): Locale => (locale === "en" ? "de" : "en");

export const targetKey = (ref: TargetRef): string =>
  [ref.goal, ref.kind, ref.entityId, ref.field, ref.locale].join("|");

/** A run item's key back as its target, or null when it is not one. */
export function parseKey(key: string): TargetRef | null {
  const [goal, kind, entityId, field, locale, ...rest] = key.split("|");
  if (rest.length || !entityId || !field) return null;
  if (!CONTENT_GOALS.includes(goal as ContentGoal)) return null;
  if (!TARGET_KINDS.includes(kind as TargetKind)) return null;
  if (locale !== "en" && locale !== "de") return null;
  return { goal: goal as ContentGoal, kind: kind as TargetKind, entityId, field, locale };
}

type EntityKind = "project" | "experience" | "skill" | "post";

/**
 * The text fields translated per kind, as their editors' schema has them.
 * Lists (outcomes, metrics, highlights) are left out: their items have no
 * field of their own to propose into.
 */
export const TEXT_FIELDS: Record<EntityKind, { schema: z.ZodObject; fields: readonly string[] }> = {
  project: {
    schema: projectTranslationInput,
    fields: [
      "name",
      "descriptor",
      "hook",
      "role",
      "categoryLabel",
      "problem",
      "aiArchitecture",
      "fullStackInfra",
      "body",
      "seoDescription",
    ],
  },
  experience: { schema: experienceTranslationInput, fields: ["title", "summary"] },
  skill: { schema: skillTranslationInput, fields: ["title", "caption", "narrative"] },
  post: {
    schema: postTranslationInput,
    fields: ["title", "excerpt", "body", "seoTitle", "seoDescription"],
  },
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  descriptor: "Descriptor",
  hook: "Hook",
  role: "Role",
  categoryLabel: "Category label",
  problem: "Problem",
  aiArchitecture: "AI architecture",
  fullStackInfra: "Full-stack and infrastructure",
  body: "Body",
  seoDescription: "Search description",
  title: "Title",
  summary: "Summary",
  caption: "Caption",
  narrative: "Narrative",
  excerpt: "Excerpt",
  seoTitle: "Search title",
  alt: "Alt text",
};

/** The page text a search description is drawn from, per kind (the editors' Suggest reads the same). */
const PAGE_FIELDS: Partial<Record<EntityKind, readonly string[]>> = {
  project: ["name", "descriptor", "hook", "problem", "aiArchitecture", "fullStackInfra", "body"],
  post: ["title", "excerpt", "body"],
};

const SECTIONS = [
  { section: "ui", label: "Site copy" },
  { section: "seo", label: "SEO & meta" },
] as const;

/** SEO leaves that are addresses or codes, not text: a translation has nothing to do there. */
const NOT_TEXT = new Set([
  "seo:canonical",
  "seo:ogImage",
  "seo:ogUrl",
  "seo:ogLocale",
  "seo:twitterCard",
  "seo:twitterImage",
]);

/** A field's limit in the schema its editor saves through, defaults and options unwrapped. */
function limitOf(schema: z.ZodObject, field: string): number | null {
  let type: unknown = schema.shape[field];
  while (
    type instanceof z.ZodDefault ||
    type instanceof z.ZodOptional ||
    type instanceof z.ZodNullable
  ) {
    type = type.unwrap();
  }
  return type instanceof z.ZodString ? type.maxLength : null;
}

/** `a.b.c` for every string leaf of a section's tree. */
function leaves(
  value: unknown,
  path = "",
  out: Record<string, string> = {},
): Record<string, string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      leaves(child, path ? `${path}.${key}` : key, out);
    }
  } else if (typeof value === "string") {
    out[path] = value;
  }
  return out;
}

type Texts = Partial<Record<Locale, Record<string, unknown>>>;

/** The draft content the plan and each item read: small enough to read whole. */
interface Content {
  sections: {
    section: string;
    label: string;
    texts: Partial<Record<Locale, Record<string, string>>>;
  }[];
  entities: { kind: EntityKind; id: string; name: string; texts: Texts }[];
  media: { id: string; name: string; alt: Record<Locale, string> }[];
}

async function loadContent(): Promise<Content> {
  const db = getDb();
  const [
    documents,
    projectRows,
    projectTexts,
    experienceRows,
    experienceTexts,
    skillRows,
    skillTexts,
    postRows,
    postTexts,
    mediaRows,
  ] = await Promise.all([
    db.select().from(contentDocuments),
    db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .orderBy(asc(projects.position)),
    db.select().from(projectTranslations),
    db
      .select({ id: experiences.id, orgName: experiences.orgName })
      .from(experiences)
      .orderBy(asc(experiences.position)),
    db.select().from(experienceTranslations),
    db.select({ id: skills.id }).from(skills).orderBy(asc(skills.position)),
    db.select().from(skillTranslations),
    db
      .select({ id: posts.id, slug: posts.slug })
      .from(posts)
      .orderBy(desc(posts.publishedAt), asc(posts.slug)),
    db.select().from(postTranslations),
    db
      .select({
        id: mediaAssets.id,
        name: mediaAssets.originalName,
        kind: mediaAssets.kind,
        altEn: mediaAssets.altEn,
        altDe: mediaAssets.altDe,
      })
      .from(mediaAssets)
      .orderBy(asc(mediaAssets.createdAt)),
  ]);

  const textsOf = <R extends { locale: Locale }>(rows: R[]): Texts =>
    Object.fromEntries(rows.map((row) => [row.locale, row as Record<string, unknown>]));
  const titleOf = (texts: Texts, key: string, fallback: string) => {
    const en = texts.en?.[key];
    const de = texts.de?.[key];
    return (
      (typeof en === "string" && en.trim()) || (typeof de === "string" && de.trim()) || fallback
    );
  };

  const entities: Content["entities"] = [
    ...projectRows.map((p) => {
      const texts = textsOf(projectTexts.filter((t) => t.projectId === p.id));
      return { kind: "project" as const, id: p.id, name: titleOf(texts, "name", p.slug), texts };
    }),
    ...experienceRows.map((e) => {
      const texts = textsOf(experienceTexts.filter((t) => t.experienceId === e.id));
      const title = titleOf(texts, "title", "");
      return {
        kind: "experience" as const,
        id: e.id,
        name: title ? `${title} · ${e.orgName}` : e.orgName,
        texts,
      };
    }),
    ...skillRows.map((s) => {
      const texts = textsOf(skillTexts.filter((t) => t.skillId === s.id));
      return { kind: "skill" as const, id: s.id, name: titleOf(texts, "title", s.id), texts };
    }),
    ...postRows.map((p) => {
      const texts = textsOf(postTexts.filter((t) => t.postId === p.id));
      return { kind: "post" as const, id: p.id, name: titleOf(texts, "title", p.slug), texts };
    }),
  ];

  return {
    sections: SECTIONS.map(({ section, label }) => ({
      section,
      label,
      texts: Object.fromEntries(
        documents.filter((d) => d.section === section).map((d) => [d.locale, leaves(d.data)]),
      ),
    })),
    entities,
    media: mediaRows
      .filter((m) => m.kind === "image")
      .map((m) => ({ id: m.id, name: m.name, alt: { en: m.altEn ?? "", de: m.altDe ?? "" } })),
  };
}

const textOf = (texts: Record<string, unknown> | undefined, field: string): string => {
  const value = texts?.[field];
  return typeof value === "string" ? value : "";
};

const whereOf = (ref: TargetRef): string =>
  `${FIELD_LABELS[ref.field] ?? ref.field} (${ref.locale.toUpperCase()})`;

type TargetBase = Omit<Target, "source" | "gap">;

/** An image's alt text. */
function describeAlt(ref: TargetRef, content: Content, key: string): Target | null {
  const asset = content.media.find((m) => m.id === ref.entityId);
  if (ref.kind !== "media" || ref.field !== "alt" || !asset) return null;
  const current = asset.alt[ref.locale];
  return {
    ...ref,
    key,
    label: `${asset.name} · ${whereOf(ref)}`,
    current,
    source: null,
    maxLength: null,
    gap: !current.trim(),
  };
}

/** A site-wide copy leaf, translated from the other language. */
function describeSection(ref: TargetRef, content: Content, key: string): Target | null {
  const section = content.sections.find((s) => s.section === ref.entityId);
  const texts = section?.texts[ref.locale];
  if (
    ref.goal !== "translations" ||
    !section ||
    !texts ||
    NOT_TEXT.has(`${section.section}:${ref.field}`)
  )
    return null;
  const source = section.texts[otherOf(ref.locale)]?.[ref.field] ?? "";
  const current = texts[ref.field] ?? "";
  return {
    ...ref,
    key,
    label: `${section.label} · ${ref.field} (${ref.locale.toUpperCase()})`,
    current,
    source,
    maxLength: null,
    gap: isEmpty(current) && !isEmpty(source),
  };
}

/** An entity's field, filled from the other language. */
function translationTarget(base: TargetBase, theirs: Texts[Locale]): Target {
  const source = theirs ? textOf(theirs, base.field) : "";
  const gap = !!theirs && isEmpty(base.current) && !isEmpty(source);
  if (base.field !== "seoDescription") return { ...base, source, gap };
  // A search description is translated within what search results show; an over-long
  // one is the seo goal's to draft again, from the page, not to carry into a language.
  return {
    ...base,
    source,
    maxLength: Math.min(base.maxLength ?? SEO_LONG, SEO_LONG),
    gap: gap && !overLong(source),
  };
}

/** An entity's search description: the page's own text in this language, where it has some. */
function seoTarget(
  base: TargetBase,
  entity: Content["entities"][number],
  mine: Record<string, unknown>,
  theirs: Texts[Locale],
  goals: readonly ContentGoal[],
): Target | null {
  const pageFields = PAGE_FIELDS[entity.kind];
  if (base.field !== "seoDescription" || !pageFields) return null;
  const page = pageFields
    .map((f) => textOf(mine, f))
    .filter((t) => !isEmpty(t))
    .join("\n\n");
  // An empty one the other language has (within the limit) is the translation's to fill,
  // when the run translates too.
  const other = textOf(theirs, base.field);
  const leftToTranslation =
    goals.includes("translations") && isEmpty(base.current) && !isEmpty(other) && !overLong(other);
  const due = isEmpty(base.current) || overLong(base.current);
  return { ...base, source: page, gap: !!page && due && !leftToTranslation };
}

/** A project, experience, skill or post field. */
function describeEntity(
  ref: TargetRef,
  content: Content,
  goals: readonly ContentGoal[],
  key: string,
): Target | null {
  const entity = content.entities.find((e) => e.kind === ref.kind && e.id === ref.entityId);
  const mine = entity?.texts[ref.locale];
  // An entity gone, or with no text in this language at all (a post in one language only).
  if (!entity || !mine || !TEXT_FIELDS[entity.kind].fields.includes(ref.field)) return null;
  const theirs = entity.texts[otherOf(ref.locale)];
  const base: TargetBase = {
    ...ref,
    key,
    label: `${entity.name} · ${whereOf(ref)}`,
    current: textOf(mine, ref.field),
    maxLength: limitOf(TEXT_FIELDS[entity.kind].schema, ref.field),
  };
  return ref.goal === "translations"
    ? translationTarget(base, theirs)
    : seoTarget(base, entity, mine, theirs, goals);
}

/** A target as `content` has it, or null when its entity, language or field is gone. */
function describe(ref: TargetRef, content: Content, goals: readonly ContentGoal[]): Target | null {
  const key = targetKey(ref);
  if (ref.goal === "alt") return describeAlt(ref, content, key);
  if (ref.kind === "section") return describeSection(ref, content, key);
  return describeEntity(ref, content, goals, key);
}

/** Every place a goal could have a gap, in the run's order. */
function candidates(goal: ContentGoal, content: Content): TargetRef[] {
  const both = (ref: Omit<TargetRef, "locale">): TargetRef[] =>
    LOCALES.map((locale) => ({ ...ref, locale }));
  if (goal === "alt") {
    return content.media.flatMap((m) =>
      both({ goal, kind: "media", entityId: m.id, field: "alt" }),
    );
  }
  const entities = TARGET_KINDS.flatMap((kind) => content.entities.filter((e) => e.kind === kind));
  if (goal === "seo") {
    return entities
      .filter((e) => PAGE_FIELDS[e.kind])
      .flatMap((e) => both({ goal, kind: e.kind, entityId: e.id, field: "seoDescription" }));
  }
  return [
    ...content.sections.flatMap((s) => {
      const fields = [...new Set(LOCALES.flatMap((locale) => Object.keys(s.texts[locale] ?? {})))];
      return fields.flatMap((field) => both({ goal, kind: "section", entityId: s.section, field }));
    }),
    ...entities.flatMap((e) =>
      TEXT_FIELDS[e.kind].fields.flatMap((field) =>
        both({ goal, kind: e.kind, entityId: e.id, field }),
      ),
    ),
  ];
}

/**
 * The gaps the goals ask for, in the run's order (goal by goal as given, then
 * by kind, then the content's own order), at most `maxItems`.
 */
export async function contentTargets(
  goals: readonly ContentGoal[],
  maxItems: number,
): Promise<Target[]> {
  const content = await loadContent();
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const goal of goals) {
    for (const ref of candidates(goal, content)) {
      const target = describe(ref, content, goals);
      if (!target?.gap || seen.has(target.key)) continue;
      seen.add(target.key);
      targets.push(target);
      if (targets.length === maxItems) return targets;
    }
  }
  return targets;
}

/** A run item's target as the content reads now; null when it is gone or not a target. */
export async function readTarget(
  key: string,
  goals: readonly ContentGoal[],
): Promise<Target | null> {
  const ref = parseKey(key);
  return ref ? describe(ref, await loadContent(), goals) : null;
}

/** Several targets as the content reads now, from one read of it, by key; one gone is left out. */
export async function readTargets(
  keys: readonly string[],
  goals: readonly ContentGoal[],
): Promise<Map<string, Target>> {
  const found = new Map<string, Target>();
  if (!keys.length) return found;
  const content = await loadContent();
  for (const key of keys) {
    const ref = parseKey(key);
    const target = ref ? describe(ref, content, goals) : null;
    if (target) found.set(key, target);
  }
  return found;
}
