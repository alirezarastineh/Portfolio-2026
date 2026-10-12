import { asc } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { experiences, posts, projects, projectTranslations } from "../../db/schema.js";

/** At most this many terms, each at most this long: what the translate skill takes. */
export const GLOSSARY_MAX = 80;
export const TERM_MAX = 60;

/**
 * The portfolio's names and terms, for a translation to keep as they are
 * (plan phase 29): project names in either language, employers, the stack and
 * the tags, each once (case aside), in that order, at most `GLOSSARY_MAX`.
 */
export async function contentGlossary(): Promise<string[]> {
  const db = getDb();
  const [projectRows, names, orgs, postRows] = await Promise.all([
    db
      .select({ stack: projects.stack, tags: projects.tags })
      .from(projects)
      .orderBy(asc(projects.position)),
    db.select({ name: projectTranslations.name }).from(projectTranslations),
    db
      .select({ orgName: experiences.orgName })
      .from(experiences)
      .orderBy(asc(experiences.position)),
    db.select({ tags: posts.tags }).from(posts),
  ]);
  const listOf = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const terms = [
    ...names.map((r) => r.name),
    ...orgs.map((r) => r.orgName),
    ...projectRows.flatMap((r) => listOf(r.stack)),
    ...projectRows.flatMap((r) => listOf(r.tags)),
    ...postRows.flatMap((r) => listOf(r.tags)),
  ];
  const seen = new Set<string>();
  const glossary: string[] = [];
  for (const term of terms) {
    const t = term.trim();
    if (!t || t.length > TERM_MAX || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    glossary.push(t);
    if (glossary.length === GLOSSARY_MAX) break;
  }
  return glossary;
}
