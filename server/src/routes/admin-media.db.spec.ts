import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { publishAll } from "../content/publish.js";
import { getDb } from "../db/client.js";
import { mediaVariants, projects, siteProfile } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";

const app = createApp();
let client: TestClient;

/** A valid 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Smallest thing that passes the `%PDF-` check. */
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  client = new TestClient(app);
  await client.login();
});

function form(bytes: Buffer, name = "pixel.png", type = "image/png"): FormData {
  const data = new FormData();
  data.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return data;
}

interface MediaResponse {
  ok: true;
  deduped?: boolean;
  media: {
    id: string;
    filename: string;
    kind: "image" | "document";
    width: number | null;
    height: number | null;
    blurDataUri: string | null;
    variants: { format: string; width: number; path: string }[];
  };
}

async function upload(
  bytes = PNG,
  name?: string,
  type?: string,
): Promise<{ status: number; body: MediaResponse }> {
  const res = await client.post("/admin/media", form(bytes, name, type));
  return { status: res.status, body: (await res.json()) as MediaResponse };
}

function onDisk(filename: string): boolean {
  return existsSync(join(process.env.MEDIA_ROOT!, filename));
}

describe("media upload", () => {
  it("stores an image and serves it publicly", async () => {
    const { status, body } = await upload();
    expect(status).toBe(201);
    expect(body.media).toMatchObject({ kind: "image", width: 1, height: 1 });

    const served = await app.request(`/media/${body.media.filename}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    // Re-encoded, so not byte-identical, but still the same 1×1 PNG.
    const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: "png", width: 1, height: 1 });
  });

  it("reuses the existing asset for identical bytes", async () => {
    const first = await upload();
    const second = await upload();
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(second.body.media.id).toBe(first.body.media.id);
  });

  /** Only the bytes decide: a script renamed to .png is not an image. */
  it("rejects content that is not an image, whatever it claims to be", async () => {
    const res = await client.post("/admin/media", form(Buffer.from("<script>x</script>")));
    expect(res.status).toBe(415);
  });

  it("rejects a file with an image signature that does not decode", async () => {
    const broken = Buffer.concat([PNG.subarray(0, 33), Buffer.alloc(64, 0xab)]);
    const res = await client.post("/admin/media", form(broken));
    expect(res.status).toBe(415);
  });

  it("makes responsive variants and a blur placeholder, and serves the variants", async () => {
    const photo = await sharp({
      create: { width: 1000, height: 500, channels: 3, background: "#e5582b" },
    })
      .jpeg()
      .toBuffer();
    const { status, body } = await upload(photo, "photo.jpg", "image/jpeg");
    expect(status).toBe(201);
    expect(body.media.blurDataUri).toMatch(/^data:image\/webp;base64,/);

    // 480 and 768 are below 1000; each in both formats.
    const widths = body.media.variants.map((v) => `${v.format}:${v.width}`).sort();
    expect(widths).toEqual(["avif:480", "avif:768", "webp:480", "webp:768"]);

    const avif = body.media.variants.find((v) => v.format === "avif" && v.width === 768)!;
    const served = await app.request(avif.path);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/avif");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).width).toBe(768);

    // A revalidation with the same ETag is answered without the body.
    const again = await app.request(avif.path, {
      headers: { "if-none-match": served.headers.get("etag")! },
    });
    expect(again.status).toBe(304);
  });

  it("stores a PDF as-is and serves it inline under a safe filename", async () => {
    const { status, body } = await upload(PDF, "Lebenslauf (Ä) — 2026.pdf", "application/pdf");
    expect(status).toBe(201);
    expect(body.media).toMatchObject({
      kind: "document",
      width: null,
      blurDataUri: null,
      variants: [],
    });
    expect(body.media.filename).toMatch(/\.pdf$/);

    const served = await app.request(`/media/${body.media.filename}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("application/pdf");
    expect(served.headers.get("content-disposition")).toBe(
      'inline; filename="Lebenslauf-A-2026.pdf"',
    );
    expect(Buffer.from(await served.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("names a CV after its owner and language, whatever it was uploaded as", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await seed();
    await getDb().update(siteProfile).set({ name: "Jürgen Müller" });
    const { body } = await upload(PDF, "final_v3 (1).pdf", "application/pdf");
    const disposition = async () =>
      (await app.request(`/media/${body.media.filename}`)).headers.get("content-disposition");

    expect((await client.put("/admin/resumes/de", { mediaId: body.media.id })).status).toBe(200);
    expect(await disposition()).toBe('inline; filename="Jurgen-Muller-CV-de.pdf"');

    // One file as the CV for both languages carries no language.
    expect((await client.put("/admin/resumes/en", { mediaId: body.media.id })).status).toBe(200);
    expect(await disposition()).toBe('inline; filename="Jurgen-Muller-CV.pdf"');
  });

  it("refuses an upload over the limit before reading it", async () => {
    vi.stubEnv("MEDIA_MAX_BYTES", "100");
    try {
      const res = await client.post("/admin/media", form(Buffer.alloc(500, 1)));
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: "file_too_large", limit: 100 });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("media reconcile", () => {
  it("counts variant files as known, not as orphans", async () => {
    const photo = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();
    const { body } = await upload(photo);
    const ours = [
      body.media.filename,
      ...body.media.variants.map((v) => v.path.replace("/media/", "")),
    ];

    // The media root is shared by the whole file, so earlier tests' files are
    // (correctly) orphans here; only this upload's files are checked.
    const report = (await (await client.get("/admin/media-reconcile")).json()) as {
      missingFiles: string[];
      orphanFiles: string[];
      totalAssets: number;
    };
    expect(report.missingFiles).toEqual([]);
    expect(report.totalAssets).toBe(1);
    expect(report.orphanFiles.filter((name) => ours.includes(name))).toEqual([]);
  });
});

describe("media delete", () => {
  it("deletes an unused image and stops serving it", async () => {
    const { body } = await upload();
    expect((await client.delete(`/admin/media/${body.media.id}`)).status).toBe(200);
    expect((await app.request(`/media/${body.media.filename}`)).status).toBe(404);
  });

  it("removes the variant files along with the original", async () => {
    const photo = await sharp({
      create: { width: 800, height: 800, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const { body } = await upload(photo);
    const variantFiles = body.media.variants.map((v) => v.path.replace("/media/", ""));
    expect(variantFiles.length).toBeGreaterThan(0);
    expect(variantFiles.every(onDisk)).toBe(true);

    expect((await client.delete(`/admin/media/${body.media.id}`)).status).toBe(200);
    expect(onDisk(body.media.filename)).toBe(false);
    expect(variantFiles.some(onDisk)).toBe(false);
    expect(await getDb().select().from(mediaVariants)).toEqual([]);
  });

  it("answers not_found for an unknown id", async () => {
    const res = await client.delete("/admin/media/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  describe("with published content", () => {
    beforeEach(async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await seed();
    });

    /** Puts the asset on the first project in the draft. */
    async function useOnFirstProject(media: MediaResponse["media"]): Promise<string> {
      const [first] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
      await getDb().update(projects).set({ coverId: media.id }).where(eq(projects.id, first!.id));
      return first!.id;
    }

    async function removeFromProject(projectId: string): Promise<void> {
      await getDb().update(projects).set({ coverId: null }).where(eq(projects.id, projectId));
    }

    it("refuses to delete an image the draft still uses", async () => {
      const { body } = await upload();
      await useOnFirstProject(body.media);

      const res = await client.delete(`/admin/media/${body.media.id}`);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "media_in_use" });
    });

    /** Out of the draft, but the live site still shows it: deleting would break it now. */
    it("refuses to delete an image the live site shows, even when confirmed", async () => {
      const { body } = await upload();
      const projectId = await useOnFirstProject(body.media);
      await publishAll();
      await removeFromProject(projectId);

      const res = await client.delete(`/admin/media/${body.media.id}?confirm=1`);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "media_in_use_live" });
      expect(onDisk(body.media.filename)).toBe(true);
    });

    /** Only history uses it: a rollback would need it, so ask first. */
    it("asks for confirmation when a recent publication used the image", async () => {
      const { body } = await upload();
      const projectId = await useOnFirstProject(body.media);
      const withImage = await publishAll();
      await removeFromProject(projectId);
      await publishAll();

      const first = await client.delete(`/admin/media/${body.media.id}`);
      expect(first.status).toBe(409);
      expect(await first.json()).toEqual({
        error: "media_in_history",
        publications: [withImage.publicationId],
      });

      const confirmed = await client.delete(`/admin/media/${body.media.id}?confirm=1`);
      expect(confirmed.status).toBe(200);
      expect(onDisk(body.media.filename)).toBe(false);
    });
  });
});
