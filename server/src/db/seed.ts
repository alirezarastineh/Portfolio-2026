import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";

import { publishAll } from "../content/publish.js";
import { LOCALES, type Locale } from "../content/schema.js";
import { getDb } from "./client.js";
import {
  contentDocuments,
  projectTranslations,
  projects,
  siteProfile,
  skillTranslations,
  skills,
  socials,
} from "./schema.js";

interface SeedFile {
  identity: {
    name: string;
    handle: string;
    contactEmail: string;
    primaryCtaHref: string;
    secondaryCtaHref: string;
  };
  socials: { label: string; href: string; icon: string; position: number }[];
  skills: {
    id: string;
    icon: string;
    span: string;
    items: string[];
    position: number;
    translations: Record<Locale, { title: string; caption: string; narrative: string }>;
  }[];
  projects: {
    slug: string;
    imagePath: string;
    stack: string[];
    linkLive: string;
    linkRepo: string;
    linkCaseStudy: string;
    position: number;
    translations: Record<
      Locale,
      {
        name: string;
        descriptor: string;
        hook: string;
        problem: string;
        aiArchitecture: string;
        fullStackInfra: string;
        outcomes: string[];
      }
    >;
  }[];
  documents: {
    ui: Record<Locale, unknown>;
    seo: Record<Locale, unknown>;
  };
}

function loadSeedFile(): SeedFile {
  // Read rather than import: tsc does not emit .json into dist, and seeding is
  // a one-time bootstrap run from source (locally, through the dev tunnel).
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "seed/seed.json");
  return JSON.parse(readFileSync(path, "utf8")) as SeedFile;
}

/**
 * Idempotent: every insert either conflicts away or is guarded by a count, so
 * re-running never duplicates rows or overwrites edits made in the admin.
 */
export async function seed(): Promise<void> {
  const db = getDb();
  const data = loadSeedFile();

  await db
    .insert(siteProfile)
    .values({ id: true, ...data.identity })
    .onConflictDoNothing();

  // Socials have generated ids and so no natural key to conflict on; skipping
  // when rows already exist is what keeps this safe to re-run.
  const [{ count: socialCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(socials);
  if (socialCount === 0) {
    await db.insert(socials).values(data.socials);
  }

  for (const skill of data.skills) {
    await db
      .insert(skills)
      .values({
        id: skill.id,
        icon: skill.icon,
        span: skill.span,
        items: skill.items,
        position: skill.position,
      })
      .onConflictDoNothing();

    for (const locale of LOCALES) {
      await db
        .insert(skillTranslations)
        .values({ skillId: skill.id, locale, ...skill.translations[locale] })
        .onConflictDoNothing();
    }
  }

  for (const project of data.projects) {
    const [inserted] = await db
      .insert(projects)
      .values({
        slug: project.slug,
        imagePath: project.imagePath,
        stack: project.stack,
        linkLive: project.linkLive,
        linkRepo: project.linkRepo,
        linkCaseStudy: project.linkCaseStudy,
        position: project.position,
      })
      .onConflictDoNothing()
      .returning({ id: projects.id });

    // onConflictDoNothing returns nothing when the slug already exists.
    const projectId =
      inserted?.id ??
      (
        await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.slug, project.slug))
          .limit(1)
      )[0]?.id;

    if (!projectId) {
      throw new Error(`could not resolve project id for slug "${project.slug}"`);
    }

    for (const locale of LOCALES) {
      await db
        .insert(projectTranslations)
        .values({ projectId, locale, ...project.translations[locale] })
        .onConflictDoNothing();
    }
  }

  for (const section of ["ui", "seo"] as const) {
    for (const locale of LOCALES) {
      await db
        .insert(contentDocuments)
        .values({ section, locale, data: data.documents[section][locale] })
        .onConflictDoNothing();
    }
  }

  const published = await publishAll({ label: "seed" });
  for (const result of published) {
    console.log(
      `[seed] published ${result.locale} → version ${result.versionId} (${result.checksum.slice(0, 12)}…)`,
    );
  }
}
