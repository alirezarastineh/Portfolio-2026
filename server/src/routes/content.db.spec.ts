import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { invalidateContentCache } from "../content/cache.js";
import { publishAll } from "../content/publish.js";
import type { AppContent, Doc } from "../content/schema.js";
import * as v1 from "../content/schema-v1.js";
import { getDb } from "../db/client.js";
import { contentPointers, contentPublications, contentVersions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed(); // drafts + a first publish of both locales
  await createAdmin();
});

async function liveContent(locale: "en" | "de" = "en"): Promise<AppContent> {
  const res = await app.request(`/v2/content/${locale}`);
  expect(res.status).toBe(200);
  return (await res.json()) as AppContent;
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
    const etag = first.headers.get("etag")!;

    const second = await app.request("/v2/content/en", { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("rejects an unsupported locale", async () => {
    expect((await app.request("/v2/content/fr")).status).toBe(400);
    expect((await app.request("/v2/content/fr/legal/imprint")).status).toBe(400);
  });

  it("serves a doc with its own validator, keyed by the live version", async () => {
    const res = await app.request("/v2/content/de/legal/imprint");
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"de-\d+-legal:imprint"$/);
    const doc = (await res.json()) as Doc;
    expect(doc).toMatchObject({ kind: "legal", doc: "imprint", title: "Impressum" });

    const again = await app.request("/v2/content/de/legal/imprint", {
      headers: { "if-none-match": etag },
    });
    expect(again.status).toBe(304);
  });

  it("answers 404 for a doc that does not exist or a kind it does not know", async () => {
    expect((await app.request("/v2/content/en/posts/nope")).status).toBe(404);
    expect((await app.request("/v2/content/en/legal/cookies")).status).toBe(404);
    expect((await app.request("/v2/content/en/secrets/x")).status).toBe(404);
    expect((await app.request("/v2/content/en/posts/Bad_Slug")).status).toBe(404);
  });
});

describe("public content API (v1, downcast)", () => {
  it("serves the live content in the v1 shape for clients built before v2", async () => {
    const res = await app.request("/v1/content/en");
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^W\/"en-\d+-v1"$/);
    const body = (await res.json()) as unknown;
    const parsed = v1.appContentSchema.safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data?.version).toBe(1);
  });

  it("drops the socials a v1 client cannot draw", async () => {
    const client = new TestClient(app);
    await client.login();
    await client.post("/admin/socials", {
      label: "Mastodon",
      href: "https://m.example",
      icon: "mastodon",
    });
    await publishAll();

    const v2 = await liveContent();
    expect(v2.socials.some((s) => s.icon === "mastodon")).toBe(true);
    const old = (await (await app.request("/v1/content/en")).json()) as v1.AppContent;
    expect(old.socials.some((s) => s.label === "Mastodon")).toBe(false);
  });
});

describe("a live snapshot published before v2", () => {
  /** What the first request after deploying v2 sees, until the next publish. */
  async function pointAtV1Snapshot() {
    const v1Payload = (await (await app.request("/v1/content/en")).json()) as v1.AppContent;
    const [pub] = await getDb()
      .insert(contentPublications)
      .values({ kind: "publish", schemaVersion: 1 })
      .returning({ id: contentPublications.id });
    const [version] = await getDb()
      .insert(contentVersions)
      .values({ locale: "en", payload: v1Payload, checksum: "legacy", publicationId: pub!.id })
      .returning({ id: contentVersions.id });
    await getDb()
      .update(contentPointers)
      .set({ versionId: version!.id })
      .where(eq(contentPointers.locale, "en"));
    invalidateContentCache();
    return version!.id;
  }

  it("is served upcast to v2, with the bundled legal pages", async () => {
    const versionId = await pointAtV1Snapshot();
    const res = await app.request("/v2/content/en");
    expect(res.headers.get("x-content-version")).toBe(String(versionId));
    const body = (await res.json()) as AppContent;
    expect(body.version).toBe(2);
    expect(body.experiences).toEqual([]);

    const imprint = await app.request("/v2/content/en/legal/imprint");
    expect(imprint.status).toBe(200);
    expect(((await imprint.json()) as Doc).kind).toBe("legal");
  });
});

describe("publish and rollback", () => {
  async function renameFirstProject(client: TestClient, name: string) {
    const list = (await (await client.get("/admin/projects")).json()) as {
      projects: { id: string }[];
    };
    const id = list.projects[0]!.id;
    const { project } = (await (await client.get(`/admin/projects/${id}`)).json()) as {
      project: Record<string, unknown> & { translations: Record<string, object> };
    };
    const { id: _id, coverPath, position, createdAt, updatedAt, ...rest } = project;
    void [_id, coverPath, position, createdAt, updatedAt];

    const res = await client.put(`/admin/projects/${id}`, {
      ...rest,
      translations: { ...project.translations, en: { ...project.translations["en"], name } },
    });
    expect(res.status).toBe(200);
  }

  it("keeps a draft edit off the live site until it is published", async () => {
    const client = new TestClient(app);
    await client.login();
    const before = await liveContent();

    await renameFirstProject(client, "Renamed in draft");
    expect((await liveContent()).projects[0]!.name).toBe(before.projects[0]!.name);

    const publish = await client.post("/admin/publish", { label: "rename" });
    expect(publish.status).toBe(200);
    expect((await liveContent()).projects[0]!.name).toBe("Renamed in draft");
  });

  it("invalidates the previous validator when a new version goes live", async () => {
    const client = new TestClient(app);
    await client.login();
    const oldEtag = (await app.request("/v2/content/en")).headers.get("etag")!;

    await renameFirstProject(client, "Next version");
    await client.post("/admin/publish", {});

    const res = await app.request("/v2/content/en", { headers: { "if-none-match": oldEtag } });
    expect(res.status).toBe(200);
  });

  it("rolls a locale back to an earlier payload", async () => {
    const client = new TestClient(app);
    await client.login();
    const original = (await liveContent()).projects[0]!.name;

    await renameFirstProject(client, "Regrettable edit");
    await client.post("/admin/publish", {});
    expect((await liveContent()).projects[0]!.name).toBe("Regrettable edit");

    const revisions = (await (await client.get("/admin/revisions")).json()) as {
      revisions: { id: number; locale: string; live: boolean }[];
    };
    const earlierEn = revisions.revisions.find((r) => r.locale === "en" && !r.live)!;

    const rollback = await client.post(`/admin/revisions/${earlierEn.id}/rollback`, {});
    expect(rollback.status).toBe(200);
    expect((await liveContent()).projects[0]!.name).toBe(original);
  });

  it("rejects a malformed revision id", async () => {
    const client = new TestClient(app);
    await client.login();
    expect((await client.post("/admin/revisions/abc/rollback", {})).status).toBe(400);
  });
});
