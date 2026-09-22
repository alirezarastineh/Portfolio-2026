import { and, asc, eq } from "drizzle-orm";

import { appContentSchema, type AppContent, type Locale } from "./schema.js";
import type { Database } from "../db/client.js";
import {
  contentDocuments,
  projectTranslations,
  projects,
  siteProfile,
  skillTranslations,
  skills,
  socials,
} from "../db/schema.js";

/** A `db` or an open transaction — both expose the query builder. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Uploaded media is stored as `/media/<file>`; publishing rewrites it to an
 * absolute URL so the client renders one origin regardless of where it runs.
 * Legacy `/projects/*.svg` paths are served by the client and pass through.
 */
function resolveImage(imagePath: string | null): string {
  if (!imagePath) return "";
  if (!imagePath.startsWith("/media/")) return imagePath;
  let base = process.env.MEDIA_PUBLIC_BASE_URL ?? "";
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return `${base}${imagePath}`;
}

/**
 * Assembles one locale's full content payload from the working tables — i.e.
 * from the current draft. Publishing and preview both go through here, so they
 * can never disagree.
 */
export async function buildContent(db: DbExecutor, locale: Locale): Promise<AppContent> {
  const [profileRow] = await db.select().from(siteProfile).limit(1);
  if (!profileRow) {
    throw new Error("site_profile is empty — run the seed first");
  }

  const documentRows = await db
    .select({ section: contentDocuments.section, data: contentDocuments.data })
    .from(contentDocuments)
    .where(eq(contentDocuments.locale, locale));

  const ui = documentRows.find((d) => d.section === "ui")?.data;
  const seo = documentRows.find((d) => d.section === "seo")?.data;
  if (!ui || !seo) {
    throw new Error(`content_documents is missing ui/seo for locale "${locale}"`);
  }

  const socialRows = await db
    .select({ label: socials.label, href: socials.href, icon: socials.icon })
    .from(socials)
    .where(eq(socials.isVisible, true))
    .orderBy(asc(socials.position), asc(socials.id));

  const skillRows = await db
    .select({
      id: skills.id,
      icon: skills.icon,
      span: skills.span,
      items: skills.items,
      title: skillTranslations.title,
      caption: skillTranslations.caption,
      narrative: skillTranslations.narrative,
    })
    .from(skills)
    .innerJoin(
      skillTranslations,
      and(eq(skillTranslations.skillId, skills.id), eq(skillTranslations.locale, locale)),
    )
    .where(eq(skills.isVisible, true))
    .orderBy(asc(skills.position), asc(skills.id));

  const projectRows = await db
    .select({
      slug: projects.slug,
      imagePath: projects.imagePath,
      stack: projects.stack,
      linkLive: projects.linkLive,
      linkRepo: projects.linkRepo,
      linkCaseStudy: projects.linkCaseStudy,
      name: projectTranslations.name,
      descriptor: projectTranslations.descriptor,
      hook: projectTranslations.hook,
      problem: projectTranslations.problem,
      aiArchitecture: projectTranslations.aiArchitecture,
      fullStackInfra: projectTranslations.fullStackInfra,
      outcomes: projectTranslations.outcomes,
    })
    .from(projects)
    .innerJoin(
      projectTranslations,
      and(
        eq(projectTranslations.projectId, projects.id),
        eq(projectTranslations.locale, locale),
      ),
    )
    .where(eq(projects.isVisible, true))
    .orderBy(asc(projects.position), asc(projects.id));

  // parse() is the gate: an invalid payload throws here, inside the publish
  // transaction, so the live pointer never moves to broken content.
  return appContentSchema.parse({
    version: 1,
    locale,
    ui,
    identity: {
      name: profileRow.name,
      handle: profileRow.handle,
      contactEmail: profileRow.contactEmail,
      primaryCtaHref: profileRow.primaryCtaHref,
      secondaryCtaHref: profileRow.secondaryCtaHref,
    },
    socials: socialRows,
    skills: skillRows,
    projects: projectRows.map((p) => ({
      slug: p.slug,
      name: p.name,
      descriptor: p.descriptor,
      hook: p.hook,
      problem: p.problem,
      aiArchitecture: p.aiArchitecture,
      fullStackInfra: p.fullStackInfra,
      outcomes: p.outcomes,
      stack: p.stack,
      image: resolveImage(p.imagePath),
      links: {
        live: p.linkLive ?? "",
        repo: p.linkRepo ?? "",
        caseStudy: p.linkCaseStudy ?? "",
      },
    })),
    seo,
  });
}
