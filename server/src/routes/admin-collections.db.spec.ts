import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { mediaAssets } from "../db/schema.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";

const app = createApp();
let client: TestClient;

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  client = new TestClient(app);
  await client.login();
});

let assetCounter = 0;
async function asset(kind: "image" | "document" = "image"): Promise<string> {
  assetCounter++;
  const hex = assetCounter.toString(16).padStart(12, "0");
  const [row] = await getDb()
    .insert(mediaAssets)
    .values({
      filename: `00000000-0000-4000-8000-${hex}.${kind === "image" ? "png" : "pdf"}`,
      originalName: kind === "image" ? "shot.png" : "cv.pdf",
      mime: kind === "image" ? "image/png" : "application/pdf",
      kind,
      byteSize: 10,
      width: kind === "image" ? 1600 : null,
      height: kind === "image" ? 1000 : null,
      checksumSha256: Buffer.alloc(32, assetCounter),
    })
    .returning({ id: mediaAssets.id });
  return row!.id;
}

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
  return (
    (await res.json()) as {
      projects: {
        id: string;
        slug: string;
        isVisible: boolean;
        translations: Record<string, { name: string }>;
      }[];
    }
  ).projects;
}

interface FullProject {
  id: string;
  slug: string;
  coverId: string | null;
  coverPath: string | null;
  imagePath: string;
  periodStart: string | null;
  category: string;
  gallery: { mediaId: string; caption: { en: string; de: string }; path: string }[];
  translations: Record<string, { problem: string; body: string; metrics: unknown[] }>;
}

async function getProject(id: string): Promise<FullProject> {
  const res = await client.get(`/admin/projects/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { project: FullProject }).project;
}

describe("projects", () => {
  it("creates a project with both translations", async () => {
    const id = await createProject("alpha");
    const [project] = await listProjects();
    expect(project?.id).toBe(id);
    expect(Object.keys(project!.translations).sort()).toEqual(["de", "en"]);
  });

  it("lists names only and serves the full project by id", async () => {
    const id = await createProject("alpha", {
      translations: {
        en: { ...translation("EN"), body: "<h2>Why</h2><p>long read</p>" },
        de: translation("DE"),
      },
    });
    const [listed] = await listProjects();
    expect(listed!.translations["en"]).toEqual({ name: "EN", hasCaseStudy: true });

    const full = await getProject(id);
    expect(full.translations["en"]!.body).toBe("<h2>Why</h2><p>long read</p>");
  });

  it("refuses a duplicate slug", async () => {
    await createProject("alpha");
    const res = await client.post("/admin/projects", projectBody("alpha"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "duplicate_slug" });
  });

  it("sanitizes rich text on the way in", async () => {
    const id = await createProject("alpha", {
      translations: {
        en: {
          ...translation("EN"),
          problem: '<p onclick="x()">ok</p><script>alert(1)</script>',
          body: '<p>x</p><img src="https://evil.example/t.gif"><img src="/media/a.png" onerror="y()">',
        },
        de: translation("DE"),
      },
    });
    const full = await getProject(id);
    expect(full.translations["en"]!.problem).toBe("<p>ok</p>");
    expect(full.translations["en"]!.body).toBe('<p>x</p><img src="/media/a.png" />');
  });

  it("stores the cover, period, category and gallery, and mirrors the cover into the v1 columns", async () => {
    const cover = await asset();
    const shot = await asset();
    const id = await createProject("alpha", {
      coverId: cover,
      periodStart: "2025-01-01",
      periodEnd: null,
      category: "ai-platform",
      tags: ["rag"],
      gallery: [{ mediaId: shot, caption: { en: "Dashboard", de: "Übersicht" } }],
      translations: {
        en: { ...translation("EN"), metrics: [{ value: "40%", label: "less latency" }] },
        de: translation("DE"),
      },
    });

    const full = await getProject(id);
    expect(full).toMatchObject({
      coverId: cover,
      periodStart: "2025-01-01",
      category: "ai-platform",
    });
    expect(full.coverPath).toMatch(/^\/media\/.+\.png$/);
    expect(full.imagePath).toBe(full.coverPath);
    expect(full.gallery).toEqual([
      {
        mediaId: shot,
        caption: { en: "Dashboard", de: "Übersicht" },
        path: expect.stringMatching(/^\/media\//),
      },
    ]);
    expect(full.translations["en"]!.metrics).toEqual([{ value: "40%", label: "less latency" }]);
  });

  it("refuses a PDF as a cover, and a period that ends before it starts", async () => {
    const pdf = await asset("document");
    const bad = await client.post("/admin/projects", projectBody("alpha", { coverId: pdf }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_media" });

    const backwards = await client.post(
      "/admin/projects",
      projectBody("beta", { periodStart: "2025-06-01", periodEnd: "2025-01-01" }),
    );
    expect(backwards.status).toBe(400);
  });

  it("shows and hides without resending the project", async () => {
    const id = await createProject("alpha");
    const res = await client.patch(`/admin/projects/${id}/visibility`, { isVisible: false });
    expect(res.status).toBe(200);
    expect((await listProjects())[0]!.isVisible).toBe(false);
  });

  it("reorders by the given id list", async () => {
    const a = await createProject("alpha");
    const b = await createProject("beta");
    const c = await createProject("gamma");

    const res = await client.patch("/admin/projects/reorder", { ids: [c, a, b] });
    expect(res.status).toBe(200);
    expect((await listProjects()).map((p) => p.slug)).toEqual(["gamma", "alpha", "beta"]);
  });

  it("rejects a reorder that names an unknown project or one twice", async () => {
    const a = await createProject("alpha");
    const unknown = await client.patch("/admin/projects/reorder", {
      ids: [a, "00000000-0000-4000-8000-000000000000"],
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "unknown_ids" });

    const twice = await client.patch("/admin/projects/reorder", { ids: [a, a] });
    expect(twice.status).toBe(400);
  });

  it("answers 404 for a well-formed id that does not exist", async () => {
    const res = await client.delete("/admin/projects/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
    expect((await client.get("/admin/projects/00000000-0000-4000-8000-000000000000")).status).toBe(
      404,
    );
  });

  /** Used to reach Postgres as an invalid uuid and come back as a bare 500. */
  it("answers 400 for a malformed id instead of a server error", async () => {
    const del = await client.delete("/admin/projects/not-a-uuid");
    expect(del.status).toBe(400);
    expect(await del.json()).toEqual({ error: "invalid_id" });

    expect((await client.get("/admin/projects/not-a-uuid")).status).toBe(400);
    const reorder = await client.patch("/admin/projects/reorder", { ids: ["not-a-uuid"] });
    expect(reorder.status).toBe(400);
  });
});

describe("skills and socials", () => {
  it("accepts any registry-style icon key and rejects anything else", async () => {
    const ok = await client.post("/admin/socials", {
      label: "Mastodon",
      href: "https://m.example",
      icon: "mastodon",
    });
    expect(ok.status).toBe(201);
    const bad = await client.post("/admin/socials", {
      label: "X",
      href: "https://x",
      icon: "Bad Icon!",
    });
    expect(bad.status).toBe(400);
  });

  it("refuses a duplicate skill id", async () => {
    const skill = {
      id: "core",
      icon: "cpu",
      span: "lg",
      items: ["a"],
      translations: {
        en: { title: "Core", caption: "", narrative: "" },
        de: { title: "Kern", caption: "", narrative: "" },
      },
    };
    expect((await client.post("/admin/skills", skill)).status).toBe(201);
    const again = await client.post("/admin/skills", skill);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "duplicate_id" });
  });
});

function experienceBody(orgName: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "work",
    orgName,
    startDate: "2023-04-01",
    endDate: null,
    translations: {
      en: { title: "Engineer", summary: "Built things", highlights: ["Shipped X"] },
      de: { title: "Ingenieur", summary: "Dinge gebaut", highlights: ["X ausgeliefert"] },
    },
    ...overrides,
  };
}

describe("experiences", () => {
  it("creates, lists in order, updates, reorders and deletes", async () => {
    const first = await client.post("/admin/experiences", experienceBody("Acme"));
    expect(first.status).toBe(201);
    const a = ((await first.json()) as { id: string }).id;
    const b = (
      (await (await client.post("/admin/experiences", experienceBody("Globex"))).json()) as {
        id: string;
      }
    ).id;

    const list = async () =>
      (
        (await (await client.get("/admin/experiences")).json()) as {
          experiences: {
            id: string;
            orgName: string;
            translations: Record<string, { title: string }>;
          }[];
        }
      ).experiences;
    expect((await list()).map((e) => e.orgName)).toEqual(["Acme", "Globex"]);
    expect((await list())[0]!.translations["de"]!.title).toBe("Ingenieur");

    const put = await client.put(
      `/admin/experiences/${a}`,
      experienceBody("Acme Corp", { employmentType: "full-time" }),
    );
    expect(put.status).toBe(200);

    expect((await client.patch("/admin/experiences/reorder", { ids: [b, a] })).status).toBe(200);
    expect((await list()).map((e) => e.orgName)).toEqual(["Globex", "Acme Corp"]);

    expect((await client.delete(`/admin/experiences/${b}`)).status).toBe(200);
    expect((await list()).map((e) => e.orgName)).toEqual(["Acme Corp"]);
  });

  it("validates the period, the employment type and the logo", async () => {
    expect(
      (
        await client.post(
          "/admin/experiences",
          experienceBody("A", { startDate: "2024-01-01", endDate: "2023-01-01" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await client.post("/admin/experiences", experienceBody("A", { employmentType: "slavery" })))
        .status,
    ).toBe(400);
    const pdf = await asset("document");
    expect(
      (await client.post("/admin/experiences", experienceBody("A", { logoId: pdf }))).status,
    ).toBe(400);
  });
});

function postBody(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    status: "draft",
    translations: {
      en: { title: `EN ${slug}`, excerpt: "Short", body: "<p>Hello</p>" },
      de: null,
    },
    ...overrides,
  };
}

describe("posts", () => {
  it("creates a post that exists in one language, and removes a language again", async () => {
    const created = await client.post(
      "/admin/posts",
      postBody("hello", {
        translations: {
          en: { title: "Hello", body: "<p>x</p>" },
          de: { title: "Hallo", body: "<p>y</p>" },
        },
      }),
    );
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const get = async () =>
      (
        (await (await client.get(`/admin/posts/${id}`)).json()) as {
          post: { translations: { en: { title: string } | null; de: { title: string } | null } };
        }
      ).post;
    expect((await get()).translations.de?.title).toBe("Hallo");

    await client.put(`/admin/posts/${id}`, postBody("hello"));
    expect((await get()).translations.de).toBeNull();
  });

  it("requires a publish date for a published post, and one language at least", async () => {
    expect((await client.post("/admin/posts", postBody("a", { status: "published" }))).status).toBe(
      400,
    );
    expect(
      (await client.post("/admin/posts", postBody("b", { translations: { en: null, de: null } })))
        .status,
    ).toBe(400);
  });

  it("refuses a duplicate slug", async () => {
    expect((await client.post("/admin/posts", postBody("same"))).status).toBe(201);
    const again = await client.post("/admin/posts", postBody("same"));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "duplicate_slug" });
  });
});

describe("profile and CVs", () => {
  it("keeps the extended identity and refuses an invalid time zone or country", async () => {
    const base = {
      name: "A",
      handle: "a",
      contactEmail: "a@example.com",
      primaryCtaHref: "#projects",
      secondaryCtaHref: "#contact",
    };
    const avatar = await asset();
    const ok = await client.put("/admin/profile", {
      ...base,
      siteUrl: "https://alirezarastineh.me",
      availability: "limited",
      locationCity: "Berlin",
      locationCountry: "DE",
      timezone: "Europe/Berlin",
      avatarId: avatar,
    });
    // No profile row yet in an empty database: nothing to update, still valid input.
    expect(ok.status).toBe(200);

    expect((await client.put("/admin/profile", { ...base, timezone: "Mars/Olympus" })).status).toBe(
      400,
    );
    expect(
      (await client.put("/admin/profile", { ...base, locationCountry: "germany" })).status,
    ).toBe(400);
    expect(
      (await client.put("/admin/profile", { ...base, siteUrl: "https://x.example/path" })).status,
    ).toBe(400);
  });

  it("sets a CV per language from a PDF, and only from a PDF", async () => {
    const pdf = await asset("document");
    const image = await asset("image");

    expect((await client.put("/admin/resumes/en", { mediaId: image })).status).toBe(400);
    expect((await client.put("/admin/resumes/en", { mediaId: pdf })).status).toBe(200);
    expect((await client.put("/admin/resumes/fr", { mediaId: pdf })).status).toBe(400);

    const { resumes } = (await (await client.get("/admin/resumes")).json()) as {
      resumes: Record<string, { mediaId: string; path: string } | null>;
    };
    expect(resumes["en"]).toMatchObject({ mediaId: pdf, path: expect.stringMatching(/\.pdf$/) });
    expect(resumes["de"]).toBeNull();

    expect((await client.delete("/admin/resumes/en")).status).toBe(200);
  });
});
