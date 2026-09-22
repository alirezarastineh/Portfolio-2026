import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { requireAdmin } from "../auth/middleware.js";
import { adminCollectionsRouter } from "./admin-collections.js";
import { adminMediaRouter } from "./admin-media.js";
import { buildContent } from "../content/build.js";
import { invalidateContentCache } from "../content/cache.js";
import { checksumOf, notifyClientCache, publishAll } from "../content/publish.js";
import { LOCALES, localeSchema, seoSchema, uiSchema, type Locale } from "../content/schema.js";
import { getDb } from "../db/client.js";
import {
  contentDocuments,
  contentPointers,
  contentVersions,
  projects,
  siteProfile,
  skills,
  socials,
} from "../db/schema.js";

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

/**
 * True when publishing now would change what visitors see.
 *
 * Compares the draft's checksum against the live one rather than comparing
 * timestamps: deletes leave no `updated_at` behind, and a save that changes
 * nothing should not light the badge. A draft that fails validation cannot
 * match anything live, so it counts as changed.
 */
async function draftDiffersFromLive(live: { locale: Locale; checksum: string }[]): Promise<boolean> {
  const db = getDb();

  for (const locale of LOCALES) {
    const published = live.find((p) => p.locale === locale);
    if (!published) return true;

    try {
      if (checksumOf(await buildContent(db, locale)) !== published.checksum) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** Version ids are bigserials; anything else in the path is a 400, not a lookup. */
function parseVersionId(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
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
        union all select max(updated_at) from ${socials}
        union all select max(updated_at) from ${skills}
        union all select max(updated_at) from ${projects}
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

/** Renders the draft without persisting — same builder the publish uses. */
adminRouter.get("/content/preview/:locale", async (c) => {
  const parsed = localeSchema.safeParse(c.req.param("locale"));
  if (!parsed.success) {
    return c.json({ error: "unsupported_locale" }, 400);
  }

  try {
    return c.json(await buildContent(getDb(), parsed.data));
  } catch (error) {
    // A draft that fails validation is a 422, not a 500 — it is the editor's
    // content that is wrong, not the server.
    return c.json({ error: "invalid_draft", detail: String(error) }, 422);
  }
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
    const results = await publishAll({ label, userId: session.userId });
    return c.json({ ok: true, published: results });
  } catch (error) {
    console.error("[admin] publish failed", error);
    return c.json({ error: "publish_failed", detail: String(error) }, 422);
  }
});

/* -------------------------------------------------------------------------- */
/* Section documents (the `ui` and `seo` jsonb trees)                          */
/* -------------------------------------------------------------------------- */

/** Zod validators keyed by section, so a bad payload never reaches the DB. */
const SECTION_SCHEMAS = { ui: uiSchema, seo: seoSchema } as const;
type SectionName = keyof typeof SECTION_SCHEMAS;

function isSection(value: string): value is SectionName {
  return value === "ui" || value === "seo";
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
    return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const db = getDb();
  const session = c.get("session");

  const current = await db
    .select({ updatedAt: contentDocuments.updatedAt })
    .from(contentDocuments)
    .where(eq(contentDocuments.section, section));

  const latest = current.reduce<Date | null>(
    (acc, r) => (acc === null || r.updatedAt > acc ? r.updatedAt : acc),
    null,
  );

  // Optimistic concurrency: refuse a save built on a stale read rather than
  // silently clobbering an edit made in another tab.
  const expected = typeof body.updatedAt === "string" ? new Date(body.updatedAt) : null;
  if (latest && expected && latest.getTime() !== expected.getTime()) {
    return c.json({ error: "stale", current: latest.toISOString() }, 409);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const locale of LOCALES) {
      await tx
        .insert(contentDocuments)
        .values({
          section,
          locale,
          data: parsed.data[locale],
          updatedAt: now,
          updatedBy: session.userId,
        })
        .onConflictDoUpdate({
          target: [contentDocuments.section, contentDocuments.locale],
          set: { data: parsed.data[locale], updatedAt: now, updatedBy: session.userId },
        });
    }
  });

  return c.json({ ok: true, updatedAt: now.toISOString() });
});

adminRouter.get("/revisions", async (c) => {
  const rows = await getDb()
    .select({
      id: contentVersions.id,
      locale: contentVersions.locale,
      checksum: contentVersions.checksum,
      label: contentVersions.label,
      createdAt: contentVersions.createdAt,
    })
    .from(contentVersions)
    .orderBy(desc(contentVersions.id))
    .limit(50);

  const pointers = await getDb().select().from(contentPointers);
  const live = new Set(pointers.map((p) => `${p.locale}:${p.versionId}`));

  return c.json({
    revisions: rows.map((r) => ({ ...r, live: live.has(`${r.locale}:${r.id}`) })),
  });
});

/**
 * One revision's full payload, plus whatever is live for the same locale, so
 * the admin can show exactly what a rollback would change in one round trip.
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
      createdAt: contentVersions.createdAt,
      payload: contentVersions.payload,
    })
    .from(contentVersions)
    .where(eq(contentVersions.id, id))
    .limit(1);

  if (!revision) return c.json({ error: "not_found" }, 404);

  const [live] = await db
    .select({ id: contentVersions.id, payload: contentVersions.payload })
    .from(contentPointers)
    .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId))
    .where(eq(contentPointers.locale, revision.locale))
    .limit(1);

  return c.json({
    revision: { ...revision, live: live?.id === revision.id },
    live: live ?? null,
  });
});

/**
 * Rollback copies an old payload into a NEW version and repoints, so history
 * is append-only and the rolled-back-from state stays inspectable.
 */
adminRouter.post("/revisions/:id/rollback", async (c) => {
  const session = c.get("session");
  const id = parseVersionId(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "invalid_id" }, 400);
  }

  const db = getDb();
  const [source] = await db
    .select({
      locale: contentVersions.locale,
      payload: contentVersions.payload,
      checksum: contentVersions.checksum,
    })
    .from(contentVersions)
    .where(eq(contentVersions.id, id))
    .limit(1);

  if (!source) return c.json({ error: "not_found" }, 404);

  const versionId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(contentVersions)
      .values({
        locale: source.locale,
        payload: source.payload,
        checksum: source.checksum,
        label: `rollback to #${id}`,
        createdBy: session.userId,
      })
      .returning({ id: contentVersions.id });

    if (!created) throw new Error("failed to create rollback version");

    await tx
      .insert(contentPointers)
      .values({
        locale: source.locale,
        versionId: created.id,
        publishedBy: session.userId,
      })
      .onConflictDoUpdate({
        target: contentPointers.locale,
        set: {
          versionId: created.id,
          publishedAt: new Date(),
          publishedBy: session.userId,
        },
      });

    return created.id;
  });

  // Both cache tiers, exactly as a publish does — clearing only the API's own
  // left the SSR container serving the old version for up to its 60s TTL.
  invalidateContentCache(source.locale);
  await notifyClientCache(source.locale);

  return c.json({ ok: true, locale: source.locale, versionId });
});
