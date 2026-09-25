import { asc, eq, inArray } from "drizzle-orm";

import {
  aiFaq,
  aiFaqTranslations,
  contentDocuments,
  experiences,
  experienceTranslations,
  postTranslations,
  posts,
  projectTranslations,
  projects,
  skillTranslations,
  skills,
} from "../db/schema.js";
import type { DbExecutor } from "./build.js";
import type { Locale } from "./schema.js";

export type I18nKind = "project" | "experience" | "post" | "skill" | "faq" | "section";

/** One thing that exists in both languages, and how far the German lags. */
export interface I18nItem {
  kind: I18nKind;
  /** Slug, id or section name — what the admin links to. */
  id: string;
  label: string;
  /** Fields with English text but an empty German one. */
  missingDe: string[];
  /** Fields with German text but an empty English one. */
  missingEn: string[];
  /** The English text was saved after the German one last changed. */
  stale: boolean;
  /** A language this item does not exist in at all (a post, an FAQ entry). */
  absent: Locale | null;
}

/**
 * Edits land in the same second when both languages are saved together; only
 * a real gap means one language moved on without the other.
 */
const STALE_AFTER_MS = 1_000;

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.every((item) => isEmpty(item));
  if (typeof value === "string") {
    // Rich text: `<p></p>` is empty too.
    return (
      value
        .replace(/<[^<>]*>/g, "")
        .replaceAll("&nbsp;", " ")
        .trim() === ""
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => isEmpty(item));
  }
  return value === null || value === undefined;
}

type Row = Record<string, unknown> & { locale: Locale; updatedAt?: Date };

function compare(
  kind: I18nKind,
  id: string,
  label: string,
  rows: Row[],
  fields: string[],
): I18nItem | null {
  const en = rows.find((r) => r.locale === "en");
  const de = rows.find((r) => r.locale === "de");
  if (!en && !de) return null;
  if (!en || !de) {
    return {
      kind,
      id,
      label,
      missingDe: [],
      missingEn: [],
      stale: false,
      absent: en ? "de" : "en",
    };
  }

  const missingDe = fields.filter((f) => !isEmpty(en[f]) && isEmpty(de[f]));
  const missingEn = fields.filter((f) => isEmpty(en[f]) && !isEmpty(de[f]));
  const stale =
    en.updatedAt instanceof Date &&
    de.updatedAt instanceof Date &&
    en.updatedAt.getTime() - de.updatedAt.getTime() > STALE_AFTER_MS;

  if (missingDe.length === 0 && missingEn.length === 0 && !stale) return null;
  return { kind, id, label, missingDe, missingEn, stale, absent: null };
}

const PROJECT_FIELDS = [
  "name",
  "descriptor",
  "hook",
  "role",
  "categoryLabel",
  "problem",
  "aiArchitecture",
  "fullStackInfra",
  "outcomes",
  "metrics",
  "body",
  "seoDescription",
];
const EXPERIENCE_FIELDS = ["title", "summary", "highlights"];
const POST_FIELDS = ["title", "excerpt", "body", "seoTitle", "seoDescription"];
const SKILL_FIELDS = ["title", "caption", "narrative"];
const LEGAL_FIELDS = ["title", "body"];

/** The same section documents the editors write; `ui` and `seo` are whole trees. */
const SECTIONS: { section: string; label: string; fields: string[] | null }[] = [
  { section: "ui", label: "Site copy", fields: null },
  { section: "seo", label: "SEO & meta", fields: null },
  { section: "imprint", label: "Imprint", fields: LEGAL_FIELDS },
  { section: "privacy", label: "Privacy policy", fields: LEGAL_FIELDS },
];

/** `a.b.c` for every string leaf, so a tree compares field by field. */
function leaves(
  value: unknown,
  path = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      leaves(child, path ? `${path}.${key}` : key, out);
    }
  } else {
    out[path] = value;
  }
  return out;
}

/**
 * Everything whose German (or English) text is empty where the other language
 * has some, or whose German was last edited before the English changed. Only
 * the problems — a fully translated item is not listed.
 */
export async function i18nStatus(db: DbExecutor): Promise<I18nItem[]> {
  const items: I18nItem[] = [];
  const push = (item: I18nItem | null) => {
    if (item) items.push(item);
  };

  for (const { section, label, fields } of SECTIONS) {
    const rows = await db
      .select({
        locale: contentDocuments.locale,
        data: contentDocuments.data,
        updatedAt: contentDocuments.updatedAt,
      })
      .from(contentDocuments)
      .where(eq(contentDocuments.section, section));
    const flat = rows.map((r) => ({
      ...(fields ? (r.data as Record<string, unknown>) : leaves(r.data)),
      locale: r.locale,
      updatedAt: r.updatedAt,
    }));
    const keys =
      fields ??
      [...new Set(flat.flatMap((r) => Object.keys(r)))].filter(
        (k) => k !== "locale" && k !== "updatedAt",
      );
    push(compare("section", section, label, flat, keys));
  }

  const projectRows = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .orderBy(asc(projects.position));
  const projectTexts = projectRows.length
    ? await db
        .select()
        .from(projectTranslations)
        .where(
          inArray(
            projectTranslations.projectId,
            projectRows.map((p) => p.id),
          ),
        )
    : [];
  for (const project of projectRows) {
    const rows = projectTexts.filter((t) => t.projectId === project.id);
    const name = rows.find((r) => r.locale === "en")?.name ?? project.slug;
    push(compare("project", project.slug, name, rows, PROJECT_FIELDS));
  }

  const experienceRows = await db
    .select({ id: experiences.id, orgName: experiences.orgName })
    .from(experiences)
    .orderBy(asc(experiences.position));
  const experienceTexts = await db.select().from(experienceTranslations);
  for (const entry of experienceRows) {
    const rows = experienceTexts.filter((t) => t.experienceId === entry.id);
    const title = rows.find((r) => r.locale === "en")?.title;
    push(
      compare(
        "experience",
        entry.id,
        title ? `${title} · ${entry.orgName}` : entry.orgName,
        rows,
        EXPERIENCE_FIELDS,
      ),
    );
  }

  const postRows = await db.select({ id: posts.id, slug: posts.slug }).from(posts);
  const postTexts = await db.select().from(postTranslations);
  for (const post of postRows) {
    const rows = postTexts.filter((t) => t.postId === post.id);
    const title = rows.find((r) => r.locale === "en")?.title ?? rows[0]?.title ?? post.slug;
    push(compare("post", post.slug, title, rows, POST_FIELDS));
  }

  // No per-locale timestamps here: empty fields only.
  const skillRows = await db.select({ id: skills.id }).from(skills).orderBy(asc(skills.position));
  const skillTexts = await db.select().from(skillTranslations);
  for (const skill of skillRows) {
    const rows = skillTexts.filter((t) => t.skillId === skill.id);
    const title = rows.find((r) => r.locale === "en")?.title ?? skill.id;
    push(compare("skill", skill.id, title, rows, SKILL_FIELDS));
  }

  // Saved as a whole (both languages rewritten), so empty fields and absence only.
  const faqRows = await db.select({ id: aiFaq.id }).from(aiFaq).orderBy(asc(aiFaq.position));
  const faqTexts = await db.select().from(aiFaqTranslations);
  for (const faq of faqRows) {
    const rows = faqTexts
      .filter((t) => t.faqId === faq.id)
      .map((t) => ({ locale: t.locale, question: t.question, answer: t.answer }));
    const question = rows.find((r) => r.locale === "en")?.question ?? rows[0]?.question ?? faq.id;
    push(compare("faq", faq.id, question, rows, ["question", "answer"]));
  }

  return items;
}
