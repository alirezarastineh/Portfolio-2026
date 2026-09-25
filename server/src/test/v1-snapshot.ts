import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Locale } from "../content/schema.js";
import * as v1 from "../content/schema-v1.js";

interface SeedFile {
  identity: v1.AppContent["identity"];
  socials: v1.AppContent["socials"];
  skills: (Omit<v1.Skill, "title" | "caption" | "narrative"> & {
    translations: Record<Locale, { title: string; caption: string; narrative: string }>;
  })[];
  projects: {
    slug: string;
    stack: string[];
    linkLive: string;
    linkRepo: string;
    linkCaseStudy: string;
    translations: Record<Locale, Omit<v1.Project, "slug" | "stack" | "image" | "links">>;
  }[];
  documents: {
    ui: Record<Locale, v1.AppContent["ui"]>;
    seo: Record<Locale, v1.AppContent["seo"]>;
  };
}

/**
 * The seed as the site published it before content model v2: a real v1
 * payload, bundled `/projects/*.svg` placeholders included. Nothing serves
 * this shape any more, but such snapshots stay in the history, can be rolled
 * back to, and are what a site that has not published since v2 still shows.
 */
export function v1Snapshot(locale: Locale): v1.AppContent {
  const seed = JSON.parse(
    readFileSync(resolve(process.cwd(), "src/db/seed/seed.json"), "utf8"),
  ) as SeedFile;
  return v1.appContentSchema.parse({
    version: 1,
    locale,
    ui: seed.documents.ui[locale],
    identity: seed.identity,
    socials: seed.socials,
    skills: seed.skills.map(({ translations, ...skill }) => ({
      ...skill,
      ...translations[locale],
    })),
    projects: seed.projects.map((p) => ({
      slug: p.slug,
      ...p.translations[locale],
      stack: p.stack,
      image: `/projects/${p.slug}.svg`,
      links: { live: p.linkLive, repo: p.linkRepo, caseStudy: p.linkCaseStudy },
    })),
    seo: seed.documents.seo[locale],
  });
}
