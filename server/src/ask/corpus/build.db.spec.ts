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
} from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { resetDb } from "../../test/helpers.js";
import { getCorpus, resetCorpusMemo } from "./build.js";

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
});
