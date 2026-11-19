import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { invalidateContentCache } from "../content/cache.js";
import type { AppContent, Doc } from "../content/schema.js";
import { getDb } from "../db/client.js";
import { contentPointers, contentPublications, contentVersions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import { v1Snapshot } from "../test/v1-snapshot.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  await seed(); // drafts + a first publish of both locales
  await createAdmin();
});

async function liveContent(locale: "en" | "de" = "en"): Promise<AppContent> {
  const res = await app.request(`/v2/content/${locale}`);
  expect(res.status).toBe(200);
  return (await res.json()) as AppContent;
}

/** What the first request after deploying v2 sees, until the next publish. */
async function pointAtV1Snapshot() {
  const v1Payload = v1Snapshot("en");
  const [pub] = await getDb()
    .insert(contentPublications)
    .values({ kind: "publish", schemaVersion: 1 })
    .returning({ id: contentPublications.id });
  const [version] = await getDb()
    .insert(contentVersions)
    .values({ locale: "en", payload: v1Payload, checksum: "legacy", publicationId: pub.id })
    .returning({ id: contentVersions.id });
  await getDb()
    .update(contentPointers)
    .set({ versionId: version.id })
    .where(eq(contentPointers.locale, "en"));
  invalidateContentCache();
  return version.id;
}

const OMITTED_PROJECT_FIELDS = new Set(["id", "coverPath", "position", "createdAt", "updatedAt"]);

async function renameFirstProject(client: TestClient, name: string) {
  const listRes = await client.get("/admin/projects");
  const list = (await listRes.json()) as {
    projects: { id: string }[];
  };
  const id = list.projects[0].id;
  const projectRes = await client.get(`/admin/projects/${id}`);
  const { project } = (await projectRes.json()) as {
    project: Record<string, unknown> & { translations: Record<string, object> };
  };
  const rest = Object.fromEntries(
    Object.entries(project).filter(([key]) => !OMITTED_PROJECT_FIELDS.has(key)),
  );

  const res = await client.put(`/admin/projects/${id}`, {
    ...rest,
    translations: { ...project.translations, en: { ...project.translations["en"], name } },
  });
  expect(res.status).toBe(200);
}

describe("public content API (v2)", () => {
  it("serves the published core with a version validator", async () => {
    const res = await app.request("/v2/content/en");
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^W\/"en-\d+"$/);
    expect(res.headers.get("x-content-version")).toMatch(/^\d+$/);
    const body = (await res.json()) as AppContent;
    expect(body).toMatchObject({ version: 2, locale: "en" });
    expect(body.legal.map((l) => l.doc)).toEqual(["imprint", "privacy"]);
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const first = await app.request("/v2/content/en");
    const etag = first.headers.get("etag");
    if (!etag) {
      throw new Error("expected ETag header");
    }

    const second = await app.request("/v2/content/en", { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("rejects an unsupported locale", async () => {
    const contentRes = await app.request("/v2/content/fr");
    expect(contentRes.status).toBe(400);
    const docRes = await app.request("/v2/content/fr/legal/imprint");
    expect(docRes.status).toBe(400);
  });

  it("serves a doc with its own validator, keyed by the live version", async () => {
    const res = await app.request("/v2/content/de/legal/imprint");
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    if (!etag) {
      throw new Error("expected ETag header");
    }
    expect(etag).toMatch(/^W\/"de-\d+-legal:imprint"$/);
    const doc = (await res.json()) as Doc;
    expect(doc).toMatchObject({ kind: "legal", doc: "imprint", title: "Impressum" });

    const again = await app.request("/v2/content/de/legal/imprint", {
      headers: { "if-none-match": etag },
    });
    expect(again.status).toBe(304);
  });

  it("answers 404 for a doc that does not exist or a kind it does not know", async () => {
    const responses = await Promise.all([
      app.request("/v2/content/en/posts/nope"),
      app.request("/v2/content/en/legal/cookies"),
      app.request("/v2/content/en/secrets/x"),
      app.request("/v2/content/en/posts/Bad_Slug"),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
    }
  });
});

describe("the retired v1 contract", () => {
  it("is no longer served", async () => {
    const res = await app.request("/v1/content/en");
    expect(res.status).toBe(404);
  });
});

describe("a live snapshot published before v2", () => {
  it("is served upcast to v2, with the bundled legal pages", async () => {
    const versionId = await pointAtV1Snapshot();
    const res = await app.request("/v2/content/en");
    expect(res.headers.get("x-content-version")).toBe(String(versionId));
    const body = (await res.json()) as AppContent;
    expect(body.version).toBe(2);
    expect(body.experiences).toEqual([]);
    // Its placeholder images live in the payload, not in the (dropped) v1 columns.
    expect(body.projects[0].cover).toMatchObject({ src: "/projects/project-one.svg" });

    const imprint = await app.request("/v2/content/en/legal/imprint");
    expect(imprint.status).toBe(200);
    expect(((await imprint.json()) as Doc).kind).toBe("legal");
  });
});

describe("publish and rollback", () => {
  it("keeps a draft edit off the live site until it is published", async () => {
    const client = new TestClient(app);
    await client.login();
    const before = await liveContent();

    await renameFirstProject(client, "Renamed in draft");
    const stillLive = await liveContent();
    expect(stillLive.projects[0].name).toBe(before.projects[0].name);

    const publish = await client.post("/admin/publish", { label: "rename" });
    expect(publish.status).toBe(200);
    const updatedLive = await liveContent();
    expect(updatedLive.projects[0].name).toBe("Renamed in draft");
  });

  it("invalidates the previous validator when a new version goes live", async () => {
    const client = new TestClient(app);
    await client.login();
    const initialRes = await app.request("/v2/content/en");
    const oldEtag = initialRes.headers.get("etag");
    if (!oldEtag) {
      throw new Error("expected ETag header");
    }

    await renameFirstProject(client, "Next version");
    await client.post("/admin/publish", {});

    const res = await app.request("/v2/content/en", { headers: { "if-none-match": oldEtag } });
    expect(res.status).toBe(200);
  });

  it("rolls back to an earlier publication", async () => {
    const client = new TestClient(app);
    await client.login();
    const initial = await liveContent();
    const original = initial.projects[0].name;

    await renameFirstProject(client, "Regrettable edit");
    await client.post("/admin/publish", {});
    const afterPublish = await liveContent();
    expect(afterPublish.projects[0].name).toBe("Regrettable edit");

    const pubsRes = await client.get("/admin/publications");
    const { publications } = (await pubsRes.json()) as {
      publications: { id: number; live: boolean }[];
    };
    const earlier = publications.find((p) => !p.live);
    if (!earlier) {
      throw new Error("expected an earlier publication");
    }

    const rollback = await client.post(`/admin/publications/${earlier.id}/rollback`, {});
    expect(rollback.status).toBe(200);
    const afterRollback = await liveContent();
    expect(afterRollback.projects[0].name).toBe(original);
  });

  it("rejects a malformed publication id", async () => {
    const client = new TestClient(app);
    await client.login();
    const res = await client.post("/admin/publications/abc/rollback", {});
    expect(res.status).toBe(400);
  });

  it("no longer offers the per-version rollback or the revisions list", async () => {
    const client = new TestClient(app);
    await client.login();
    const [version] = await getDb().select({ id: contentVersions.id }).from(contentVersions);
    const rollbackRes = await client.post(`/admin/revisions/${version.id}/rollback`, {});
    expect(rollbackRes.status).toBe(404);
    const revisionsRes = await client.get("/admin/revisions");
    expect(revisionsRes.status).toBe(404);
    // One version in full stays: the Publications page's diff reads it.
    const detailRes = await client.get(`/admin/revisions/${version.id}`);
    expect(detailRes.status).toBe(200);
  });
});
