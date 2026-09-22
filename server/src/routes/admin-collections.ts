import { asc, eq, inArray, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { sanitizeRichText } from "../content/sanitize.js";
import {
  bentoSpanSchema,
  LOCALES,
  skillIconSchema,
  socialIconSchema,
} from "../content/schema.js";
import { getDb } from "../db/client.js";
import {
  projectTranslations,
  projects,
  siteProfile,
  skillTranslations,
  skills,
  socials,
} from "../db/schema.js";

const nonEmpty = z.string().min(1);

/** Wraps a per-locale payload so every write carries both languages. */
function perLocale<T extends z.ZodType>(schema: T) {
  return z.object({ en: schema, de: schema });
}

const socialInput = z.object({
  label: nonEmpty.max(60),
  href: nonEmpty.max(500),
  icon: socialIconSchema,
  isVisible: z.boolean().default(true),
});

const skillTranslationInput = z.object({
  title: nonEmpty.max(120),
  caption: z.string().max(160),
  narrative: z.string().max(2000),
});

const skillInput = z.object({
  id: nonEmpty.max(80).regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  icon: skillIconSchema,
  span: bentoSpanSchema,
  items: z.array(nonEmpty.max(60)).max(40),
  isVisible: z.boolean().default(true),
  translations: perLocale(skillTranslationInput),
});

/** Rich-text fields are sanitized as they are parsed, so nothing downstream
 * can forget to do it. */
const rich = z.string().max(20000).transform(sanitizeRichText);

const projectTranslationInput = z.object({
  name: nonEmpty.max(160),
  descriptor: z.string().max(200),
  hook: z.string().max(600),
  problem: rich,
  aiArchitecture: rich,
  fullStackInfra: rich,
  outcomes: z.array(z.string().max(400)).max(20),
});

const projectInput = z.object({
  slug: nonEmpty.max(80).regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  /** Set when the image came from the media library; null for a legacy path. */
  imageId: z.uuid().nullable().default(null),
  imagePath: z.string().max(500),
  stack: z.array(nonEmpty.max(60)).max(40),
  linkLive: z.string().max(500),
  linkRepo: z.string().max(500),
  linkCaseStudy: z.string().max(500),
  isVisible: z.boolean().default(true),
  translations: perLocale(projectTranslationInput),
});

const reorderInput = z.object({ ids: z.array(z.string().min(1)).max(200) });

const profileInput = z.object({
  name: nonEmpty.max(120),
  handle: nonEmpty.max(80),
  contactEmail: z.email().max(200),
  primaryCtaHref: nonEmpty.max(300),
  secondaryCtaHref: nonEmpty.max(300),
});

export const adminCollectionsRouter = new Hono();

async function readJson<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "invalid_input" }, 400) };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json({ error: "invalid_input", issues: parsed.error.issues }, 400),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Appends to the end of the list rather than colliding with an existing slot. */
async function nextPosition(table: typeof socials | typeof skills | typeof projects) {
  const [row] = await getDb()
    .select({ max: sql<number | null>`max(${table.position})` })
    .from(table);
  return (row?.max ?? -1) + 1;
}

/* -------------------------------------------------------------------------- */
/* Site profile (locale-invariant identity)                                    */
/* -------------------------------------------------------------------------- */

adminCollectionsRouter.get("/profile", async (c) => {
  const [row] = await getDb().select().from(siteProfile).limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ profile: row });
});

adminCollectionsRouter.put("/profile", async (c) => {
  const parsed = await readJson(c, profileInput);
  if (!parsed.ok) return parsed.response;

  await getDb()
    .update(siteProfile)
    .set({ ...parsed.data, updatedAt: new Date(), updatedBy: c.get("session").userId })
    .where(eq(siteProfile.id, true));

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Socials                                                                     */
/* -------------------------------------------------------------------------- */

adminCollectionsRouter.get("/socials", async (c) => {
  const rows = await getDb()
    .select()
    .from(socials)
    .orderBy(asc(socials.position), asc(socials.id));
  return c.json({ socials: rows });
});

adminCollectionsRouter.post("/socials", async (c) => {
  const parsed = await readJson(c, socialInput);
  if (!parsed.ok) return parsed.response;

  const [row] = await getDb()
    .insert(socials)
    .values({ ...parsed.data, position: await nextPosition(socials) })
    .returning();

  return c.json({ ok: true, social: row }, 201);
});

adminCollectionsRouter.put("/socials/:id", async (c) => {
  const parsed = await readJson(c, socialInput);
  if (!parsed.ok) return parsed.response;

  const [row] = await getDb()
    .update(socials)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(socials.id, c.req.param("id")))
    .returning();

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, social: row });
});

adminCollectionsRouter.delete("/socials/:id", async (c) => {
  const [row] = await getDb()
    .delete(socials)
    .where(eq(socials.id, c.req.param("id")))
    .returning({ id: socials.id });

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

adminCollectionsRouter.get("/skills", async (c) => {
  const db = getDb();
  const rows = await db.select().from(skills).orderBy(asc(skills.position), asc(skills.id));
  const translations = await db.select().from(skillTranslations);

  return c.json({
    skills: rows.map((skill) => ({
      ...skill,
      translations: Object.fromEntries(
        translations
          .filter((t) => t.skillId === skill.id)
          .map((t) => [t.locale, { title: t.title, caption: t.caption, narrative: t.narrative }]),
      ),
    })),
  });
});

adminCollectionsRouter.post("/skills", async (c) => {
  const parsed = await readJson(c, skillInput);
  if (!parsed.ok) return parsed.response;

  const { translations, ...skill } = parsed.data;
  const db = getDb();

  const [existing] = await db.select({ id: skills.id }).from(skills).where(eq(skills.id, skill.id));
  if (existing) return c.json({ error: "duplicate_id" }, 409);

  const position = await nextPosition(skills);
  await db.transaction(async (tx) => {
    await tx.insert(skills).values({ ...skill, position });
    for (const locale of LOCALES) {
      await tx.insert(skillTranslations).values({ skillId: skill.id, locale, ...translations[locale] });
    }
  });

  return c.json({ ok: true, id: skill.id }, 201);
});

adminCollectionsRouter.put("/skills/:id", async (c) => {
  const parsed = await readJson(c, skillInput);
  if (!parsed.ok) return parsed.response;

  const id = c.req.param("id");
  const { translations, ...skill } = parsed.data;

  // The id is the join key for translations, so renaming it is a delete+create.
  if (skill.id !== id) return c.json({ error: "id_immutable" }, 400);

  const db = getDb();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(skills)
      .set({ icon: skill.icon, span: skill.span, items: skill.items, isVisible: skill.isVisible, updatedAt: new Date() })
      .where(eq(skills.id, id))
      .returning({ id: skills.id });

    if (!row) return false;

    for (const locale of LOCALES) {
      await tx
        .insert(skillTranslations)
        .values({ skillId: id, locale, ...translations[locale] })
        .onConflictDoUpdate({
          target: [skillTranslations.skillId, skillTranslations.locale],
          set: translations[locale],
        });
    }
    return true;
  });

  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

adminCollectionsRouter.delete("/skills/:id", async (c) => {
  // skill_translations cascades on the FK.
  const [row] = await getDb()
    .delete(skills)
    .where(eq(skills.id, c.req.param("id")))
    .returning({ id: skills.id });

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

adminCollectionsRouter.get("/projects", async (c) => {
  const db = getDb();
  const rows = await db.select().from(projects).orderBy(asc(projects.position), asc(projects.id));
  const translations = await db.select().from(projectTranslations);

  return c.json({
    projects: rows.map((project) => ({
      ...project,
      translations: Object.fromEntries(
        translations
          .filter((t) => t.projectId === project.id)
          .map((t) => [
            t.locale,
            {
              name: t.name,
              descriptor: t.descriptor,
              hook: t.hook,
              problem: t.problem,
              aiArchitecture: t.aiArchitecture,
              fullStackInfra: t.fullStackInfra,
              outcomes: t.outcomes,
            },
          ]),
      ),
    })),
  });
});

adminCollectionsRouter.post("/projects", async (c) => {
  const parsed = await readJson(c, projectInput);
  if (!parsed.ok) return parsed.response;

  const { translations, ...project } = parsed.data;
  const db = getDb();

  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, project.slug));
  if (existing) return c.json({ error: "duplicate_slug" }, 409);

  const position = await nextPosition(projects);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(projects).values({ ...project, position }).returning({ id: projects.id });
    if (!row) throw new Error("insert failed");

    for (const locale of LOCALES) {
      await tx.insert(projectTranslations).values({ projectId: row.id, locale, ...translations[locale] });
    }
    return row.id;
  });

  return c.json({ ok: true, id }, 201);
});

adminCollectionsRouter.put("/projects/:id", async (c) => {
  const parsed = await readJson(c, projectInput);
  if (!parsed.ok) return parsed.response;

  const id = c.req.param("id");
  const { translations, ...project } = parsed.data;
  const db = getDb();

  const [clash] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, project.slug));
  if (clash && clash.id !== id) return c.json({ error: "duplicate_slug" }, 409);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(projects)
      .set({ ...project, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning({ id: projects.id });

    if (!row) return false;

    for (const locale of LOCALES) {
      await tx
        .insert(projectTranslations)
        .values({ projectId: id, locale, ...translations[locale] })
        .onConflictDoUpdate({
          target: [projectTranslations.projectId, projectTranslations.locale],
          set: translations[locale],
        });
    }
    return true;
  });

  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

adminCollectionsRouter.delete("/projects/:id", async (c) => {
  const [row] = await getDb()
    .delete(projects)
    .where(eq(projects.id, c.req.param("id")))
    .returning({ id: projects.id });

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Reordering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Rewrites `position = 0..n-1` in one transaction. `position` has no unique
 * constraint precisely so this does not need a two-phase shuffle.
 *
 * `updated_at` is bumped too: a reorder is an edit, and the dashboard's "last
 * edit" would otherwise not move for one.
 */
async function reorder(
  table: typeof socials | typeof skills | typeof projects,
  idColumn: typeof socials.id | typeof skills.id | typeof projects.id,
  ids: string[],
): Promise<void> {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(table).set({ position: index, updatedAt: now }).where(eq(idColumn, id));
    }
  });
}

for (const [path, table, column] of [
  ["socials", socials, socials.id],
  ["skills", skills, skills.id],
  ["projects", projects, projects.id],
] as const) {
  adminCollectionsRouter.patch(`/${path}/reorder`, async (c) => {
    const parsed = await readJson(c, reorderInput);
    if (!parsed.ok) return parsed.response;

    const known = await getDb()
      .select({ id: column })
      .from(table)
      .where(inArray(column, parsed.data.ids.length ? parsed.data.ids : [""]));

    if (known.length !== parsed.data.ids.length) {
      return c.json({ error: "unknown_ids" }, 400);
    }

    await reorder(table, column, parsed.data.ids);
    return c.json({ ok: true });
  });
}

export type { Locale } from "../content/schema.js";
