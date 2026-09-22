import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";

const app = createApp();
let client: TestClient;

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  client = new TestClient(app);
  await client.login();
});

function translation(name: string) {
  return {
    name,
    descriptor: "",
    hook: "",
    problem: "<p>problem</p>",
    aiArchitecture: "<p>architecture</p>",
    fullStackInfra: "<p>infra</p>",
    outcomes: [],
  };
}

function projectBody(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    imageId: null,
    imagePath: "",
    stack: ["TypeScript"],
    linkLive: "",
    linkRepo: "",
    linkCaseStudy: "",
    isVisible: true,
    translations: { en: translation(`EN ${slug}`), de: translation(`DE ${slug}`) },
    ...overrides,
  };
}

async function createProject(slug: string, overrides?: Record<string, unknown>) {
  const res = await client.post("/admin/projects", projectBody(slug, overrides));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function listProjects() {
  const res = await client.get("/admin/projects");
  return ((await res.json()) as {
    projects: { id: string; slug: string; translations: Record<string, { problem: string }> }[];
  }).projects;
}

describe("projects", () => {
  it("creates a project with both translations", async () => {
    const id = await createProject("alpha");
    const [project] = await listProjects();
    expect(project?.id).toBe(id);
    expect(Object.keys(project!.translations).sort()).toEqual(["de", "en"]);
  });

  it("refuses a duplicate slug", async () => {
    await createProject("alpha");
    const res = await client.post("/admin/projects", projectBody("alpha"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "duplicate_slug" });
  });

  it("sanitizes rich text on the way in", async () => {
    await createProject("alpha", {
      translations: {
        en: { ...translation("EN"), problem: '<p onclick="x()">ok</p><script>alert(1)</script>' },
        de: translation("DE"),
      },
    });
    const [project] = await listProjects();
    expect(project!.translations.en!.problem).toBe("<p>ok</p>");
  });

  it("reorders by the given id list", async () => {
    const a = await createProject("alpha");
    const b = await createProject("beta");
    const c = await createProject("gamma");

    const res = await client.patch("/admin/projects/reorder", { ids: [c, a, b] });
    expect(res.status).toBe(200);
    expect((await listProjects()).map((p) => p.slug)).toEqual(["gamma", "alpha", "beta"]);
  });

  it("rejects a reorder that names an unknown project", async () => {
    const a = await createProject("alpha");
    const res = await client.patch("/admin/projects/reorder", {
      ids: [a, "00000000-0000-4000-8000-000000000000"],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_ids" });
  });

  it("answers 404 for a well-formed id that does not exist", async () => {
    const res = await client.delete("/admin/projects/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  /** Used to reach Postgres as an invalid uuid and come back as a bare 500. */
  it("answers 400 for a malformed id instead of a server error", async () => {
    const del = await client.delete("/admin/projects/not-a-uuid");
    expect(del.status).toBe(400);
    expect(await del.json()).toEqual({ error: "invalid_id" });

    const reorder = await client.patch("/admin/projects/reorder", { ids: ["not-a-uuid"] });
    expect(reorder.status).toBe(400);
  });
});
