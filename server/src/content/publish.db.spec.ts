import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import {
  contentPointers,
  contentPublications,
  contentVersions,
  mediaAssets,
  projectTranslations,
  projects,
  versionMediaRefs,
} from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import { PublicationError, publishAll, rollbackToPublication } from "./publish.js";
import { restoreDraftFromPublication } from "./restore.js";
import type { AppContent } from "./schema.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed(); // drafts + a first publication of both locales
});

async function liveContent(locale: "en" | "de" = "en"): Promise<AppContent> {
  const res = await app.request(`/v1/content/${locale}`);
  return (await res.json()) as AppContent;
}

async function renameFirstProject(name: string, locale: "en" | "de" = "en"): Promise<string> {
  const [first] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
  await getDb()
    .update(projectTranslations)
    .set({ name })
    .where(
      sql`${projectTranslations.projectId} = ${first!.id} and ${projectTranslations.locale} = ${locale}`,
    );
  return first!.id;
}

async function publicationCount(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(contentPublications);
  return row!.n;
}

describe("publishAll", () => {
  it("writes one publication holding every locale", async () => {
    await renameFirstProject("Changed");
    const outcome = await publishAll({ label: "rename" });

    expect(outcome.unchanged).toBe(false);
    const versions = await getDb()
      .select({ locale: contentVersions.locale })
      .from(contentVersions)
      .where(eq(contentVersions.publicationId, outcome.publicationId!));
    expect(versions.map((v) => v.locale).sort()).toEqual(["de", "en"]);
  });

  it("writes nothing when the draft already matches what is live", async () => {
    const before = await publicationCount();
    const outcome = await publishAll({ label: "again" });

    expect(outcome.unchanged).toBe(true);
    expect(outcome.publicationId).toBeNull();
    expect(await publicationCount()).toBe(before);
  });

  /** The race the lock exists for: two admins (or tabs) pressing Publish at once. */
  it("serializes concurrent publishes instead of interleaving them", async () => {
    await renameFirstProject("Raced");
    const before = await publicationCount();

    const [a, b] = await Promise.all([publishAll({ label: "a" }), publishAll({ label: "b" })]);

    // Exactly one wrote; the other saw the result and had nothing left to do.
    expect([a.unchanged, b.unchanged].sort()).toEqual([false, true]);
    expect(await publicationCount()).toBe(before + 1);

    const pointers = await getDb().select().from(contentPointers);
    const pointed = await getDb()
      .select({ publicationId: contentVersions.publicationId })
      .from(contentVersions)
      .where(
        sql`${contentVersions.id} in (${sql.join(
          pointers.map((p) => sql`${p.versionId}`),
          sql`, `,
        )})`,
      );
    // Both locales point into the same publication.
    expect(new Set(pointed.map((p) => p.publicationId)).size).toBe(1);
  });

  it("records the uploaded images a version shows", async () => {
    const [asset] = await getDb()
      .insert(mediaAssets)
      .values({
        filename: "00000000-0000-4000-8000-000000000001.png",
        originalName: "shot.png",
        mime: "image/png",
        byteSize: 10,
        checksumSha256: Buffer.alloc(32, 1),
      })
      .returning({ id: mediaAssets.id });
    const [first] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
    await getDb()
      .update(projects)
      .set({ imageId: asset!.id, imagePath: "/media/00000000-0000-4000-8000-000000000001.png" })
      .where(eq(projects.id, first!.id));

    const outcome = await publishAll();
    const refs = await getDb().select().from(versionMediaRefs);
    expect(refs).toHaveLength(2); // one per locale
    expect(new Set(refs.map((r) => r.versionId))).toEqual(
      new Set(outcome.results.map((r) => r.versionId)),
    );
  });
});

describe("rollbackToPublication", () => {
  it("brings every locale of the chosen publication back, as a new publication", async () => {
    const [original] = await getDb()
      .select({ id: contentPublications.id })
      .from(contentPublications)
      .limit(1);
    const originalEn = (await liveContent("en")).projects[0]!.name;
    const originalDe = (await liveContent("de")).projects[0]!.name;

    await renameFirstProject("Regrettable EN", "en");
    await renameFirstProject("Regrettable DE", "de");
    await publishAll();
    expect((await liveContent("de")).projects[0]!.name).toBe("Regrettable DE");

    const outcome = await rollbackToPublication(original!.id);
    expect(outcome.restoredFrom).toBe(original!.id);
    expect((await liveContent("en")).projects[0]!.name).toBe(originalEn);
    expect((await liveContent("de")).projects[0]!.name).toBe(originalDe);

    const [written] = await getDb()
      .select()
      .from(contentPublications)
      .where(eq(contentPublications.id, outcome.publicationId));
    expect(written).toMatchObject({ kind: "rollback", restoredFrom: original!.id });
  });

  it("answers not_found for an unknown publication", async () => {
    await expect(rollbackToPublication(999_999)).rejects.toMatchObject({ status: 404 });
  });

  /** Old payloads are re-validated: a rollback must never put a broken page live. */
  it("refuses a publication whose payload no longer validates", async () => {
    const [pub] = await getDb()
      .insert(contentPublications)
      .values({ kind: "publish" })
      .returning({ id: contentPublications.id });
    await getDb()
      .insert(contentVersions)
      .values({
        locale: "en",
        payload: { version: 1, nonsense: true },
        checksum: "x",
        publicationId: pub!.id,
      });

    const error = await rollbackToPublication(pub!.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicationError);
    expect(error).toMatchObject({ status: 422, code: "invalid_payload" });
  });

  it("refuses when an image the publication shows has been deleted since", async () => {
    const [asset] = await getDb()
      .insert(mediaAssets)
      .values({
        filename: "00000000-0000-4000-8000-000000000002.png",
        originalName: "gone.png",
        mime: "image/png",
        byteSize: 10,
        checksumSha256: Buffer.alloc(32, 2),
      })
      .returning({ id: mediaAssets.id });
    const [first] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
    await getDb()
      .update(projects)
      .set({ imageId: asset!.id, imagePath: "/media/00000000-0000-4000-8000-000000000002.png" })
      .where(eq(projects.id, first!.id));
    const withImage = await publishAll();

    await getDb()
      .update(projects)
      .set({ imageId: null, imagePath: null })
      .where(eq(projects.id, first!.id));
    await publishAll();
    await getDb().delete(mediaAssets).where(eq(mediaAssets.id, asset!.id));

    await expect(rollbackToPublication(withImage.publicationId!)).rejects.toMatchObject({
      status: 409,
      code: "media_missing",
    });
  });
});

describe("restoreDraftFromPublication", () => {
  it("brings the draft back to a publication without deleting anything added since", async () => {
    const [original] = await getDb()
      .select({ id: contentPublications.id })
      .from(contentPublications)
      .limit(1);
    const originalName = (await liveContent("en")).projects[0]!.name;

    await renameFirstProject("Edited since");
    const [added] = await getDb()
      .insert(projects)
      .values({ slug: "added-later", position: 99, stack: [] })
      .returning({ id: projects.id });
    await getDb()
      .insert(projectTranslations)
      .values(
        (["en", "de"] as const).map((locale) => ({
          projectId: added!.id,
          locale,
          name: "Added later",
          descriptor: "",
          hook: "",
          problem: "",
          aiArchitecture: "",
          fullStackInfra: "",
        })),
      );
    await publishAll();

    await restoreDraftFromPublication(original!.id);

    // The draft is back; the live site is untouched until the next publish.
    const [firstTranslation] = await getDb()
      .select({ name: projectTranslations.name })
      .from(projectTranslations)
      .innerJoin(projects, eq(projects.id, projectTranslations.projectId))
      .where(sql`${projectTranslations.locale} = 'en' and ${projects.position} = 0`);
    expect(firstTranslation?.name).toBe(originalName);
    expect((await liveContent("en")).projects[0]!.name).toBe("Edited since");

    // Added since → hidden, not deleted.
    const [kept] = await getDb().select().from(projects).where(eq(projects.slug, "added-later"));
    expect(kept).toMatchObject({ isVisible: false });

    // And publishing it now reproduces the original exactly.
    const republished = await publishAll();
    expect((await liveContent("en")).projects[0]!.name).toBe(originalName);
    expect(republished.unchanged).toBe(false);
  });

  it("refuses a single-locale publication, which cannot restore both translations", async () => {
    const [pub] = await getDb()
      .insert(contentPublications)
      .values({ kind: "rollback" })
      .returning({ id: contentPublications.id });
    const [enVersion] = await getDb()
      .select({ payload: contentVersions.payload })
      .from(contentVersions)
      .where(eq(contentVersions.locale, "en"))
      .limit(1);
    await getDb()
      .insert(contentVersions)
      .values({ locale: "en", payload: enVersion!.payload, checksum: "x", publicationId: pub!.id });

    await expect(restoreDraftFromPublication(pub!.id)).rejects.toMatchObject({
      status: 422,
      code: "incomplete_publication",
    });
  });
});

describe("admin routes", () => {
  it("rolls back both locales through the old per-version route", async () => {
    await createAdmin();
    const client = new TestClient(app);
    await client.login();

    const originalDe = (await liveContent("de")).projects[0]!.name;
    const [enV1] = await getDb()
      .select({ id: contentVersions.id })
      .from(contentVersions)
      .where(eq(contentVersions.locale, "en"))
      .limit(1);

    await renameFirstProject("Changed DE", "de");
    await client.post("/admin/publish", {});

    const res = await client.post(`/admin/revisions/${enV1!.id}/rollback`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, locale: "en" });
    // Asked about EN; DE moved with it.
    expect((await liveContent("de")).projects[0]!.name).toBe(originalDe);
  });

  it("lists publications with their locales and which one is live", async () => {
    await createAdmin();
    const client = new TestClient(app);
    await client.login();

    const res = await client.get("/admin/publications");
    const body = (await res.json()) as {
      publications: { live: boolean; versions: { locale: string }[] }[];
    };
    expect(body.publications[0]).toMatchObject({ live: true });
    expect(body.publications[0]!.versions.map((v) => v.locale).sort()).toEqual(["de", "en"]);
  });

  it("reports an unchanged publish instead of writing a duplicate", async () => {
    await createAdmin();
    const client = new TestClient(app);
    await client.login();

    const res = await client.post("/admin/publish", {});
    expect(await res.json()).toMatchObject({ ok: true, unchanged: true, publicationId: null });
  });
});

describe("0003_backfill_publications", () => {
  const backfill = readFileSync(
    resolve(process.cwd(), "drizzle/0003_backfill_publications.sql"),
    "utf8",
  ).split("--> statement-breakpoint");

  it("groups legacy versions by publish and records their images", async () => {
    await resetDb();
    const payload = { version: 1, projects: [{ image: "https://api.test/media/legacy.png" }] };
    const [asset] = await getDb()
      .insert(mediaAssets)
      .values({
        filename: "legacy.png",
        originalName: "legacy.png",
        mime: "image/png",
        byteSize: 1,
        checksumSha256: Buffer.alloc(32, 3),
      })
      .returning({ id: mediaAssets.id });

    // Two publishes (EN+DE sharing a timestamp), then one old single-locale rollback.
    const t1 = new Date("2026-01-01T10:00:00Z");
    const t2 = new Date("2026-01-02T10:00:00Z");
    const t3 = new Date("2026-01-03T10:00:00Z");
    await getDb()
      .insert(contentVersions)
      .values([
        { locale: "en", payload, checksum: "a", createdAt: t1 },
        { locale: "de", payload, checksum: "b", createdAt: t1 },
        { locale: "en", payload: {}, checksum: "c", createdAt: t2 },
        { locale: "de", payload: {}, checksum: "d", createdAt: t2 },
        { locale: "en", payload: {}, checksum: "e", label: "rollback to #1", createdAt: t3 },
      ]);

    for (const statement of backfill) await getDb().execute(sql.raw(statement));

    const pubs = await getDb()
      .select()
      .from(contentPublications)
      .orderBy(contentPublications.createdAt);
    expect(pubs.map((p) => p.kind)).toEqual(["publish", "publish", "rollback"]);
    const versions = await getDb().select().from(contentVersions);
    expect(versions.every((v) => v.publicationId !== null)).toBe(true);
    expect(
      new Set(
        versions.filter((v) => v.createdAt.getTime() === t1.getTime()).map((v) => v.publicationId),
      ).size,
    ).toBe(1);

    const refs = await getDb().select().from(versionMediaRefs);
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.assetId === asset!.id)).toBe(true);

    // Idempotent: a second run changes nothing.
    for (const statement of backfill) await getDb().execute(sql.raw(statement));
    expect(await publicationCount()).toBe(3);
  });
});
