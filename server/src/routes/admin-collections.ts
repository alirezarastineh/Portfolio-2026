import {
  and,
  asc,
  desc,
  eq,
  getTableName,
  inArray,
  ne,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  profileInput,
  reorderInput,
  resumeInput,
  skillInput,
  socialInput,
} from "../content/admin-schema.js";
import type { DbExecutor } from "../content/build.js";
import { canonicalJson } from "../content/publish.js";
import { LOCALES, localeSchema, type Locale } from "../content/schema.js";
import { expectedToken, parseUiGroups, saveUiGroups } from "../content/sections.js";
import { toIssues } from "../lib/issues.js";
import { getDb } from "../db/client.js";
import {
  experiences,
  experienceTranslations,
  mediaAssets,
  postTranslations,
  posts,
  profileResumes,
  projectGallery,
  projectTranslations,
  projects,
  siteProfile,
  skillTranslations,
  skills,
  socials,
} from "../db/schema.js";
import { pgErrorCode } from "../lib/http-errors.js";
import {
  experienceInput,
  isUuid,
  postInputSanitized,
  projectInputSanitized,
  readJson,
} from "./admin-inputs.js";

export const adminCollectionsRouter = new Hono();

type Tx = Parameters<Parameters<DbExecutor["transaction"]>[0]>[0];

/** A refusal decided inside a write transaction, answered as-is. */
class InputError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

function respond(c: Context, error: unknown, duplicate: string): Response {
  if (error instanceof InputError) {
    return c.json(
      { error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
      error.status,
    );
  }
  // The unique index is the real guard: two concurrent creates can both pass
  // the friendly check, and only one survives the insert.
  if (pgErrorCode(error) === "23505") return c.json({ error: duplicate }, 409);
  throw error;
}

/** Appends to the end of the list rather than colliding with an existing slot. */
async function nextPosition(
  tx: Tx,
  table: typeof socials | typeof skills | typeof projects | typeof experiences,
): Promise<number> {
  const [row] = await tx.select({ max: sql<number | null>`max(${table.position})` }).from(table);
  return (row?.max ?? -1) + 1;
}

/** Media ids must exist and be of the expected kind — a CV cannot be a cover. */
async function assertMedia(
  tx: Tx,
  ids: (string | null | undefined)[],
  kind: "image" | "document",
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await tx
    .select({ id: mediaAssets.id, filename: mediaAssets.filename, kind: mediaAssets.kind })
    .from(mediaAssets)
    .where(inArray(mediaAssets.id, wanted));
  const bad = wanted.filter((id) => rows.find((r) => r.id === id)?.kind !== kind);
  if (bad.length > 0) throw new InputError(400, "invalid_media", { ids: bad, expected: kind });
  return new Map(rows.map((r) => [r.id, r.filename]));
}

/**
 * `"table"."column"`, always. In a single-table select Drizzle renders a column
 * unqualified, and inside a correlated subquery a bare `"id"` binds to the
 * subquery's own table first — `m.id = "id"` compares the asset with itself.
 */
function qualified(column: AnyColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

/** `/media/<file>` of an asset, or null — for the admin's previews. */
function mediaPath(column: AnyColumn): SQL<string | null> {
  return sql<
    string | null
  >`(select '/media/' || m.filename from ${mediaAssets} m where m.id = ${qualified(column)})`;
}

/**
 * When a translation was last really edited: `now` if `next` differs from the
 * stored row, else the stored time. Saving a page rewrites both languages, so
 * without this every save would make the German look as fresh as the English,
 * and the dashboard could never tell that it fell behind.
 */
function editedAt(
  stored: (Record<string, unknown> & { updatedAt: Date }) | undefined,
  next: Record<string, unknown>,
  now: Date,
): Date {
  if (!stored) return now;
  const before = Object.fromEntries(Object.keys(next).map((key) => [key, stored[key]]));
  return canonicalJson(before) === canonicalJson(next) ? stored.updatedAt : now;
}

/* -------------------------------------------------------------------------- */
/* Site profile (locale-invariant identity) and CVs                            */
/* -------------------------------------------------------------------------- */

adminCollectionsRouter.get("/profile", async (c) => {
  const [row] = await getDb()
    .select({
      name: siteProfile.name,
      handle: siteProfile.handle,
      contactEmail: siteProfile.contactEmail,
      primaryCtaHref: siteProfile.primaryCtaHref,
      secondaryCtaHref: siteProfile.secondaryCtaHref,
      siteUrl: sql<string>`coalesce(${siteProfile.siteUrl}, '')`,
      availability: siteProfile.availability,
      locationCity: siteProfile.locationCity,
      locationCountry: siteProfile.locationCountry,
      timezone: siteProfile.timezone,
      avatarId: siteProfile.avatarId,
      avatarPath: mediaPath(siteProfile.avatarId),
      updatedAt: siteProfile.updatedAt,
    })
    .from(siteProfile)
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ profile: row });
});

/**
 * The identity is saved only here, with the "Hero & identity" page: the
 * identity row and the `profile`, `hero` and `nav` groups of the `ui`
 * document, in one transaction. Saved in pieces, a failure halfway left the
 * page half-saved with nothing telling which half. Both parts carry their own
 * version token.
 */
adminCollectionsRouter.put("/hero", async (c) => {
  let body: { profile?: unknown; ui?: unknown; updatedAt?: unknown; profileUpdatedAt?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid_input" }, 400);
  }

  const profile = profileInput.safeParse(body.profile);
  const ui = parseUiGroups(body.ui, ["ui"]);
  if (!profile.success || !ui.ok) {
    const issues = [
      ...(profile.success ? [] : toIssues(profile.error.issues, ["profile"])),
      ...(ui.ok ? [] : ui.issues),
    ];
    return c.json({ error: "invalid_input", issues }, 400);
  }
  const { siteUrl, ...rest } = profile.data;
  const userId = c.get("session").userId;

  try {
    const outcome = await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select({ updatedAt: siteProfile.updatedAt })
        .from(siteProfile)
        .where(eq(siteProfile.id, true))
        .for("update");
      const expected = expectedToken(body.profileUpdatedAt);
      if (current && expected && current.updatedAt.getTime() !== expected.getTime()) {
        return { ok: false as const };
      }
      await assertMedia(tx, [rest.avatarId], "image");

      const saved = await saveUiGroups(tx, ui.groups, expectedToken(body.updatedAt), userId);
      if (!saved.ok) return { ok: false as const };

      const now = new Date();
      await tx
        .update(siteProfile)
        .set({ ...rest, siteUrl: siteUrl || null, updatedAt: now, updatedBy: userId })
        .where(eq(siteProfile.id, true));
      return { ok: true as const, updatedAt: saved.updatedAt, profileUpdatedAt: now.toISOString() };
    });
    if (!outcome.ok) return c.json({ error: "stale" }, 409);
    return c.json(outcome);
  } catch (error) {
    return respond(c, error, "duplicate");
  }
});

adminCollectionsRouter.get("/resumes", async (c) => {
  const rows = await getDb()
    .select({
      locale: profileResumes.locale,
      mediaId: profileResumes.mediaId,
      path: sql<string>`'/media/' || ${mediaAssets.filename}`,
      originalName: mediaAssets.originalName,
      byteSize: mediaAssets.byteSize,
      updatedAt: profileResumes.updatedAt,
    })
    .from(profileResumes)
    .innerJoin(mediaAssets, eq(mediaAssets.id, profileResumes.mediaId));
  return c.json({
    resumes: Object.fromEntries(
      LOCALES.map((locale) => {
        const row = rows.find((r) => r.locale === locale);
        return [
          locale,
          row
            ? {
                mediaId: row.mediaId,
                path: row.path,
                originalName: row.originalName,
                byteSize: row.byteSize,
                updatedAt: row.updatedAt,
              }
            : null,
        ];
      }),
    ),
  });
});

adminCollectionsRouter.put("/resumes/:locale", async (c) => {
  const locale = localeSchema.safeParse(c.req.param("locale"));
  if (!locale.success) return c.json({ error: "unsupported_locale" }, 400);
  const parsed = await readJson(c, resumeInput);
  if (!parsed.ok) return parsed.response;

  try {
    await getDb().transaction(async (tx) => {
      await assertMedia(tx, [parsed.data.mediaId], "document");
      const now = new Date();
      await tx
        .insert(profileResumes)
        .values({ locale: locale.data, mediaId: parsed.data.mediaId, updatedAt: now })
        .onConflictDoUpdate({
          target: profileResumes.locale,
          set: { mediaId: parsed.data.mediaId, updatedAt: now },
        });
    });
  } catch (error) {
    return respond(c, error, "duplicate");
  }
  return c.json({ ok: true });
});

adminCollectionsRouter.delete("/resumes/:locale", async (c) => {
  const locale = localeSchema.safeParse(c.req.param("locale"));
  if (!locale.success) return c.json({ error: "unsupported_locale" }, 400);
  await getDb().delete(profileResumes).where(eq(profileResumes.locale, locale.data));
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Socials                                                                     */
/* -------------------------------------------------------------------------- */

adminCollectionsRouter.get("/socials", async (c) => {
  const rows = await getDb().select().from(socials).orderBy(asc(socials.position), asc(socials.id));
  return c.json({ socials: rows });
});

adminCollectionsRouter.post("/socials", async (c) => {
  const parsed = await readJson(c, socialInput);
  if (!parsed.ok) return parsed.response;

  const row = await getDb().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(socials)
      .values({ ...parsed.data, position: await nextPosition(tx, socials) })
      .returning();
    return inserted;
  });
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
  const rows = await getDb()
    .select({
      id: skills.id,
      icon: skills.icon,
      span: skills.span,
      items: skills.items,
      position: skills.position,
      isVisible: skills.isVisible,
      updatedAt: skills.updatedAt,
      translations: sql<
        Record<Locale, { title: string; caption: string; narrative: string }>
      >`coalesce((
        select json_object_agg(t.locale, json_build_object(
          'title', t.title, 'caption', t.caption, 'narrative', t.narrative))
        from ${skillTranslations} t where t.skill_id = ${qualified(skills.id)}), '{}'::json)`,
    })
    .from(skills)
    .orderBy(asc(skills.position), asc(skills.id));
  return c.json({ skills: rows });
});

adminCollectionsRouter.post("/skills", async (c) => {
  const parsed = await readJson(c, skillInput);
  if (!parsed.ok) return parsed.response;
  const { translations, ...skill } = parsed.data;

  try {
    await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.id, skill.id));
      if (existing) throw new InputError(409, "duplicate_id");
      await tx.insert(skills).values({ ...skill, position: await nextPosition(tx, skills) });
      for (const locale of LOCALES) {
        await tx
          .insert(skillTranslations)
          .values({ skillId: skill.id, locale, ...translations[locale] });
      }
    });
  } catch (error) {
    return respond(c, error, "duplicate_id");
  }
  return c.json({ ok: true, id: skill.id }, 201);
});

adminCollectionsRouter.put("/skills/:id", async (c) => {
  const parsed = await readJson(c, skillInput);
  if (!parsed.ok) return parsed.response;

  const id = c.req.param("id");
  const { translations, ...skill } = parsed.data;

  // The id is the join key for translations, so renaming it is a delete+create.
  if (skill.id !== id) return c.json({ error: "id_immutable" }, 400);

  const updated = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(skills)
      .set({
        icon: skill.icon,
        span: skill.span,
        items: skill.items,
        isVisible: skill.isVisible,
        updatedAt: new Date(),
      })
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

const projectColumns = {
  id: projects.id,
  slug: projects.slug,
  coverId: projects.coverId,
  coverPath: mediaPath(projects.coverId),
  stack: projects.stack,
  linkLive: sql<string>`coalesce(${projects.linkLive}, '')`,
  linkRepo: sql<string>`coalesce(${projects.linkRepo}, '')`,
  linkCaseStudy: sql<string>`coalesce(${projects.linkCaseStudy}, '')`,
  isVisible: projects.isVisible,
  featured: projects.featured,
  periodStart: projects.periodStart,
  periodEnd: projects.periodEnd,
  category: sql<string>`coalesce(${projects.category}, '')`,
  tags: projects.tags,
  position: projects.position,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

/** Light rows for the list: names only, so it never ships every case study. */
adminCollectionsRouter.get("/projects", async (c) => {
  const rows = await getDb()
    .select({
      ...projectColumns,
      translations: sql<Record<Locale, { name: string; hasCaseStudy: boolean }>>`coalesce((
        select json_object_agg(t.locale, json_build_object('name', t.name, 'hasCaseStudy', t.body <> ''))
        from ${projectTranslations} t where t.project_id = ${qualified(projects.id)}), '{}'::json)`,
    })
    .from(projects)
    .orderBy(asc(projects.position), asc(projects.id));
  return c.json({ projects: rows });
});

adminCollectionsRouter.get("/projects/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);

  const [row] = await getDb()
    .select({
      ...projectColumns,
      gallery: sql<{ mediaId: string; caption: Record<Locale, string>; path: string }[]>`coalesce((
        select json_agg(json_build_object(
          'mediaId', g.media_id,
          'caption', json_build_object('en', coalesce(g.caption->>'en', ''), 'de', coalesce(g.caption->>'de', '')),
          'path', '/media/' || m.filename) order by g.position)
        from ${projectGallery} g join ${mediaAssets} m on m.id = g.media_id
        where g.project_id = ${qualified(projects.id)}), '[]'::json)`,
      translations: sql<Record<Locale, unknown>>`coalesce((
        select json_object_agg(t.locale, json_build_object(
          'name', t.name, 'descriptor', t.descriptor, 'hook', t.hook, 'problem', t.problem,
          'aiArchitecture', t.ai_architecture, 'fullStackInfra', t.full_stack_infra,
          'outcomes', t.outcomes, 'role', t.role, 'categoryLabel', t.category_label,
          'metrics', t.metrics, 'body', t.body, 'seoDescription', t.seo_description))
        from ${projectTranslations} t where t.project_id = ${qualified(projects.id)}), '{}'::json)`,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ project: row });
});

type ProjectData = z.output<typeof projectInputSanitized>;

async function writeProject(tx: Tx, id: string | null, data: ProjectData): Promise<string | null> {
  const [clash] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      id ? and(eq(projects.slug, data.slug), ne(projects.id, id)) : eq(projects.slug, data.slug),
    );
  if (clash) throw new InputError(409, "duplicate_slug");

  await assertMedia(tx, [data.coverId, ...data.gallery.map((g) => g.mediaId)], "image");

  const now = new Date();
  const values = {
    slug: data.slug,
    coverId: data.coverId,
    stack: data.stack,
    linkLive: data.linkLive,
    linkRepo: data.linkRepo,
    linkCaseStudy: data.linkCaseStudy,
    isVisible: data.isVisible,
    featured: data.featured,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    category: data.category || null,
    tags: data.tags,
    updatedAt: now,
  };

  let projectId = id;
  if (projectId) {
    const [row] = await tx
      .update(projects)
      .set(values)
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });
    if (!row) return null;
  } else {
    const [row] = await tx
      .insert(projects)
      .values({ ...values, position: await nextPosition(tx, projects) })
      .returning({ id: projects.id });
    if (!row) throw new Error("insert failed");
    projectId = row.id;
  }

  const storedTexts = id
    ? await tx.select().from(projectTranslations).where(eq(projectTranslations.projectId, id))
    : [];
  for (const locale of LOCALES) {
    const stored = storedTexts.find((row) => row.locale === locale);
    const text = {
      ...data.translations[locale],
      updatedAt: editedAt(stored, data.translations[locale], now),
    };
    await tx
      .insert(projectTranslations)
      .values({ projectId, locale, ...text })
      .onConflictDoUpdate({
        target: [projectTranslations.projectId, projectTranslations.locale],
        set: text,
      });
  }

  await tx.delete(projectGallery).where(eq(projectGallery.projectId, projectId));
  if (data.gallery.length > 0) {
    await tx.insert(projectGallery).values(
      data.gallery.map((g, position) => ({
        projectId: projectId!,
        mediaId: g.mediaId,
        position,
        caption: g.caption,
      })),
    );
  }
  return projectId;
}

adminCollectionsRouter.post("/projects", async (c) => {
  const parsed = await readJson(c, projectInputSanitized);
  if (!parsed.ok) return parsed.response;

  try {
    const id = await getDb().transaction((tx) => writeProject(tx, null, parsed.data));
    return c.json({ ok: true, id }, 201);
  } catch (error) {
    return respond(c, error, "duplicate_slug");
  }
});

adminCollectionsRouter.put("/projects/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const parsed = await readJson(c, projectInputSanitized);
  if (!parsed.ok) return parsed.response;

  try {
    const written = await getDb().transaction((tx) => writeProject(tx, id, parsed.data));
    if (!written) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (error) {
    return respond(c, error, "duplicate_slug");
  }
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
/* Experience                                                                  */
/* -------------------------------------------------------------------------- */

const experienceColumns = {
  id: experiences.id,
  kind: experiences.kind,
  orgName: experiences.orgName,
  orgUrl: sql<string>`coalesce(${experiences.orgUrl}, '')`,
  logoId: experiences.logoId,
  logoPath: mediaPath(experiences.logoId),
  location: experiences.location,
  employmentType: experiences.employmentType,
  startDate: experiences.startDate,
  endDate: experiences.endDate,
  datePrecision: experiences.datePrecision,
  credentialId: sql<string>`coalesce(${experiences.credentialId}, '')`,
  credentialUrl: sql<string>`coalesce(${experiences.credentialUrl}, '')`,
  skills: experiences.skills,
  position: experiences.position,
  isVisible: experiences.isVisible,
  updatedAt: experiences.updatedAt,
  translations: sql<
    Record<Locale, { title: string; summary: string; highlights: string[] }>
  >`coalesce((
    select json_object_agg(t.locale, json_build_object(
      'title', t.title, 'summary', t.summary, 'highlights', t.highlights))
    from ${experienceTranslations} t where t.experience_id = ${qualified(experiences.id)}), '{}'::json)`,
};

adminCollectionsRouter.get("/experiences", async (c) => {
  const rows = await getDb()
    .select(experienceColumns)
    .from(experiences)
    .orderBy(asc(experiences.position), asc(experiences.id));
  return c.json({ experiences: rows });
});

async function writeExperience(
  tx: Tx,
  id: string | null,
  data: z.output<typeof experienceInput>,
): Promise<string | null> {
  await assertMedia(tx, [data.logoId], "image");
  const { translations, ...entry } = data;
  const now = new Date();
  const values = {
    ...entry,
    orgUrl: entry.orgUrl || null,
    credentialId: entry.credentialId || null,
    credentialUrl: entry.credentialUrl || null,
    updatedAt: now,
  };

  let experienceId = id;
  if (experienceId) {
    const [row] = await tx
      .update(experiences)
      .set(values)
      .where(eq(experiences.id, experienceId))
      .returning({ id: experiences.id });
    if (!row) return null;
  } else {
    const [row] = await tx
      .insert(experiences)
      .values({ ...values, position: await nextPosition(tx, experiences) })
      .returning({ id: experiences.id });
    if (!row) throw new Error("insert failed");
    experienceId = row.id;
  }

  const storedTexts = id
    ? await tx
        .select()
        .from(experienceTranslations)
        .where(eq(experienceTranslations.experienceId, id))
    : [];
  for (const locale of LOCALES) {
    const stored = storedTexts.find((row) => row.locale === locale);
    const text = {
      ...translations[locale],
      updatedAt: editedAt(stored, translations[locale], now),
    };
    await tx
      .insert(experienceTranslations)
      .values({ experienceId, locale, ...text })
      .onConflictDoUpdate({
        target: [experienceTranslations.experienceId, experienceTranslations.locale],
        set: text,
      });
  }
  return experienceId;
}

adminCollectionsRouter.post("/experiences", async (c) => {
  const parsed = await readJson(c, experienceInput);
  if (!parsed.ok) return parsed.response;
  try {
    const id = await getDb().transaction((tx) => writeExperience(tx, null, parsed.data));
    return c.json({ ok: true, id }, 201);
  } catch (error) {
    return respond(c, error, "duplicate");
  }
});

adminCollectionsRouter.put("/experiences/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const parsed = await readJson(c, experienceInput);
  if (!parsed.ok) return parsed.response;
  try {
    const written = await getDb().transaction((tx) => writeExperience(tx, id, parsed.data));
    if (!written) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (error) {
    return respond(c, error, "duplicate");
  }
});

adminCollectionsRouter.delete("/experiences/:id", async (c) => {
  const [row] = await getDb()
    .delete(experiences)
    .where(eq(experiences.id, c.req.param("id")))
    .returning({ id: experiences.id });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

const postColumns = {
  id: posts.id,
  slug: posts.slug,
  status: posts.status,
  publishedAt: posts.publishedAt,
  coverId: posts.coverId,
  coverPath: mediaPath(posts.coverId),
  tags: posts.tags,
  canonicalUrl: sql<string>`coalesce(${posts.canonicalUrl}, '')`,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
};

/** Newest first; drafts (no date) on top. Titles only. */
adminCollectionsRouter.get("/posts", async (c) => {
  const rows = await getDb()
    .select({
      ...postColumns,
      translations: sql<Partial<Record<Locale, { title: string }>>>`coalesce((
        select json_object_agg(t.locale, json_build_object('title', t.title))
        from ${postTranslations} t where t.post_id = ${qualified(posts.id)}), '{}'::json)`,
    })
    .from(posts)
    .orderBy(sql`${posts.publishedAt} desc nulls first`, desc(posts.createdAt));
  return c.json({ posts: rows });
});

adminCollectionsRouter.get("/posts/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);

  const [row] = await getDb()
    .select({
      ...postColumns,
      translations: sql<Partial<Record<Locale, unknown>>>`coalesce((
        select json_object_agg(t.locale, json_build_object(
          'title', t.title, 'excerpt', t.excerpt, 'body', t.body,
          'seoTitle', t.seo_title, 'seoDescription', t.seo_description))
        from ${postTranslations} t where t.post_id = ${qualified(posts.id)}), '{}'::json)`,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);

  // Both keys always present: null = the post does not exist in that language.
  const translations = row.translations as Partial<Record<Locale, unknown>>;
  return c.json({
    post: { ...row, translations: { en: translations.en ?? null, de: translations.de ?? null } },
  });
});

type PostData = z.output<typeof postInputSanitized>;

async function writePost(tx: Tx, id: string | null, data: PostData): Promise<string | null> {
  const [clash] = await tx
    .select({ id: posts.id })
    .from(posts)
    .where(id ? and(eq(posts.slug, data.slug), ne(posts.id, id)) : eq(posts.slug, data.slug));
  if (clash) throw new InputError(409, "duplicate_slug");
  await assertMedia(tx, [data.coverId], "image");

  const now = new Date();
  const values = {
    slug: data.slug,
    status: data.status,
    publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
    coverId: data.coverId,
    tags: data.tags,
    canonicalUrl: data.canonicalUrl || null,
    updatedAt: now,
  };

  let postId = id;
  if (postId) {
    const [row] = await tx
      .update(posts)
      .set(values)
      .where(eq(posts.id, postId))
      .returning({ id: posts.id });
    if (!row) return null;
  } else {
    const [row] = await tx.insert(posts).values(values).returning({ id: posts.id });
    if (!row) throw new Error("insert failed");
    postId = row.id;
  }

  const storedTexts = id
    ? await tx.select().from(postTranslations).where(eq(postTranslations.postId, id))
    : [];
  for (const locale of LOCALES) {
    const translation = data.translations[locale];
    if (translation) {
      const stored = storedTexts.find((row) => row.locale === locale);
      const text = { ...translation, updatedAt: editedAt(stored, translation, now) };
      await tx
        .insert(postTranslations)
        .values({ postId, locale, ...text })
        .onConflictDoUpdate({
          target: [postTranslations.postId, postTranslations.locale],
          set: text,
        });
    } else {
      await tx
        .delete(postTranslations)
        .where(and(eq(postTranslations.postId, postId), eq(postTranslations.locale, locale)));
    }
  }
  return postId;
}

adminCollectionsRouter.post("/posts", async (c) => {
  const parsed = await readJson(c, postInputSanitized);
  if (!parsed.ok) return parsed.response;
  try {
    const id = await getDb().transaction((tx) => writePost(tx, null, parsed.data));
    return c.json({ ok: true, id }, 201);
  } catch (error) {
    return respond(c, error, "duplicate_slug");
  }
});

adminCollectionsRouter.put("/posts/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
  const parsed = await readJson(c, postInputSanitized);
  if (!parsed.ok) return parsed.response;
  try {
    const written = await getDb().transaction((tx) => writePost(tx, id, parsed.data));
    if (!written) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (error) {
    return respond(c, error, "duplicate_slug");
  }
});

adminCollectionsRouter.delete("/posts/:id", async (c) => {
  const [row] = await getDb()
    .delete(posts)
    .where(eq(posts.id, c.req.param("id")))
    .returning({ id: posts.id });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Visibility and reordering                                                   */
/* -------------------------------------------------------------------------- */

const visibilityInput = z.object({ isVisible: z.boolean() });

/**
 * Show/hide without resending the whole entry — the lists hold light rows,
 * not the full case study a PUT would need.
 */
for (const [path, table] of [
  ["projects", projects],
  ["experiences", experiences],
] as const) {
  adminCollectionsRouter.patch(`/${path}/:id/visibility`, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "invalid_id" }, 400);
    const parsed = await readJson(c, visibilityInput);
    if (!parsed.ok) return parsed.response;

    const [row] = await getDb()
      .update(table)
      .set({ isVisible: parsed.data.isVisible, updatedAt: new Date() })
      .where(eq(table.id, id))
      .returning({ id: table.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });
}

const REORDERABLE = {
  socials: { table: socials, idType: "uuid" },
  skills: { table: skills, idType: "text" },
  projects: { table: projects, idType: "uuid" },
  experiences: { table: experiences, idType: "uuid" },
} as const;

/**
 * Rewrites `position = 0..n-1` in one statement: an `UPDATE … FROM (VALUES …)`
 * rather than one update per row. `position` has no unique constraint
 * precisely so this needs no two-phase shuffle.
 *
 * `updated_at` is bumped too: a reorder is an edit, and the dashboard's "last
 * edit" would otherwise not move for one.
 */
for (const [path, { table, idType }] of Object.entries(REORDERABLE)) {
  adminCollectionsRouter.patch(`/${path}/reorder`, async (c) => {
    const parsed = await readJson(c, reorderInput);
    if (!parsed.ok) return parsed.response;
    const ids = parsed.data.ids;
    if (new Set(ids).size !== ids.length) return c.json({ error: "duplicate_ids" }, 400);
    if (idType === "uuid" && !ids.every(isUuid)) return c.json({ error: "invalid_id" }, 400);

    const unknown = await getDb().transaction(async (tx) => {
      const known = ids.length
        ? await tx.select({ id: table.id }).from(table).where(inArray(table.id, ids))
        : [];
      if (known.length !== ids.length) return true;
      if (ids.length === 0) return false;

      const rows = sql.join(
        ids.map((id, index) => sql`(${id}::${sql.raw(idType)}, ${index}::int)`),
        sql`, `,
      );
      await tx.execute(sql`
        update ${table} as t set position = v.position, updated_at = now()
        from (values ${rows}) as v(id, position)
        where t.id = v.id`);
      return false;
    });

    if (unknown) return c.json({ error: "unknown_ids" }, 400);
    return c.json({ ok: true });
  });
}

export type { Locale } from "../content/schema.js";
