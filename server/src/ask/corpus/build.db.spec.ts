import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishAll } from "../../content/publish.js";
import { getDb } from "../../db/client.js";
import {
  experiences,
  experienceTranslations,
  postTranslations,
  posts,
  projectTranslations,
  projects,
  siteProfile,
} from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { fixtureConfig } from "../../test/ask-fixtures.js";
import { resetDb } from "../../test/helpers.js";
import { getCorpus, resetCorpusMemo } from "./build.js";
import { getAskCorpus, resetAskCorpusMemo } from "./index.js";

beforeEach(async () => {
  await resetDb();
  resetCorpusMemo();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed();
});

describe("getCorpus", () => {
  it("is built from what is live, in both languages, in a fixed order", async () => {
    const corpus = await getCorpus();
    expect(corpus.key).toMatch(/^en:\d+\|de:\d+$/);

    const ids = corpus.documents.map((d) => d.id);
    expect(ids[0]).toBe("profile@en");
    expect(ids).toContain("profile@de");
    expect(ids).toContain("skills@en");
    expect(ids.indexOf("profile@en")).toBeLessThan(ids.indexOf("profile@de"));
    // Never the legal pages.
    expect(corpus.text).not.toMatch(/Impressum|Datenschutz|Privacy policy/);
    expect(corpus.text).toContain("---\nid: profile@en\nlocale: en");
  });

  it("returns the same bytes until something is published, then rebuilds", async () => {
    const first = await getCorpus();
    const again = await getCorpus();
    expect(again).toBe(first);

    const [project] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
    await getDb()
      .update(projectTranslations)
      .set({ body: "<p>The long story of the migration.</p>" })
      .where(
        sql`${projectTranslations.projectId} = ${project!.id} and ${projectTranslations.locale} = 'en'`,
      );

    // A draft edit changes nothing the assistant sees…
    expect((await getCorpus()).text).toBe(first.text);

    // …until it is published.
    await publishAll();
    const next = await getCorpus();
    expect(next.key).not.toBe(first.key);
    expect(next.text).toContain("The long story of the migration.");
    const doc = next.documents.find((d) => d.id === `project:${project!.slug}@en`)!;
    expect(doc.url).toBe(`/en/work/${project!.slug}`);
  });

  it("keeps a case study's sections and code blocks, under the ids its page gives them (visitor plan V9)", async () => {
    const [project] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
    await getDb()
      .update(projectTranslations)
      .set({
        problem: "<p>Agents searched three wikis.</p>",
        aiArchitecture: "<p>Hybrid retrieval.</p>",
        fullStackInfra: "",
        outcomes: ["Fewer escalations"],
        body:
          "<p>Intro.</p><h2>Problem</h2><p>The hard part.</p><h3>Detail</h3><p>More.</p>" +
          '<h2>The gate</h2><pre><code class="language-ts">if (a &lt; b) fail();\n  done();</code></pre>' +
          "<pre><code>plain</code></pre>",
      })
      .where(
        sql`${projectTranslations.projectId} = ${project!.id} and ${projectTranslations.locale} = 'en'`,
      );
    await publishAll();

    const doc = (await getCorpus()).documents.find((d) => d.id === `project:${project!.slug}@en`)!;
    // The fixed sections first, under the page's ids: the body's own "Problem" holds `problem`,
    // so the fixed one yields; then the body's headings, as the table of contents has them.
    expect(doc.sections?.map((s) => s.id)).toEqual([
      "problem-overview",
      "architecture",
      "outcomes",
      "problem",
      "the-gate",
    ]);
    expect(doc.sections?.[0]).toMatchObject({
      title: "Problem",
      text: "Agents searched three wikis.",
    });
    expect(doc.sections?.[2]).toMatchObject({ text: "- Fewer escalations" });
    expect(doc.sections?.[3]).toEqual({
      id: "problem",
      title: "Problem",
      text: "The hard part.\nDetail\nMore.",
    });
    // The code as it reads, its indent kept and its highlighting gone, in page order.
    expect(doc.code).toEqual(["if (a < b) fail();\n  done();", "plain"]);
  });

  it("includes experience and published posts, never drafts", async () => {
    const [exp] = await getDb()
      .insert(experiences)
      .values({ orgName: "Acme", startDate: "2020-01-01", position: 0 })
      .returning({ id: experiences.id });
    await getDb()
      .insert(experienceTranslations)
      .values(
        ["en", "de"].map((locale) => ({
          experienceId: exp!.id,
          locale: locale as "en" | "de",
          title: "Engineer",
          highlights: ["Built the thing"],
        })),
      );
    const [draft] = await getDb()
      .insert(posts)
      .values({ slug: "secret" })
      .returning({ id: posts.id });
    await getDb()
      .insert(postTranslations)
      .values({ postId: draft!.id, locale: "en", title: "Unpublished thoughts" });
    const [live] = await getDb()
      .insert(posts)
      .values({ slug: "public", status: "published", publishedAt: new Date(Date.now() - 1000) })
      .returning({ id: posts.id });
    await getDb()
      .insert(postTranslations)
      .values({ postId: live!.id, locale: "en", title: "Public note", body: "<p>Hello</p>" });
    await publishAll();

    const corpus = await getCorpus();
    expect(corpus.text).toContain("Built the thing");
    expect(corpus.text).toContain("Public note");
    expect(corpus.text).not.toContain("Unpublished thoughts");
    expect(corpus.documents.find((d) => d.id === "post:public@en")?.url).toBe("/en/writing/public");

    await getDb().update(posts).set({ status: "draft" }).where(eq(posts.id, live!.id));
    expect((await getCorpus()).text).toContain("Public note"); // still live until the next publish
  });

  it("carries the published site's origin, which the assistant's corpus passes on (plan phase 32)", async () => {
    const siteOf = async () => {
      resetAskCorpusMemo();
      const [built, assembled] = [await getCorpus(), await getAskCorpus(fixtureConfig())];
      return [built.siteUrl, assembled.siteUrl];
    };
    await getDb().update(siteProfile).set({ siteUrl: "https://example.test/en/about" });
    await publishAll();
    expect(await siteOf()).toEqual(["https://example.test", "https://example.test"]);

    // Not a URL: none, and the MCP tools' links stay relative.
    await getDb().update(siteProfile).set({ siteUrl: "not a url" });
    await publishAll();
    expect(await siteOf()).toEqual([undefined, undefined]);
  });
});
