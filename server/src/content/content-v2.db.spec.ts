import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import {
  contentPointers,
  contentPublications,
  contentVersionDocs,
  contentVersions,
  experiences,
  mediaAssets,
  mediaVariants,
  posts,
  projectTranslations,
  projects,
  versionMediaRefs,
} from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import { buildLocale } from "./build.js";
import { publishAll, rollbackToPublication } from "./publish.js";
import { restoreDraftFromPublication } from "./restore.js";
import type { AppContent, Doc } from "./schema.js";
import * as v1 from "./schema-v1.js";

const app = createApp();
let client: TestClient;

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed();
  await createAdmin();
  client = new TestClient(app);
  await client.login();
});

let n = 0;
async function image(): Promise<{ id: string; filename: string }> {
  n++;
  const hex = n.toString(16).padStart(12, "0");
  const filename = `00000000-0000-4000-9000-${hex}.png`;
  const [row] = await getDb()
    .insert(mediaAssets)
    .values({
      filename,
      originalName: "shot.png",
      mime: "image/png",
      byteSize: 10,
      width: 2000,
      height: 1000,
      altEn: "Alt text",
      checksumSha256: Buffer.alloc(32, 100 + n),
    })
    .returning({ id: mediaAssets.id });
  await getDb()
    .insert(mediaVariants)
    .values(
      (["webp", "avif"] as const).map((format) => ({
        assetId: row!.id,
        format,
        width: 480,
        height: 240,
        filename: `00000000-0000-4000-9000-${hex}-480w.${format}`,
        byteSize: 5,
      })),
    );
  return { id: row!.id, filename };
}

async function live(locale: "en" | "de" = "en"): Promise<AppContent> {
  return (await (await app.request(`/v2/content/${locale}`)).json()) as AppContent;
}

async function doc(path: string): Promise<Response> {
  return app.request(`/v2/content/${path}`);
}

async function firstProjectId(): Promise<string> {
  const [first] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
  return first!.id;
}

async function setBody(body: string, locale: "en" | "de" = "en"): Promise<string> {
  const id = await firstProjectId();
  await getDb()
    .update(projectTranslations)
    .set({ body })
    .where(
      sql`${projectTranslations.projectId} = ${id} and ${projectTranslations.locale} = ${locale}`,
    );
  return id;
}

describe("publishing v2", () => {
  it("keeps long-form bodies out of the core and serves them as docs", async () => {
    await setBody(
      '<h2>The problem</h2><p>Why it mattered.</p><pre><code class="language-ts">const a = 1;</code></pre>',
    );
    const outcome = await publishAll();
    expect(outcome.unchanged).toBe(false);

    const core = await live();
    const slug = core.projects[0]!.slug;
    expect(core.projects[0]!.hasCaseStudy).toBe(true);
    expect(JSON.stringify(core)).not.toContain("Why it mattered");

    const res = await doc(`en/projects/${slug}`);
    expect(res.status).toBe(200);
    const study = (await res.json()) as Extract<Doc, { kind: "project" }>;
    expect(study.toc).toEqual([{ id: "the-problem", text: "The problem", level: 2 }]);
    expect(study.body).toContain('<h2 id="the-problem">');
    expect(study.body).toContain('<pre class="code-block code-lang-ts"><code><span class="line">');
    expect(study.body).toMatch(/class="shd-[0-9a-f]+ shl-[0-9a-f]+"/);
    // Only English has a body, so only English has a page.
    expect(study.alternates).toEqual({ en: `/en/work/${slug}`, de: null });
    expect((await doc(`de/projects/${slug}`)).status).toBe(404);

    const rows = await getDb()
      .select({ key: contentVersionDocs.key })
      .from(contentVersionDocs)
      .where(
        eq(contentVersionDocs.versionId, outcome.results.find((r) => r.locale === "en")!.versionId),
      );
    expect(rows.map((r) => r.key).sort()).toEqual([
      "legal:imprint",
      "legal:privacy",
      `project:${slug}`,
    ]);
  });

  it("counts an edit to a body alone as a change", async () => {
    await setBody("<p>v1</p>");
    await publishAll();
    await setBody("<p>v2</p>");
    expect((await publishAll()).unchanged).toBe(false);
    expect((await publishAll()).unchanged).toBe(true);
  });

  it("publishes covers, gallery and inline images as responsive images, and records them all", async () => {
    const cover = await image();
    const shot = await image();
    const inline = await image();
    const id = await firstProjectId();
    await getDb().update(projects).set({ coverId: cover.id }).where(eq(projects.id, id));
    await client.put(`/admin/projects/${id}`, {
      ...(await (async () => {
        const { project } = (await (await client.get(`/admin/projects/${id}`)).json()) as {
          project: Record<string, unknown>;
        };
        return project;
      })()),
      coverId: cover.id,
      gallery: [{ mediaId: shot.id, caption: { en: "Screen", de: "Bildschirm" } }],
    });
    await setBody(`<p>See:</p><img src="/media/${inline.filename}" alt="diagram" />`);
    const outcome = await publishAll();

    const project = (await live()).projects[0]!;
    expect(project.cover).toMatchObject({
      src: `/media/${cover.filename}`,
      width: 2000,
      height: 1000,
      alt: "Alt text",
      sources: [
        { type: "image/avif", srcset: expect.stringContaining("480w") },
        { type: "image/webp", srcset: expect.stringContaining("480w") },
      ],
    });

    const study = (await (await doc(`en/projects/${project.slug}`)).json()) as Extract<
      Doc,
      { kind: "project" }
    >;
    expect(study.gallery[0]).toMatchObject({ src: `/media/${shot.filename}`, caption: "Screen" });
    expect(study.body).toContain('<picture><source type="image/avif"');
    expect(study.body).toContain(
      `<img src="/media/${inline.filename}" alt="diagram" width="2000" height="1000"`,
    );

    const refs = await getDb()
      .select({ assetId: versionMediaRefs.assetId })
      .from(versionMediaRefs)
      .where(
        eq(versionMediaRefs.versionId, outcome.results.find((r) => r.locale === "en")!.versionId),
      );
    expect(new Set(refs.map((r) => r.assetId))).toEqual(new Set([cover.id, shot.id, inline.id]));

    // And the media library refuses to delete what the draft uses.
    const del = await client.delete(`/admin/media/${shot.id}`);
    expect(del.status).toBe(409);
    expect(await del.json()).toMatchObject({
      error: "media_in_use",
      usedBy: [`project:${project.slug} (gallery)`],
    });
  });

  it("lists a scheduled post only once it is due, and only in its languages", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const res = await client.post("/admin/posts", {
      slug: "hello",
      status: "published",
      publishedAt: future,
      tags: ["ai"],
      translations: {
        en: { title: "Hello", excerpt: "Hi", body: "<p>word </p>".repeat(300) },
        de: null,
      },
    });
    const id = ((await res.json()) as { id: string }).id;
    await publishAll();
    expect((await live()).posts).toEqual([]);

    await getDb()
      .update(posts)
      .set({ publishedAt: new Date(Date.now() - 1000) })
      .where(eq(posts.id, id));
    await publishAll();
    const [post] = (await live()).posts;
    expect(post).toMatchObject({
      slug: "hello",
      readingMinutes: 2,
      alternates: { en: "/en/writing/hello", de: null },
    });
    expect((await live("de")).posts).toEqual([]);
    expect((await doc("en/posts/hello")).status).toBe(200);
    expect((await doc("de/posts/hello")).status).toBe(404);
  });
});

describe("the admin flow end to end", () => {
  it("creates an experience and a post, publishes, and sees both in /v2", async () => {
    const exp = await client.post("/admin/experiences", {
      kind: "work",
      orgName: "Acme",
      startDate: "2022-01-01",
      endDate: null,
      employmentType: "full-time",
      skills: ["Angular"],
      translations: {
        en: {
          title: "Lead engineer",
          summary: "Led the platform team.",
          highlights: ["Cut costs 30%"],
        },
        de: {
          title: "Leitender Ingenieur",
          summary: "Plattformteam geleitet.",
          highlights: ["Kosten −30 %"],
        },
      },
    });
    expect(exp.status).toBe(201);
    const post = await client.post("/admin/posts", {
      slug: "shipping-rag",
      status: "published",
      publishedAt: new Date(Date.now() - 60_000).toISOString(),
      translations: {
        en: { title: "Shipping RAG", excerpt: "Notes", body: "<h2>Retrieval</h2><p>Text</p>" },
        de: { title: "RAG ausliefern", excerpt: "Notizen", body: "<p>Text</p>" },
      },
    });
    expect(post.status).toBe(201);

    const publish = await client.post("/admin/publish", { label: "experience + post" });
    expect(await publish.json()).toMatchObject({ ok: true, unchanged: false });

    const en = await live();
    expect(en.experiences[0]).toMatchObject({
      org: { name: "Acme", url: "", logo: null },
      title: "Lead engineer",
      period: { start: "2022-01-01", end: null, precision: "month" },
      employmentType: "full-time",
    });
    expect((await live("de")).experiences[0]!.title).toBe("Leitender Ingenieur");
    expect(en.posts[0]).toMatchObject({
      slug: "shipping-rag",
      alternates: { en: "/en/writing/shipping-rag", de: "/de/writing/shipping-rag" },
    });

    const postDoc = (await (await doc("en/posts/shipping-rag")).json()) as Extract<
      Doc,
      { kind: "post" }
    >;
    expect(postDoc.toc).toEqual([{ id: "retrieval", text: "Retrieval", level: 2 }]);
  });
});

describe("rollback and restore across versions", () => {
  it("rolls back to a publication made before v2, writing it as v2", async () => {
    const pre = (await (await app.request("/v1/content/en")).json()) as v1.AppContent;
    const preDe = (await (await app.request("/v1/content/de")).json()) as v1.AppContent;
    const [old] = await getDb()
      .insert(contentPublications)
      .values({ kind: "publish", schemaVersion: 1 })
      .returning({ id: contentPublications.id });
    await getDb()
      .insert(contentVersions)
      .values([
        {
          locale: "en",
          payload: { ...pre, projects: pre.projects.map((p) => ({ ...p, name: "Old name" })) },
          checksum: "a",
          publicationId: old!.id,
        },
        { locale: "de", payload: preDe, checksum: "b", publicationId: old!.id },
      ]);

    const outcome = await rollbackToPublication(old!.id);
    const [written] = await getDb()
      .select()
      .from(contentPublications)
      .where(eq(contentPublications.id, outcome.publicationId));
    expect(written).toMatchObject({ kind: "rollback", schemaVersion: 2 });

    const core = await live();
    expect(core.version).toBe(2);
    expect(core.projects[0]!.name).toBe("Old name");
    // v1 carried no legal pages; the rollback still has them.
    expect((await doc("en/legal/privacy")).status).toBe(200);
  });

  it("restores a v2 publication into the draft, bodies, gallery and all", async () => {
    const shot = await image();
    const id = await setBody(
      '<h2>Story</h2><pre><code class="language-ts">let x = 1;</code></pre>',
    );
    const { project } = (await (await client.get(`/admin/projects/${id}`)).json()) as {
      project: Record<string, unknown>;
    };
    await client.put(`/admin/projects/${id}`, {
      ...project,
      featured: true,
      tags: ["ai"],
      gallery: [{ mediaId: shot.id, caption: { en: "One", de: "Eins" } }],
    });
    await client.post("/admin/experiences", {
      kind: "education",
      orgName: "TU",
      startDate: "2015-10-01",
      endDate: "2019-09-30",
      translations: { en: { title: "BSc" }, de: { title: "BSc" } },
    });
    const original = await publishAll();
    const publishedEn = await buildLocale(getDb(), "en");

    // Wreck the draft.
    await setBody("<p>gone</p>");
    await getDb().update(projects).set({ featured: false, tags: [] });
    await getDb().update(experiences).set({ isVisible: false });

    await restoreDraftFromPublication(original.publicationId!);
    const restored = await buildLocale(getDb(), "en");

    const withoutTimes = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, v: unknown) => (key === "updatedAt" ? undefined : v)),
      ) as unknown;
    expect(withoutTimes(restored.core)).toEqual(withoutTimes(publishedEn.core));
    expect(withoutTimes([...restored.docs])).toEqual(withoutTimes([...publishedEn.docs]));
    // The live site did not move.
    expect(await getDb().select().from(contentPointers)).toHaveLength(2);
  });
});
