import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";

const app = createApp();
let client: TestClient;

/** A valid 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

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
  media: { id: string; filename: string; width: number | null; height: number | null };
}

async function upload(bytes = PNG): Promise<{ status: number; body: MediaResponse }> {
  const res = await client.post("/admin/media", form(bytes));
  return { status: res.status, body: (await res.json()) as MediaResponse };
}

describe("media upload", () => {
  it("stores an image and serves it publicly", async () => {
    const { status, body } = await upload();
    expect(status).toBe(201);
    expect(body.media).toMatchObject({ width: 1, height: 1 });

    const served = await app.request(`/media/${body.media.filename}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);
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

  it("refuses to delete an image a project still uses", async () => {
    const { body } = await upload();
    const project = await client.post("/admin/projects", {
      slug: "alpha",
      imageId: body.media.id,
      imagePath: `/media/${body.media.filename}`,
      stack: [],
      linkLive: "",
      linkRepo: "",
      linkCaseStudy: "",
      isVisible: true,
      translations: {
        en: { name: "A", descriptor: "", hook: "", problem: "", aiArchitecture: "", fullStackInfra: "", outcomes: [] },
        de: { name: "A", descriptor: "", hook: "", problem: "", aiArchitecture: "", fullStackInfra: "", outcomes: [] },
      },
    });
    expect(project.status).toBe(201);

    const res = await client.delete(`/admin/media/${body.media.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "media_in_use" });
  });

  it("deletes an unused image and stops serving it", async () => {
    const { body } = await upload();
    expect((await client.delete(`/admin/media/${body.media.id}`)).status).toBe(200);
    expect((await app.request(`/media/${body.media.filename}`)).status).toBe(404);
  });
});
