import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishAll } from "../../content/publish.js";
import { getDb } from "../../db/client.js";
import { posts, postTranslations, projects, projectTranslations } from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { resetDb } from "../../test/helpers.js";
import { getCorpus, getDraftCorpus, resetCorpusMemo } from "./build.js";

/**
 * Plan phase 19: the `updated:` date each document carries, so an answer can
 * say "as of". A project or post has its own (its card or its body, the
 * later); the profile, the experience and the skills have the publish that
 * holds them; a draft has no publish, so they have none.
 */

beforeEach(async () => {
  await resetDb();
  resetCorpusMemo();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed();
});

const at = (day: string) => new Date(`${day}T12:00:00Z`);

describe("document dates (plan phase 19)", () => {
  it("date a project and a post by their own last change, the rest by the publish", async () => {
    const db = getDb();
    const [first] = await db.select().from(projects).orderBy(projects.position).limit(1);
    await db
      .update(projects)
      .set({ updatedAt: at("2026-03-01") })
      .where(eq(projects.id, first!.id));
    // The English body changed later than the card; the German one earlier.
    await db
      .update(projectTranslations)
      .set({ updatedAt: at("2026-04-01") })
      .where(
        sql`${projectTranslations.projectId} = ${first!.id} and ${projectTranslations.locale} = 'en'`,
      );
    await db
      .update(projectTranslations)
      .set({ updatedAt: at("2026-02-01") })
      .where(
        sql`${projectTranslations.projectId} = ${first!.id} and ${projectTranslations.locale} = 'de'`,
      );
    const [post] = await db
      .insert(posts)
      .values({
        slug: "dated",
        status: "published",
        publishedAt: at("2026-01-10"),
        updatedAt: at("2026-05-01"),
      })
      .returning({ id: posts.id });
    await db.insert(postTranslations).values({
      postId: post!.id,
      locale: "en",
      title: "Dated",
      excerpt: "A post with a date.",
      body: "<p>Body.</p>",
      updatedAt: at("2026-05-02"),
    });

    await publishAll();
    // The publish itself, on a known day.
    await db.execute(sql`update content_versions set created_at = ${at("2026-06-07")}`);
    resetCorpusMemo();
    const corpus = await getCorpus();
    const updated = (id: string) => corpus.documents.find((d) => d.id === id)?.updated;

    expect(updated(`project:${first!.slug}@en`)).toBe("2026-04-01");
    expect(updated(`project:${first!.slug}@de`)).toBe("2026-03-01");
    expect(updated("post:dated@en")).toBe("2026-05-02");
    expect(updated("profile@en")).toBe("2026-06-07");
    expect(updated("skills@de")).toBe("2026-06-07");

    // The drafts: projects keep their own dates; what only a publish dates has none.
    const draft = await getDraftCorpus();
    const drafted = (id: string) => draft.documents.find((d) => d.id === id);
    expect(drafted(`project:${first!.slug}@en`)?.updated).toBe("2026-04-01");
    expect(drafted("profile@en")).toBeDefined();
    expect(drafted("profile@en")?.updated).toBeUndefined();
  });
});
