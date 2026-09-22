import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import type { AppContent } from "../content/schema.js";
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
  const res = await app.request(`/v1/content/${locale}`);
  expect(res.status).toBe(200);
  return (await res.json()) as AppContent;
}

describe("public content API", () => {
  it("serves the published snapshot with a version validator", async () => {
    const res = await app.request("/v1/content/en");
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^W\/"en-\d+"$/);
    expect(res.headers.get("x-content-version")).toMatch(/^\d+$/);
    expect(((await res.json()) as AppContent).locale).toBe("en");
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const first = await app.request("/v1/content/en");
    const etag = first.headers.get("etag")!;

    const second = await app.request("/v1/content/en", { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("rejects an unsupported locale", async () => {
    const res = await app.request("/v1/content/fr");
    expect(res.status).toBe(400);
  });
});

describe("publish and rollback", () => {
  async function renameFirstProject(client: TestClient, name: string) {
    const list = await client.get("/admin/projects");
    const { projects } = (await list.json()) as {
      projects: (Record<string, unknown> & { id: string; translations: Record<string, object> })[];
    };
    const project = projects[0]!;
    const { id, position, createdAt, updatedAt, translations, ...rest } = project;
    void position;
    void createdAt;
    void updatedAt;

    const res = await client.put(`/admin/projects/${id}`, {
      ...rest,
      translations: { ...translations, en: { ...translations.en, name } },
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
    const oldEtag = (await app.request("/v1/content/en")).headers.get("etag")!;

    await renameFirstProject(client, "Next version");
    await client.post("/admin/publish", {});

    const res = await app.request("/v1/content/en", { headers: { "if-none-match": oldEtag } });
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
