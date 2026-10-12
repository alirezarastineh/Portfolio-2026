import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "../../content/schema.js";
import { getDb } from "../../db/client.js";
import {
  contentDocuments,
  mediaAssets,
  posts,
  postTranslations,
  projects,
  projectTranslations,
} from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { resetDb } from "../../test/helpers.js";
import { contentGlossary, GLOSSARY_MAX } from "./glossary.js";
import { contentTargets, parseKey, readTarget, SEO_LONG, targetKey } from "./targets.js";

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed(); // the editors' drafts, both languages
});

async function firstProject() {
  const [project] = await getDb().select().from(projects).orderBy(projects.position).limit(1);
  const texts = await getDb()
    .select()
    .from(projectTranslations)
    .where(eq(projectTranslations.projectId, project!.id));
  const text = (locale: Locale) => texts.find((t) => t.locale === locale)!;
  return { ...project!, en: text("en"), de: text("de") };
}

async function setProjectText(
  projectId: string,
  locale: Locale,
  change: Partial<typeof projectTranslations.$inferInsert>,
) {
  await getDb()
    .update(projectTranslations)
    .set(change)
    .where(
      and(eq(projectTranslations.projectId, projectId), eq(projectTranslations.locale, locale)),
    );
}

/** One leaf of a section's draft, by its dotted path. */
async function setLeaf(section: "ui" | "seo", locale: Locale, path: string, value: string) {
  const [row] = await getDb()
    .select()
    .from(contentDocuments)
    .where(and(eq(contentDocuments.section, section), eq(contentDocuments.locale, locale)));
  const data = structuredClone(row!.data) as Record<string, unknown>;
  const keys = path.split(".");
  let node = data;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[keys.at(-1)!] = value;
  await getDb()
    .update(contentDocuments)
    .set({ data })
    .where(and(eq(contentDocuments.section, section), eq(contentDocuments.locale, locale)));
}

async function leaf(section: "ui" | "seo", locale: Locale, path: string): Promise<string> {
  const [row] = await getDb()
    .select()
    .from(contentDocuments)
    .where(and(eq(contentDocuments.section, section), eq(contentDocuments.locale, locale)));
  return path.split(".").reduce<unknown>((node, key) => (node as never)[key], row!.data) as string;
}

async function addImage(
  name: string,
  alt: { en?: string | null; de?: string | null },
  kind: "image" | "document" = "image",
) {
  const [row] = await getDb()
    .insert(mediaAssets)
    .values({
      filename: `${randomBytes(8).toString("hex")}.${kind === "image" ? "png" : "pdf"}`,
      originalName: name,
      mime: kind === "image" ? "image/png" : "application/pdf",
      byteSize: 1000,
      checksumSha256: randomBytes(32),
      kind,
      altEn: alt.en ?? null,
      altDe: alt.de ?? null,
    })
    .returning({ id: mediaAssets.id });
  return row!.id;
}

async function addPost(
  slug: string,
  translations: Partial<Record<Locale, { title: string; excerpt?: string; body?: string }>>,
) {
  const [post] = await getDb().insert(posts).values({ slug }).returning({ id: posts.id });
  for (const [locale, text] of Object.entries(translations)) {
    await getDb()
      .insert(postTranslations)
      .values({ postId: post!.id, locale: locale as Locale, excerpt: "", body: "", ...text });
  }
  return post!.id;
}

const keys = async (...args: Parameters<typeof contentTargets>) =>
  (await contentTargets(...args)).map((t) => t.key);

describe("the content agent's plan (plan phase 29)", () => {
  it("plans a translation for each text field filled in one language and empty in the other, both ways", async () => {
    const project = await firstProject();
    await setProjectText(project.id, "de", { hook: "", outcomes: [] });
    await setProjectText(project.id, "en", { descriptor: "" });
    await setProjectText(project.id, "de", { descriptor: "Ein Deskriptor" });

    const targets = await contentTargets(["translations"], 100);
    expect(targets).toContainEqual(
      expect.objectContaining({
        key: `translations|project|${project.id}|hook|de`,
        label: `${project.en.name} · Hook (DE)`,
        current: "",
        source: project.en.hook,
        maxLength: 600,
        gap: true,
      }),
    );
    expect(targets).toContainEqual(
      expect.objectContaining({
        key: `translations|project|${project.id}|descriptor|en`,
        source: "Ein Deskriptor",
        maxLength: 200,
      }),
    );
    // A list has no field of its own to propose into.
    expect(targets.some((t) => t.field === "outcomes")).toBe(false);
  });

  it("plans the site copy's text leaves, and leaves addresses, the legal pages and the FAQ alone", async () => {
    await setLeaf("ui", "de", "profile.heroHeadline", "");
    await setLeaf("seo", "de", "canonical", "");
    // A legal page with a German gap: still not the agent's (a translation of legal text is the owner's).
    await getDb()
      .update(contentDocuments)
      .set({ data: { title: "", body: "" } })
      .where(and(eq(contentDocuments.section, "imprint"), eq(contentDocuments.locale, "de")));
    const targets = await contentTargets(["translations"], 100);
    expect(targets).toContainEqual(
      expect.objectContaining({
        key: "translations|section|ui|profile.heroHeadline|de",
        label: "Site copy · profile.heroHeadline (DE)",
        source: await leaf("ui", "en", "profile.heroHeadline"),
      }),
    );
    expect(targets.some((t) => t.field === "canonical")).toBe(false);
    expect(
      targets.some((t) => t.kind === "section" && t.entityId !== "ui" && t.entityId !== "seo"),
    ).toBe(false);
  });

  it("translates a post written in both languages, never one written in only one", async () => {
    const one = await addPost("only-english", {
      en: { title: "Only English", excerpt: "Written once." },
    });
    const both = await addPost("both", {
      en: { title: "Both", excerpt: "An excerpt." },
      de: { title: "Beide" },
    });
    const planned = await keys(["translations"], 100);
    expect(planned).toContain(`translations|post|${both}|excerpt|de`);
    expect(planned.some((key) => key.includes(one))).toBe(false);
  });

  it("plans alt text for each image and language without it, never for a document", async () => {
    const image = await addImage("diagram.png", { de: "Ein Diagramm" });
    const pdf = await addImage("cv.pdf", {}, "document");
    const targets = await contentTargets(["alt"], 100);
    expect(targets).toContainEqual(
      expect.objectContaining({
        key: `alt|media|${image}|alt|en`,
        label: "diagram.png · Alt text (EN)",
        current: "",
        source: null,
      }),
    );
    expect(targets.some((t) => t.key === `alt|media|${image}|alt|de`)).toBe(false);
    expect(targets.some((t) => t.entityId === pdf)).toBe(false);
  });

  it("plans a search description empty or over-long where the page has text, and leaves an empty one the other language has to a translation", async () => {
    const project = await firstProject();
    await setProjectText(project.id, "en", { seoDescription: "x".repeat(SEO_LONG + 1) });
    await setProjectText(project.id, "de", { seoDescription: "" });
    const seoKey = (locale: Locale) => `seo|project|${project.id}|seoDescription|${locale}`;

    const alone = await contentTargets(["seo"], 100);
    expect(alone.map((t) => t.key)).toEqual(expect.arrayContaining([seoKey("en"), seoKey("de")]));
    expect(alone.find((t) => t.key === seoKey("de"))!.source).toContain(project.de.name);

    // The English one is over-long itself: not carried into German, drafted from the page.
    const overLong = await keys(["translations", "seo"], 100);
    expect(overLong).not.toContain(`translations|project|${project.id}|seoDescription|de`);
    expect(overLong).toEqual(expect.arrayContaining([seoKey("en"), seoKey("de")]));

    // Within the limit, the German one is the translation's to fill, and kept within it.
    await setProjectText(project.id, "en", { seoDescription: "A retrieval system for support." });
    const targets = await contentTargets(["translations", "seo"], 100);
    expect(targets).toContainEqual(
      expect.objectContaining({
        key: `translations|project|${project.id}|seoDescription|de`,
        maxLength: SEO_LONG,
      }),
    );
    expect(targets.map((t) => t.key)).not.toContain(seoKey("de"));
  });

  it("orders the targets goal by goal as given, and cuts them at the run's limit", async () => {
    const project = await firstProject();
    await setProjectText(project.id, "de", { hook: "" });
    const image = await addImage("diagram.png", {});

    const planned = await keys(["alt", "translations"], 100);
    expect(planned.slice(0, 2)).toEqual([`alt|media|${image}|alt|en`, `alt|media|${image}|alt|de`]);
    expect(planned).toContain(`translations|project|${project.id}|hook|de`);
    expect(await keys(["alt", "translations"], 1)).toEqual([`alt|media|${image}|alt|en`]);
  });

  it("reads a target again: filled meanwhile, it is no longer a gap; gone, it is nothing", async () => {
    const project = await firstProject();
    await setProjectText(project.id, "de", { hook: "" });
    const key = `translations|project|${project.id}|hook|de`;
    expect(parseKey(key)).toEqual({
      goal: "translations",
      kind: "project",
      entityId: project.id,
      field: "hook",
      locale: "de",
    });
    expect(targetKey(parseKey(key)!)).toBe(key);
    expect(await readTarget(key, ["translations"])).toMatchObject({ gap: true, current: "" });

    await setProjectText(project.id, "de", { hook: "Ein Haken" });
    expect(await readTarget(key, ["translations"])).toMatchObject({
      gap: false,
      current: "Ein Haken",
    });

    await getDb().delete(projects).where(eq(projects.id, project.id));
    expect(await readTarget(key, ["translations"])).toBeNull();
    expect(await readTarget("translations|project|x|hook", ["translations"])).toBeNull();
    expect(
      await readTarget(`translations|project|${project.id}|outcomes|de`, ["translations"]),
    ).toBeNull();
  });

  it("keeps the portfolio's names and terms for a translation, each once", async () => {
    const project = await firstProject();
    const glossary = await contentGlossary();
    expect(glossary).toContain(project.en.name);
    for (const item of project.stack as string[]) expect(glossary).toContain(item);
    expect(new Set(glossary.map((t) => t.toLowerCase())).size).toBe(glossary.length);
    expect(glossary.length).toBeLessThanOrEqual(GLOSSARY_MAX);
  });
});
