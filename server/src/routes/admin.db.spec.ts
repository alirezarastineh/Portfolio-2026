import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import {
  contentDocuments,
  mediaAssets,
  posts,
  postTranslations,
  projects,
  projectTranslations,
  siteProfile,
} from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";

const app = createApp();
let client: TestClient;

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed(); // drafts + a first publication of both locales
  await createAdmin();
  client = new TestClient(app);
  await client.login();
});

interface Issue {
  path: (string | number)[];
  message: string;
  label?: string;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function section<T>(name: string) {
  return json<{ updatedAt: string; data: Record<"en" | "de", T> }>(
    await client.get(`/admin/sections/${name}`),
  );
}

async function rowTimes(name: string): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ locale: contentDocuments.locale, updatedAt: contentDocuments.updatedAt })
    .from(contentDocuments)
    .where(eq(contentDocuments.section, name));
  return Object.fromEntries(rows.map((r) => [r.locale, r.updatedAt.getTime()]));
}

async function firstProject() {
  const [project] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
  return project!;
}

async function setProjectText(
  locale: "en" | "de",
  change: Partial<{ name: string; hook: string }>,
) {
  const project = await firstProject();
  await getDb()
    .update(projectTranslations)
    .set(change)
    .where(
      and(eq(projectTranslations.projectId, project.id), eq(projectTranslations.locale, locale)),
    );
  return project;
}

describe("section saves", () => {
  it("refuses a save built on an older version", async () => {
    const seo = await section<Record<string, string>>("seo");
    const first = await client.put("/admin/sections/seo", {
      data: { en: { ...seo.data.en, title: "First" }, de: seo.data.de },
      updatedAt: seo.updatedAt,
    });
    expect(first.status).toBe(200);

    const second = await client.put("/admin/sections/seo", {
      data: { en: { ...seo.data.en, title: "Second" }, de: seo.data.de },
      updatedAt: seo.updatedAt,
    });
    expect(second.status).toBe(409);
    expect((await section<Record<string, string>>("seo")).data.en["title"]).toBe("First");
  });

  it("moves only the edited language's timestamp", async () => {
    const before = await rowTimes("seo");
    const seo = await section<Record<string, string>>("seo");
    const res = await client.put("/admin/sections/seo", {
      data: { en: { ...seo.data.en, title: "Only English" }, de: seo.data.de },
      updatedAt: seo.updatedAt,
    });
    const after = await rowTimes("seo");
    expect(after["de"]).toBe(before["de"]);
    expect(after["en"]).toBeGreaterThan(before["en"]!);
    // The token returned is the newest row, so the next save passes.
    const { updatedAt } = await json<{ updatedAt: string }>(res);
    expect(new Date(updatedAt).getTime()).toBe(after["en"]);
  });

  it("returns readable issues with the path of each field", async () => {
    const seo = await section<Record<string, string>>("seo");
    const res = await client.put("/admin/sections/seo", {
      data: { en: { ...seo.data.en, title: "" }, de: seo.data.de },
      updatedAt: seo.updatedAt,
    });
    expect(res.status).toBe(400);
    const body = await json<{ issues: Issue[] }>(res);
    expect(body.issues).toEqual([
      expect.objectContaining({ path: ["en", "title"], message: "Required" }),
    ]);
  });
});

describe("PATCH /admin/sections/ui", () => {
  it("merges the sent groups into the document, leaving the others alone", async () => {
    const ui = await section<Record<string, Record<string, string>>>("ui");
    const res = await client.patch("/admin/sections/ui", {
      groups: {
        skills: {
          en: { heading: "Capabilities", subtitle: ui.data.en["skills"]!["subtitle"] },
          de: ui.data.de["skills"],
        },
      },
      updatedAt: ui.updatedAt,
    });
    expect(res.status).toBe(200);

    const after = await section<Record<string, Record<string, string>>>("ui");
    expect(after.data.en["skills"]!["heading"]).toBe("Capabilities");
    expect(after.data.en["about"]).toEqual(ui.data.en["about"]);
    expect(after.data.de).toEqual(ui.data.de);
  });

  it("puts each issue on the group, locale and field it belongs to", async () => {
    const ui = await section<Record<string, Record<string, string>>>("ui");
    const res = await client.patch("/admin/sections/ui", {
      groups: {
        experience: {
          en: ui.data.en["experience"],
          de: { ...ui.data.de["experience"], years: "Jahre" },
        },
      },
      updatedAt: ui.updatedAt,
    });
    expect(res.status).toBe(400);
    const { issues } = await json<{ issues: Issue[] }>(res);
    expect(issues).toEqual([
      expect.objectContaining({ path: ["groups", "experience", "de", "years"] }),
    ]);
    expect(issues[0]!.message).toContain("{n}");
  });

  it("refuses unknown groups and stale tokens", async () => {
    const ui = await section<Record<string, Record<string, string>>>("ui");
    const unknown = await client.patch("/admin/sections/ui", {
      groups: { nope: { en: {}, de: {} } },
      updatedAt: ui.updatedAt,
    });
    expect(unknown.status).toBe(400);

    const stale = await client.patch("/admin/sections/ui", {
      groups: { skills: { en: ui.data.en["skills"], de: ui.data.de["skills"] } },
      updatedAt: new Date(Date.parse(ui.updatedAt) - 60_000).toISOString(),
    });
    expect(stale.status).toBe(409);
  });
});

describe("PUT /admin/hero", () => {
  async function load() {
    const ui = await section<Record<string, Record<string, string>>>("ui");
    const { profile } = await json<{ profile: Record<string, unknown> }>(
      await client.get("/admin/profile"),
    );
    // The input schema drops the row's extra fields (avatarPath).
    const { updatedAt, ...input } = profile;
    return {
      ui,
      input,
      profileUpdatedAt: updatedAt as string,
      groups: Object.fromEntries(
        ["profile", "hero", "nav"].map((g) => [g, { en: ui.data.en[g], de: ui.data.de[g] }]),
      ),
    };
  }

  it("saves the identity and the copy together", async () => {
    const { ui, input, profileUpdatedAt, groups } = await load();
    const res = await client.put("/admin/hero", {
      profile: { ...input, handle: "@new" },
      ui: {
        ...groups,
        nav: { en: { ...ui.data.en["nav"], work: "Cases" }, de: ui.data.de["nav"] },
      },
      updatedAt: ui.updatedAt,
      profileUpdatedAt,
    });
    expect(res.status).toBe(200);

    const [row] = await getDb().select({ handle: siteProfile.handle }).from(siteProfile);
    expect(row?.handle).toBe("@new");
    expect(
      (await section<Record<string, Record<string, string>>>("ui")).data.en["nav"]!["work"],
    ).toBe("Cases");
  });

  it("reports problems in both parts at once", async () => {
    const { ui, input, profileUpdatedAt, groups } = await load();
    const res = await client.put("/admin/hero", {
      profile: { ...input, timezone: "Mars/Olympus" },
      ui: {
        ...groups,
        hero: { en: { ...ui.data.en["hero"], downloadCv: "" }, de: ui.data.de["hero"] },
      },
      updatedAt: ui.updatedAt,
      profileUpdatedAt,
    });
    expect(res.status).toBe(400);
    const paths = (await json<{ issues: Issue[] }>(res)).issues.map((i) => i.path.join("."));
    expect(paths.sort()).toEqual(["profile.timezone", "ui.hero.en.downloadCv"]);
  });

  it("writes nothing when either part is stale", async () => {
    const { ui, input, groups } = await load();
    const res = await client.put("/admin/hero", {
      profile: { ...input, handle: "@lost" },
      ui: groups,
      updatedAt: ui.updatedAt,
      profileUpdatedAt: new Date(0).toISOString(),
    });
    expect(res.status).toBe(409);
    const [row] = await getDb().select({ handle: siteProfile.handle }).from(siteProfile);
    expect(row?.handle).not.toBe("@lost");
  });
});

describe("publish review", () => {
  interface Review {
    canPublish: boolean;
    locales: {
      locale: string;
      changed: boolean;
      issues: Issue[];
      draft: { projects: { name: string }[] } | null;
      live: { projects: { name: string }[] } | null;
      docs: { key: string; change: string }[];
    }[];
  }

  it("has nothing to publish right after a publish", async () => {
    const review = await json<Review>(await client.get("/admin/publish/review"));
    expect(review.canPublish).toBe(false);
    expect(review.locales.map((l) => [l.locale, l.changed, l.issues.length])).toEqual([
      ["en", false, 0],
      ["de", false, 0],
    ]);
  });

  it("shows both sides of a change, per locale", async () => {
    await setProjectText("de", { name: "Neu" });
    const review = await json<Review>(await client.get("/admin/publish/review"));
    expect(review.canPublish).toBe(true);
    const [en, de] = review.locales;
    expect(en?.changed).toBe(false);
    expect(de?.changed).toBe(true);
    expect(de?.draft?.projects[0]?.name).toBe("Neu");
    expect(de?.live?.projects[0]?.name).not.toBe("Neu");
  });

  it("lists every locale's problems, with list items named by slug", async () => {
    const project = await setProjectText("en", { name: "" });
    await setProjectText("de", { name: "" });

    const review = await json<Review>(await client.get("/admin/publish/review"));
    expect(review.canPublish).toBe(false);
    for (const locale of review.locales) {
      expect(locale.draft).toBeNull();
      expect(locale.issues).toEqual([
        expect.objectContaining({
          label: `projects[${project.slug}].name`,
          path: ["projects", 0, "name"],
          message: "Required",
        }),
      ]);
    }

    const publish = await client.post("/admin/publish", {});
    expect(publish.status).toBe(422);
    const body = await json<{ error: string; detail: { locales: { locale: string }[] } }>(publish);
    expect(body.error).toBe("invalid_draft");
    expect(body.detail.locales.map((l) => l.locale)).toEqual(["en", "de"]);
  });
});

describe("draft preview", () => {
  it("includes draft posts and serves their docs", async () => {
    const [post] = await getDb()
      .insert(posts)
      .values({ slug: "unfinished", status: "draft" })
      .returning({ id: posts.id });
    await getDb().insert(postTranslations).values({
      postId: post!.id,
      locale: "en",
      title: "Unfinished thoughts",
      excerpt: "",
      body: "<p>Soon.</p>",
    });

    const core = await json<{ posts: { slug: string }[] }>(
      await client.get("/admin/content/preview/en"),
    );
    expect(core.posts.map((p) => p.slug)).toContain("unfinished");

    const doc = await client.get("/admin/content/preview/en/posts/unfinished");
    expect(doc.status).toBe(200);
    expect(await json<{ kind: string; title: string }>(doc)).toMatchObject({
      kind: "post",
      title: "Unfinished thoughts",
    });

    expect((await client.get("/admin/content/preview/de/posts/unfinished")).status).toBe(404);
    expect((await client.get("/admin/content/preview/en/nope/unfinished")).status).toBe(404);
  });

  it("answers 422 with the problems when the draft does not build", async () => {
    await setProjectText("en", { name: "" });
    const res = await client.get("/admin/content/preview/en");
    expect(res.status).toBe(422);
    expect((await json<{ issues: Issue[] }>(res)).issues.length).toBeGreaterThan(0);
  });
});

describe("GET /admin/i18n", () => {
  interface Item {
    kind: string;
    id: string;
    missingDe: string[];
    stale: boolean;
    absent: string | null;
  }

  async function items(): Promise<Item[]> {
    return (await json<{ items: Item[] }>(await client.get("/admin/i18n"))).items;
  }

  it("reports German fields left empty", async () => {
    const project = await setProjectText("de", { hook: "" });
    await setProjectText("en", { hook: "A hook" });
    expect(await items()).toContainEqual(
      expect.objectContaining({ kind: "project", id: project.slug, missingDe: ["hook"] }),
    );
  });

  it("marks German as stale only when an edit changed just the English", async () => {
    const project = await firstProject();
    const { project: full } = await json<{ project: Record<string, unknown> }>(
      await client.get(`/admin/projects/${project.id}`),
    );
    // The input schema strips the extra fields of the row (id, previews, timestamps).
    const translations = full["translations"] as Record<"en" | "de", Record<string, unknown>>;
    const put = (en: Record<string, unknown>) =>
      client.put(`/admin/projects/${project.id}`, {
        ...full,
        gallery: [],
        translations: { en, de: translations.de },
      });

    // A save that changes nothing leaves both timestamps alone.
    await getDb()
      .update(projectTranslations)
      .set({ updatedAt: sql`now() - interval '1 hour'` })
      .where(eq(projectTranslations.projectId, project.id));
    expect((await put(translations.en)).status).toBe(200);
    expect((await items()).some((i) => i.id === project.slug && i.stale)).toBe(false);

    // Changing only the English one makes the German look behind.
    expect((await put({ ...translations.en, hook: "Sharper hook" })).status).toBe(200);
    expect(await items()).toContainEqual(
      expect.objectContaining({ kind: "project", id: project.slug, stale: true }),
    );
  });

  it("lists a post written in one language as absent in the other", async () => {
    const [post] = await getDb()
      .insert(posts)
      .values({ slug: "english-only", status: "draft" })
      .returning({ id: posts.id });
    await getDb()
      .insert(postTranslations)
      .values({ postId: post!.id, locale: "en", title: "Hello", excerpt: "", body: "" });
    expect(await items()).toContainEqual(
      expect.objectContaining({ kind: "post", id: "english-only", absent: "de" }),
    );
  });
});

describe("media usage and cleanup", () => {
  let counter = 0;
  async function asset(): Promise<{ id: string; filename: string }> {
    counter++;
    const hex = counter.toString(16).padStart(12, "0");
    const filename = `00000000-0000-4000-8000-${hex}.png`;
    const [row] = await getDb()
      .insert(mediaAssets)
      .values({
        filename,
        originalName: "shot.png",
        mime: "image/png",
        kind: "image",
        byteSize: 10,
        width: 100,
        height: 100,
        checksumSha256: Buffer.alloc(32, counter),
      })
      .returning({ id: mediaAssets.id });
    return { id: row!.id, filename };
  }

  interface Listed {
    id: string;
    usage: { draft: string[]; live: boolean; recent: boolean };
  }

  it("lists what uses each file, including a path inside a body", async () => {
    const cover = await asset();
    const inline = await asset();
    const unused = await asset();
    const project = await firstProject();
    await getDb().update(projects).set({ coverId: cover.id }).where(eq(projects.id, project.id));
    await getDb()
      .update(projectTranslations)
      .set({ body: `<p><img src="/media/${inline.filename}"></p>` })
      .where(
        and(eq(projectTranslations.projectId, project.id), eq(projectTranslations.locale, "en")),
      );

    const { media } = await json<{ media: Listed[] }>(await client.get("/admin/media"));
    const byId = new Map(media.map((m) => [m.id, m.usage]));
    expect(byId.get(cover.id)?.draft).toEqual([`project:${project.slug}`]);
    expect(byId.get(inline.id)?.draft).toEqual([`project:${project.slug}`]);
    expect(byId.get(unused.id)).toEqual({ draft: [], live: false, recent: false });
  });

  it("deletes unused files and skips the ones still in use", async () => {
    const used = await asset();
    const unused = await asset();
    const project = await firstProject();
    await getDb().update(projects).set({ coverId: used.id }).where(eq(projects.id, project.id));

    const res = await client.post("/admin/media/cleanup", { ids: [used.id, unused.id] });
    expect(res.status).toBe(200);
    const body = await json<{
      deleted: string[];
      skipped: { id: string; error: string }[];
      freedBytes: number;
    }>(res);
    expect(body.deleted).toEqual([unused.id]);
    expect(body.skipped).toEqual([{ id: used.id, error: "media_in_use" }]);
    expect(body.freedBytes).toBe(10);

    const left = await getDb().select({ id: mediaAssets.id }).from(mediaAssets);
    expect(left.map((r) => r.id)).toEqual([used.id]);
  });
});
