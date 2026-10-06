import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { publishAll } from "../../content/publish.js";
import { getDb } from "../../db/client.js";
import { projects, projectTranslations } from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import { invalidateAssistantCache } from "../settings.js";
import { getCorpus, resetCorpusMemo } from "./build.js";
import { getAskCorpus, resetAskCorpusMemo } from "./index.js";
import { invalidateImageDescriptions } from "./media.js";

/**
 * Plan phase 17, multi-modal fusion: the corpus keeps what a picture shows.
 * Covers, gallery and body images stand as `[image: alt]` markers, and the
 * admin's descriptions follow their markers, live on save.
 */

const app = createApp();
let admin: TestClient;

/** A valid 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

beforeEach(async () => {
  await resetDb();
  resetCorpusMemo();
  resetAskCorpusMemo();
  invalidateAssistantCache();
  invalidateImageDescriptions();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

/** An image on the first project: its cover, and in its English case study. */
async function publishedDiagram(): Promise<{ id: string; file: string; slug: string }> {
  const data = new FormData();
  data.set("file", new File([new Uint8Array(PNG)], "pipeline.png", { type: "image/png" }));
  const upload = (await (await admin.post("/admin/media", data)).json()) as {
    media: { id: string; filename: string };
  };
  const { id, filename: file } = upload.media;
  expect((await admin.patch(`/admin/media/${id}`, { altEn: "Pipeline diagram" })).status).toBe(200);
  const [first] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
  await getDb().update(projects).set({ coverId: id }).where(eq(projects.id, first!.id));
  await getDb()
    .update(projectTranslations)
    .set({
      body: `<p>How it fits together:</p><p><img src="/media/${file}" alt="The pipeline"></p>`,
    })
    .where(
      sql`${projectTranslations.projectId} = ${first!.id} and ${projectTranslations.locale} = 'en'`,
    );
  await publishAll();
  resetCorpusMemo();
  return { id, file, slug: first!.slug };
}

describe("pictures in the corpus (plan phase 17)", () => {
  it("stand as markers where they appear, cover first, with the files they show", async () => {
    const { file, slug } = await publishedDiagram();
    const corpus = await getCorpus();
    const en = corpus.documents.find((d) => d.id === `project:${slug}@en`)!;
    expect(en.text).toContain("Cover: [image: Pipeline diagram]");
    expect(en.text).toContain("How it fits together:\n[image: The pipeline]");
    expect(en.images).toEqual([
      { file, alt: "Pipeline diagram" },
      { file, alt: "The pipeline" },
    ]);
    // The German page shows the same cover; its alt falls back to the English one.
    const de = corpus.documents.find((d) => d.id === `project:${slug}@de`)!;
    expect(de.images).toEqual([{ file, alt: "Pipeline diagram" }]);
  });

  it("carry the admin's description after each marker, live on save, and in the corpus key", async () => {
    const { id, file, slug } = await publishedDiagram();
    const before = await getAskCorpus();
    expect(before.byId.get(`project:${slug}@en`)!.text).not.toContain("[image description:");

    const description = "Scanned PDFs → OCR → an LLM fills a JSON schema → review queue (Retool)";
    expect((await admin.patch(`/admin/media/${id}`, { descriptionEn: description })).status).toBe(
      200,
    );
    const listed = (await (await admin.get("/admin/media")).json()) as {
      media: { id: string; descriptionEn: string | null }[];
    };
    expect(listed.media.find((m) => m.id === id)?.descriptionEn).toBe(description);

    const after = await getAskCorpus();
    expect(after.key).not.toBe(before.key);
    const en = after.byId.get(`project:${slug}@en`)!.text;
    expect(en).toContain(
      `Cover: [image: Pipeline diagram]\n[image description: Scanned PDFs → OCR → an LLM fills a JSON schema → review queue (Retool)]`,
    );
    expect(en).toContain(`[image: The pipeline]\n[image description: ${description}]`);
    // No German description yet: the German page reads the English one.
    expect(after.byId.get(`project:${slug}@de`)!.text).toContain(
      `[image description: ${description}]`,
    );
    // The search finds it, and so does the core.
    expect(after.search.search("Retool", { locale: "en" })[0]?.id).toBe(`project:${slug}@en`);
    expect(after.core.en).toContain("Retool");
    expect(file).toMatch(/\.png$/);

    expect((await admin.patch(`/admin/media/${id}`, { descriptionEn: "  " })).status).toBe(200);
    expect((await getAskCorpus()).key).toBe(before.key);
  });

  it("change no key for a picture no published page shows", async () => {
    const before = await getAskCorpus();
    const data = new FormData();
    data.set("file", new File([new Uint8Array(PNG)], "unused.png", { type: "image/png" }));
    const { media } = (await (await admin.post("/admin/media", data)).json()) as {
      media: { id: string };
    };
    await admin.patch(`/admin/media/${media.id}`, { descriptionEn: "An unused diagram" });
    expect((await getAskCorpus()).key).toBe(before.key);
  });

  it("are stored in two nullable columns (migration 0018), so an older API's writes still work", async () => {
    const { rows } = await getDb().execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'media_assets' and column_name like 'description_%'
      order by column_name`);
    expect(rows).toEqual([
      { column_name: "description_de", is_nullable: "YES" },
      { column_name: "description_en", is_nullable: "YES" },
    ]);
    // An older API's alt-only save leaves a description alone.
    const { id } = await publishedDiagram();
    await admin.patch(`/admin/media/${id}`, { descriptionDe: "Ein Diagramm" });
    await admin.patch(`/admin/media/${id}`, { altDe: "Diagramm" });
    const listed = (await (await admin.get("/admin/media")).json()) as {
      media: { id: string; descriptionDe: string | null; altDe: string | null }[];
    };
    expect(listed.media.find((m) => m.id === id)).toMatchObject({
      descriptionDe: "Ein Diagramm",
      altDe: "Diagramm",
    });
  });

  it("refuses a description over 2,000 characters", async () => {
    const { id } = await publishedDiagram();
    const res = await admin.patch(`/admin/media/${id}`, { descriptionEn: "x".repeat(2_001) });
    expect(res.status).toBe(400);
  });
});
