import { desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { adminAskRouter } from "../ask/admin.js";
import { requireAdmin } from "../auth/middleware.js";
import { adminCollectionsRouter } from "./admin-collections.js";
import { adminMediaRouter } from "./admin-media.js";
import { adminMessagesRouter } from "./admin-messages.js";
import { buildLocale } from "../content/build.js";
import { DraftInvalidError } from "../content/draft-issues.js";
import { i18nStatus } from "../content/i18n-status.js";
import {
  buildAll,
  PublicationError,
  publishAll,
  rollbackToPublication,
} from "../content/publish.js";
import { restoreDraftFromPublication } from "../content/restore.js";
import { reviewDraft } from "../content/review.js";
import {
  docKey,
  isDocKind,
  localeSchema,
  seoSchema,
  uiSchema,
  type Locale,
} from "../content/schema.js";
import { expectedToken, parseUiGroups, saveSection, saveUiGroups } from "../content/sections.js";
import { upcast } from "../content/upcast.js";
import { toIssues } from "../lib/issues.js";
import { getDb } from "../db/client.js";
import {
  contentDocuments,
  contentPointers,
  contentPublications,
  contentVersions,
  experiences,
  experienceTranslations,
  postTranslations,
  posts,
  profileResumes,
  projects,
  projectTranslations,
  siteProfile,
  skills,
  socials,
} from "../db/schema.js";
import { legalSectionSanitized } from "./admin-inputs.js";

/**
 * The authenticated surface. Section editors land here in Phase 5; for now it
 * carries the endpoints that make auth verifiable and publishing immediate.
 */
export const adminRouter = new Hono();

adminRouter.use("*", ...requireAdmin);

// Mounted here rather than in index.ts so it inherits the auth + CSRF stack
// above instead of re-declaring it.
adminRouter.route("/", adminCollectionsRouter);
adminRouter.route("/", adminMediaRouter);
adminRouter.route("/", adminMessagesRouter);
adminRouter.route("/", adminAskRouter);

/**
 * True when publishing now would change what visitors see.
 *
 * Compares the draft's checksum against the live one rather than comparing
 * timestamps: deletes leave no `updated_at` behind, and a save that changes
 * nothing should not light the badge. A draft that fails validation cannot
 * match anything live, so it counts as changed.
 */
async function draftDiffersFromLive(
  live: { locale: Locale; checksum: string }[],
): Promise<boolean> {
  try {
    const built = await buildAll(getDb());
    return built.some((b) => live.find((p) => p.locale === b.locale)?.checksum !== b.checksum);
  } catch {
    return true;
  }
}

/** Version and publication ids are bigserials; anything else in the path is a 400, not a lookup. */
function parseVersionId(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

/** The admin sees the machine-readable code; details only where they help fix it. */
function publicationErrorResponse(error: PublicationError) {
  return { error: error.code, ...(error.detail ? { detail: error.detail } : {}) };
}

adminRouter.get("/status", async (c) => {
  const db = getDb();

  const [pointers, lastEdit] = await Promise.all([
    db
      .select({
        locale: contentPointers.locale,
        versionId: contentPointers.versionId,
        publishedAt: contentPointers.publishedAt,
        checksum: contentVersions.checksum,
      })
      .from(contentPointers)
      .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId)),
    // Display only — "Last edit" on the dashboard. The unpublished-changes
    // flag comes from `draftDiffersFromLive`.
    db.execute(sql`
      select max(t) as latest from (
        select max(updated_at) as t from ${contentDocuments}
        union all select max(updated_at) from ${siteProfile}
        union all select max(updated_at) from ${profileResumes}
        union all select max(updated_at) from ${socials}
        union all select max(updated_at) from ${skills}
        union all select max(updated_at) from ${projects}
        union all select max(updated_at) from ${projectTranslations}
        union all select max(updated_at) from ${experiences}
        union all select max(updated_at) from ${experienceTranslations}
        union all select max(updated_at) from ${posts}
        union all select max(updated_at) from ${postTranslations}
      ) as edits
    `),
  ]);

  // `db.execute` hands back the driver's raw value, which for a timestamptz is
  // a string — unlike the typed select below, which yields a Date. Comparing
  // the two directly produces NaN and the flag would never be true.
  const rawLatest = lastEdit.rows[0]?.["latest"];
  let latestEdit: Date | null = null;
  if (rawLatest instanceof Date) {
    latestEdit = rawLatest;
  } else if (typeof rawLatest === "string") {
    latestEdit = new Date(rawLatest);
  }

  const lastPublish = pointers.reduce<Date | null>(
    (acc, p) => (acc === null || p.publishedAt > acc ? p.publishedAt : acc),
    null,
  );

  return c.json({
    user: c.get("session").user,
    pointers: pointers.map((p) => ({
      locale: p.locale,
      versionId: p.versionId,
      publishedAt: p.publishedAt,
    })),
    lastEdit: latestEdit?.toISOString() ?? null,
    lastPublish: lastPublish?.toISOString() ?? null,
    hasUnpublishedChanges: await draftDiffersFromLive(pointers),
  });
});

/** Where the two languages disagree: empty fields, and German older than English. */
adminRouter.get("/i18n", async (c) => {
  return c.json({ items: await i18nStatus(getDb()) });
});

/**
 * The draft as the site would show it — same builder the publish uses, plus
 * draft and scheduled posts, so they can be read before they go out. Nothing
 * is persisted. A draft that fails validation is a 422 with its problems: it
 * is the content that is wrong, not the server.
 */
async function buildPreview(locale: Locale) {
  try {
    return { ok: true as const, built: await buildLocale(getDb(), locale, new Date(), PREVIEW) };
  } catch (error) {
    if (error instanceof DraftInvalidError) {
      return { ok: false as const, body: { error: "invalid_draft", issues: error.issues } };
    }
    throw error;
  }
}

const PREVIEW = { unpublishedPosts: true };

adminRouter.get("/content/preview/:locale", async (c) => {
  const parsed = localeSchema.safeParse(c.req.param("locale"));
  if (!parsed.success) return c.json({ error: "unsupported_locale" }, 400);

  const preview = await buildPreview(parsed.data);
  if (!preview.ok) return c.json(preview.body, 422);
  c.header("Cache-Control", "no-store");
  return c.json(preview.built.core);
});

adminRouter.get("/content/preview/:locale/:kind/:slug", async (c) => {
  const locale = localeSchema.safeParse(c.req.param("locale"));
  const kind = c.req.param("kind");
  if (!locale.success) return c.json({ error: "unsupported_locale" }, 400);
  if (!isDocKind(kind)) return c.json({ error: "unknown_kind" }, 404);

  const preview = await buildPreview(locale.data);
  if (!preview.ok) return c.json(preview.body, 422);
  const doc = preview.built.docs.get(docKey(kind, c.req.param("slug")));
  if (!doc) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", "no-store");
  return c.json(doc);
});

/** What publishing now would change, per locale, and whatever stands in its way. */
adminRouter.get("/publish/review", async (c) => {
  const locales = await getDb().transaction((tx) => reviewDraft(tx), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
  return c.json({
    locales,
    canPublish: locales.every((l) => l.issues.length === 0) && locales.some((l) => l.changed),
  });
});

adminRouter.post("/publish", async (c) => {
  const session = c.get("session");
  let label: string | undefined;

  try {
    const body = (await c.req.json()) as { label?: unknown };
    if (typeof body?.label === "string") label = body.label.slice(0, 200);
  } catch {
    // An empty body is fine; the label is optional.
  }

  try {
    const outcome = await publishAll({ label, userId: session.userId });
    return c.json({
      ok: true,
      unchanged: outcome.unchanged,
      publicationId: outcome.publicationId,
      published: outcome.results,
    });
  } catch (error) {
    // An invalid draft is the editor's to fix: every locale's problems, as-is.
    if (error instanceof PublicationError) {
      return c.json(publicationErrorResponse(error), error.status);
    }
    console.error("[admin] publish failed", error);
    return c.json({ error: "publish_failed", detail: String(error) }, 422);
  }
});

/* -------------------------------------------------------------------------- */
/* Section documents (`ui`, `seo`, and the legal pages)                        */
/* -------------------------------------------------------------------------- */

/**
 * Zod validators keyed by section, so a bad payload never reaches the DB. The
 * legal pages sanitize their body as they parse.
 */
const SECTION_SCHEMAS = {
  ui: uiSchema,
  seo: seoSchema,
  imprint: legalSectionSanitized,
  privacy: legalSectionSanitized,
} as const;
type SectionName = keyof typeof SECTION_SCHEMAS;

function isSection(value: string): value is SectionName {
  return Object.hasOwn(SECTION_SCHEMAS, value);
}

adminRouter.get("/sections/:section", async (c) => {
  const section = c.req.param("section");
  if (!isSection(section)) return c.json({ error: "unknown_section" }, 404);

  const rows = await getDb()
    .select({
      locale: contentDocuments.locale,
      data: contentDocuments.data,
      updatedAt: contentDocuments.updatedAt,
    })
    .from(contentDocuments)
    .where(eq(contentDocuments.section, section));

  const data = Object.fromEntries(rows.map((r) => [r.locale, r.data]));
  // The newest of the two rows is the concurrency token for the whole section.
  const updatedAt = rows.reduce<Date | null>(
    (acc, r) => (acc === null || r.updatedAt > acc ? r.updatedAt : acc),
    null,
  );

  return c.json({ section, updatedAt, data });
});

adminRouter.put("/sections/:section", async (c) => {
  const section = c.req.param("section");
  if (!isSection(section)) return c.json({ error: "unknown_section" }, 404);

  let body: { data?: unknown; updatedAt?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid_input" }, 400);
  }

  const parsed = z
    .object({ en: SECTION_SCHEMAS[section], de: SECTION_SCHEMAS[section] })
    .safeParse(body.data);

  if (!parsed.success) {
    return c.json({ error: "invalid_input", issues: toIssues(parsed.error.issues) }, 400);
  }

  // Optimistic concurrency: refuse a save built on a stale read rather than
  // silently clobbering an edit made in another tab. Checked under a row lock.
  const saved = await getDb().transaction((tx) =>
    saveSection(
      tx,
      section,
      () => parsed.data,
      expectedToken(body.updatedAt),
      c.get("session").userId,
    ),
  );
  if (!saved.ok) return c.json({ error: "stale", current: saved.current }, 409);
  return c.json({ ok: true, updatedAt: saved.updatedAt });
});

/**
 * Saves some groups of the `ui` document, merged into it on the server. The
 * editors own one or a few groups each; sending only those means a save can
 * never carry another editor's stale copy of the rest.
 */
adminRouter.patch("/sections/ui", async (c) => {
  let body: { groups?: unknown; updatedAt?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid_input" }, 400);
  }

  const parsed = parseUiGroups(body.groups, ["groups"]);
  if (!parsed.ok) return c.json({ error: "invalid_input", issues: parsed.issues }, 400);

  const saved = await getDb().transaction((tx) =>
    saveUiGroups(tx, parsed.groups, expectedToken(body.updatedAt), c.get("session").userId),
  );
  if (!saved.ok) return c.json({ error: "stale", current: saved.current }, 409);
  return c.json({ ok: true, updatedAt: saved.updatedAt });
});

/**
 * One version of a publication, in full, plus whatever is live for the same
 * locale, so the Publications page can show exactly what a rollback would
 * change in one round trip.
 */
adminRouter.get("/revisions/:id", async (c) => {
  const id = parseVersionId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);

  const db = getDb();
  const [revision] = await db
    .select({
      id: contentVersions.id,
      locale: contentVersions.locale,
      label: contentVersions.label,
      checksum: contentVersions.checksum,
      publicationId: contentVersions.publicationId,
      createdAt: contentVersions.createdAt,
      payload: contentVersions.payload,
    })
    .from(contentVersions)
    .where(eq(contentVersions.id, id))
    .limit(1);

  if (!revision) return c.json({ error: "not_found" }, 404);

  const [live] = await db
    .select({
      id: contentVersions.id,
      payload: contentVersions.payload,
      createdAt: contentVersions.createdAt,
    })
    .from(contentPointers)
    .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId))
    .where(eq(contentPointers.locale, revision.locale))
    .limit(1);

  // Both sides as v2, so a diff against a pre-v2 revision shows content
  // changes rather than the format change.
  const asV2 = (payload: unknown, at: Date) => {
    const result = upcast(payload, at.toISOString());
    return result.ok ? result.content : payload;
  };

  return c.json({
    revision: {
      ...revision,
      payload: asV2(revision.payload, revision.createdAt),
      live: live?.id === revision.id,
    },
    live: live ? { id: live.id, payload: asV2(live.payload, live.createdAt) } : null,
  });
});

/* -------------------------------------------------------------------------- */
/* Publications — one publish or rollback, every locale together               */
/* -------------------------------------------------------------------------- */

adminRouter.get("/publications", async (c) => {
  const db = getDb();
  const publications = await db
    .select()
    .from(contentPublications)
    .orderBy(desc(contentPublications.id))
    .limit(50);

  const ids = publications.map((p) => p.id);
  const versions =
    ids.length > 0
      ? await db
          .select({
            id: contentVersions.id,
            locale: contentVersions.locale,
            publicationId: contentVersions.publicationId,
          })
          .from(contentVersions)
          .where(inArray(contentVersions.publicationId, ids))
      : [];
  const pointers = await db.select().from(contentPointers);
  const liveVersionIds = new Set(pointers.map((p) => p.versionId));

  return c.json({
    publications: publications.map((p) => {
      const own = versions.filter((v) => v.publicationId === p.id);
      return {
        ...p,
        versions: own.map(({ id, locale }) => ({ id, locale, live: liveVersionIds.has(id) })),
        live: own.length > 0 && own.every((v) => liveVersionIds.has(v.id)),
      };
    }),
  });
});

adminRouter.post("/publications/:id/rollback", async (c) => {
  const id = parseVersionId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);

  try {
    const outcome = await rollbackToPublication(id, c.get("session").userId);
    return c.json({ ok: true, ...outcome });
  } catch (error) {
    if (error instanceof PublicationError) {
      return c.json(publicationErrorResponse(error), error.status);
    }
    throw error;
  }
});

/** Makes the draft match a publication again; nothing goes live until the next publish. */
adminRouter.post("/publications/:id/restore-draft", async (c) => {
  const id = parseVersionId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);

  try {
    const outcome = await restoreDraftFromPublication(id, c.get("session").userId);
    return c.json({ ok: true, ...outcome });
  } catch (error) {
    if (error instanceof PublicationError) {
      return c.json(publicationErrorResponse(error), error.status);
    }
    throw error;
  }
});
