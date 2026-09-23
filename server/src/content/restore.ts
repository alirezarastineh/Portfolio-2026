import { and, eq, inArray, notInArray } from "drizzle-orm";

import { getDb } from "../db/client.js";
import {
  contentDocuments,
  experiences,
  experienceTranslations,
  mediaAssets,
  postTranslations,
  posts,
  profileResumes,
  projectGallery,
  projectTranslations,
  projects,
  siteProfile,
  skillTranslations,
  skills,
  socials,
} from "../db/schema.js";
import type { DbExecutor } from "./build.js";
import { loadPublication, PublicationError, type LoadedVersion } from "./publish.js";
import { sanitizeRichText } from "./sanitize.js";
import {
  docKey,
  LOCALES,
  type AppContent,
  type Doc,
  type Locale,
  type PostDoc,
  type ProjectDoc,
} from "./schema.js";

/**
 * Turns a published body back into what the editor stores: the ids, the
 * highlighted code and the `<picture>` wrappers the build added are undone,
 * then the result is sanitized like any save.
 */
export function unrenderBody(html: string): string {
  if (!html) return "";
  const plain = html
    .replace(/<h([23]) id="[^"]*">/g, "<h$1>")
    .replace(
      /<pre class="code-block(?: code-lang-([a-z0-9+#-]+))?"><code>([\s\S]*?)<\/code><\/pre>/g,
      (_whole, lang: string | undefined, code: string) => {
        const text = code.replaceAll('<span class="line">', "").replace(/<\/?span[^<>]*>/g, "");
        const langAttr = lang ? ` class="language-${lang}"` : "";
        return `<pre><code${langAttr}>${text}</code></pre>`;
      },
    )
    .replace(/<picture>[\s\S]*?(<img [^>]*>)[\s\S]*?<\/picture>/g, (_whole, img: string) => {
      const src = /\ssrc="([^"]*)"/.exec(img)?.[1] ?? "";
      const alt = /\salt="([^"]*)"/.exec(img)?.[1] ?? "";
      const title = /\stitle="([^"]*)"/.exec(img)?.[1];
      const titleAttr = title ? ` title="${title}"` : "";
      return `<img src="${src}" alt="${alt}"${titleAttr} />`;
    });
  return sanitizeRichText(plain);
}

/** `/media/<file>` → the asset id, for columns that point at media. */
async function assetIdsByPath(
  tx: DbExecutor,
  paths: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const filenames = [
    ...new Set(
      paths
        .map((p) => /^\/media\/([^/?#]+)$/.exec(p ?? "")?.[1])
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  if (filenames.length === 0) return new Map();
  const rows = await tx
    .select({ id: mediaAssets.id, filename: mediaAssets.filename })
    .from(mediaAssets)
    .where(inArray(mediaAssets.filename, filenames));
  return new Map(rows.map((r) => [`/media/${r.filename}`, r.id]));
}

interface Sources {
  base: AppContent;
  byLocale: Map<Locale, AppContent>;
  docs: Map<Locale, Map<string, Doc>>;
}

function toSources(loaded: LoadedVersion[]): Sources {
  const byLocale = new Map<Locale, AppContent>();
  const docs = new Map<Locale, Map<string, Doc>>();
  for (const version of loaded) {
    byLocale.set(version.locale, version.built.core);
    docs.set(version.locale, version.built.docs);
  }
  // Translations exist per locale; restoring from a publication that holds
  // only one (the old single-locale rollbacks) would have to invent the other.
  if (LOCALES.some((locale) => !byLocale.has(locale))) {
    throw new PublicationError(422, "incomplete_publication");
  }
  return { base: byLocale.get(LOCALES[0])!, byLocale, docs };
}

async function restoreIdentityAndDocs(
  tx: DbExecutor,
  { base, byLocale, docs }: Sources,
  now: Date,
  updatedBy: string | null,
): Promise<void> {
  const media = await assetIdsByPath(tx, [
    base.identity.avatar?.src,
    ...[...byLocale.values()].map((c) => c.identity.resume?.href),
  ]);

  const identity = base.identity;
  await tx
    .update(siteProfile)
    .set({
      name: identity.name,
      handle: identity.handle,
      contactEmail: identity.contactEmail,
      primaryCtaHref: identity.primaryCtaHref,
      secondaryCtaHref: identity.secondaryCtaHref,
      siteUrl: identity.siteUrl || null,
      availability: identity.availability,
      locationCity: identity.location.city,
      locationCountry: identity.location.country,
      timezone: identity.timezone,
      avatarId: identity.avatar ? (media.get(identity.avatar.src) ?? null) : null,
      updatedAt: now,
      updatedBy,
    })
    .where(eq(siteProfile.id, true));

  for (const [locale, content] of byLocale) {
    const sections: { section: string; data: unknown }[] = [
      { section: "ui", data: content.ui },
      { section: "seo", data: content.seo },
    ];
    for (const legal of ["imprint", "privacy"] as const) {
      const doc = docs.get(locale)?.get(docKey("legal", legal));
      if (doc?.kind === "legal") {
        sections.push({ section: legal, data: { title: doc.title, body: unrenderBody(doc.body) } });
      }
    }
    for (const { section, data } of sections) {
      await tx
        .insert(contentDocuments)
        .values({ section, locale, data, updatedAt: now, updatedBy })
        .onConflictDoUpdate({
          target: [contentDocuments.section, contentDocuments.locale],
          set: { data, updatedAt: now, updatedBy },
        });
    }

    const resumeId = content.identity.resume ? media.get(content.identity.resume.href) : undefined;
    if (resumeId) {
      await tx
        .insert(profileResumes)
        .values({ locale, mediaId: resumeId, updatedAt: now })
        .onConflictDoUpdate({
          target: profileResumes.locale,
          set: { mediaId: resumeId, updatedAt: now },
        });
    } else {
      await tx.delete(profileResumes).where(eq(profileResumes.locale, locale));
    }
  }
}

async function restoreSocials(
  tx: DbExecutor,
  baseSocials: AppContent["socials"],
  now: Date,
): Promise<void> {
  const existingSocials = await tx
    .select({ id: socials.id, label: socials.label, href: socials.href })
    .from(socials);
  const keptSocials = new Set<string>();
  for (const [position, social] of baseSocials.entries()) {
    const match = existingSocials.find(
      (row) => row.label === social.label && row.href === social.href && !keptSocials.has(row.id),
    );
    if (match) {
      await tx
        .update(socials)
        .set({ icon: social.icon, position, isVisible: true, updatedAt: now })
        .where(eq(socials.id, match.id));
      keptSocials.add(match.id);
    } else {
      const [inserted] = await tx
        .insert(socials)
        .values({ ...social, position, isVisible: true })
        .returning({ id: socials.id });
      if (inserted) keptSocials.add(inserted.id);
    }
  }
  const hiddenSocials = existingSocials.filter((row) => !keptSocials.has(row.id));
  for (const [offset, row] of hiddenSocials.entries()) {
    await tx
      .update(socials)
      .set({ isVisible: false, position: baseSocials.length + offset, updatedAt: now })
      .where(eq(socials.id, row.id));
  }
}

async function restoreSkills(
  tx: DbExecutor,
  { base, byLocale }: Sources,
  now: Date,
): Promise<void> {
  const existingSkills = await tx.select({ id: skills.id }).from(skills);
  for (const [position, skill] of base.skills.entries()) {
    const shared = {
      icon: skill.icon,
      span: skill.span,
      items: skill.items,
      position,
      isVisible: true,
    };
    await tx
      .insert(skills)
      .values({ id: skill.id, ...shared })
      .onConflictDoUpdate({ target: skills.id, set: { ...shared, updatedAt: now } });

    for (const [locale, content] of byLocale) {
      const translated = content.skills.find((s) => s.id === skill.id);
      if (!translated) continue;
      const text = {
        title: translated.title,
        caption: translated.caption,
        narrative: translated.narrative,
      };
      await tx
        .insert(skillTranslations)
        .values({ skillId: skill.id, locale, ...text })
        .onConflictDoUpdate({
          target: [skillTranslations.skillId, skillTranslations.locale],
          set: text,
        });
    }
  }
  const restoredSkillIds = new Set(base.skills.map((s) => s.id));
  const hiddenSkills = existingSkills.filter((row) => !restoredSkillIds.has(row.id));
  for (const [offset, row] of hiddenSkills.entries()) {
    await tx
      .update(skills)
      .set({ isVisible: false, position: base.skills.length + offset, updatedAt: now })
      .where(eq(skills.id, row.id));
  }
}

async function restoreProjectTranslations(
  tx: DbExecutor,
  projectId: string,
  slug: string,
  byLocale: Map<Locale, AppContent>,
  projectDoc: (locale: Locale, slug: string) => ProjectDoc | undefined,
  now: Date,
): Promise<void> {
  for (const [locale, content] of byLocale) {
    const translated = content.projects.find((p) => p.slug === slug);
    if (!translated) continue;
    const doc = projectDoc(locale, slug);
    const text = {
      name: translated.name,
      descriptor: translated.descriptor,
      hook: translated.hook,
      problem: translated.problem,
      aiArchitecture: translated.aiArchitecture,
      fullStackInfra: translated.fullStackInfra,
      outcomes: translated.outcomes,
      role: translated.role,
      categoryLabel: translated.category?.label ?? "",
      metrics: translated.metrics,
      body: doc ? unrenderBody(doc.body) : "",
      seoDescription: doc?.seo.description ?? "",
      updatedAt: now,
    };
    await tx
      .insert(projectTranslations)
      .values({ projectId, locale, ...text })
      .onConflictDoUpdate({
        target: [projectTranslations.projectId, projectTranslations.locale],
        set: text,
      });
  }
}

async function restoreProjectGallery(
  tx: DbExecutor,
  projectId: string,
  slug: string,
  media: Map<string, string>,
  projectDoc: (locale: Locale, slug: string) => ProjectDoc | undefined,
): Promise<void> {
  // The gallery as the publication showed it, captions from each language.
  await tx.delete(projectGallery).where(eq(projectGallery.projectId, projectId));
  const gallery = projectDoc(LOCALES[0], slug)?.gallery ?? [];
  const items = gallery.flatMap((image, index) => {
    const mediaId = media.get(image.src);
    if (!mediaId) return [];
    const caption = Object.fromEntries(
      LOCALES.map((l) => [l, projectDoc(l, slug)?.gallery[index]?.caption ?? ""]),
    );
    return [{ projectId, mediaId, position: index, caption }];
  });
  if (items.length > 0) await tx.insert(projectGallery).values(items).onConflictDoNothing();
}

async function restoreProjects(
  tx: DbExecutor,
  { base, byLocale, docs }: Sources,
  now: Date,
): Promise<void> {
  const projectDoc = (locale: Locale, slug: string) => {
    const doc = docs.get(locale)?.get(docKey("projects", slug));
    return doc?.kind === "project" ? (doc as ProjectDoc) : undefined;
  };
  const media = await assetIdsByPath(tx, [
    ...base.projects.map((p) => p.cover?.src),
    ...base.projects.flatMap(
      (p) => projectDoc(LOCALES[0], p.slug)?.gallery.map((g) => g.src) ?? [],
    ),
  ]);

  const existingProjects = await tx.select({ id: projects.id, slug: projects.slug }).from(projects);
  for (const [position, project] of base.projects.entries()) {
    const coverId = project.cover ? (media.get(project.cover.src) ?? null) : null;
    const shared = {
      coverId,
      imageId: coverId,
      // A cover without an asset is a legacy bundled path; keep it publishable.
      imagePath: project.cover?.src ?? null,
      stack: project.stack,
      linkLive: project.links.live,
      linkRepo: project.links.repo,
      linkCaseStudy: project.links.caseStudy,
      featured: project.featured,
      periodStart: project.period?.start ?? null,
      periodEnd: project.period?.end ?? null,
      category: project.category?.key ?? null,
      tags: project.tags,
      position,
      isVisible: true,
    };
    const [row] = await tx
      .insert(projects)
      .values({ slug: project.slug, ...shared })
      .onConflictDoUpdate({ target: projects.slug, set: { ...shared, updatedAt: now } })
      .returning({ id: projects.id });
    if (!row) throw new Error(`failed to restore project "${project.slug}"`);

    await restoreProjectTranslations(tx, row.id, project.slug, byLocale, projectDoc, now);
    await restoreProjectGallery(tx, row.id, project.slug, media, projectDoc);
  }
  const restoredSlugs = new Set(base.projects.map((p) => p.slug));
  const hiddenProjects = existingProjects.filter((row) => !restoredSlugs.has(row.slug));
  for (const [offset, row] of hiddenProjects.entries()) {
    await tx
      .update(projects)
      .set({ isVisible: false, position: base.projects.length + offset, updatedAt: now })
      .where(eq(projects.id, row.id));
  }
}

async function restoreExperiences(
  tx: DbExecutor,
  { base, byLocale }: Sources,
  now: Date,
): Promise<void> {
  const media = await assetIdsByPath(
    tx,
    base.experiences.map((e) => e.org.logo?.src),
  );
  for (const [position, entry] of base.experiences.entries()) {
    const values = {
      kind: entry.kind,
      orgName: entry.org.name,
      orgUrl: entry.org.url || null,
      logoId: entry.org.logo ? (media.get(entry.org.logo.src) ?? null) : null,
      location: entry.location,
      employmentType: entry.employmentType,
      startDate: entry.period.start,
      endDate: entry.period.end,
      datePrecision: entry.period.precision,
      credentialId: entry.credential?.id || null,
      credentialUrl: entry.credential?.url || null,
      skills: entry.skills,
      position,
      isVisible: true,
    };
    await tx
      .insert(experiences)
      .values({ id: entry.id, ...values })
      .onConflictDoUpdate({ target: experiences.id, set: { ...values, updatedAt: now } });

    for (const [locale, content] of byLocale) {
      const translated = content.experiences.find((e) => e.id === entry.id);
      if (!translated) continue;
      const text = {
        title: translated.title,
        summary: translated.summary,
        highlights: translated.highlights,
        updatedAt: now,
      };
      await tx
        .insert(experienceTranslations)
        .values({ experienceId: entry.id, locale, ...text })
        .onConflictDoUpdate({
          target: [experienceTranslations.experienceId, experienceTranslations.locale],
          set: text,
        });
    }
  }
  const restoredIds = base.experiences.map((e) => e.id);
  await tx
    .update(experiences)
    .set({ isVisible: false, updatedAt: now })
    .where(restoredIds.length ? notInArray(experiences.id, restoredIds) : undefined);
}

/**
 * Posts are matched by slug. One the publication did not show goes back to
 * draft — unpublished, not deleted. A translation the publication did not have
 * is kept: restoring must never cost writing that exists only in the draft.
 */
async function restorePosts(tx: DbExecutor, { byLocale, docs }: Sources, now: Date): Promise<void> {
  const shown = new Map<string, { locale: Locale; doc: PostDoc }[]>();
  for (const [locale, content] of byLocale) {
    for (const summary of content.posts) {
      const doc = docs.get(locale)?.get(docKey("posts", summary.slug));
      if (doc?.kind !== "post") continue;
      const list = shown.get(summary.slug) ?? [];
      list.push({ locale, doc: doc as PostDoc });
      shown.set(summary.slug, list);
    }
  }

  const media = await assetIdsByPath(
    tx,
    [...shown.values()].flatMap((list) => list.map((p) => p.doc.cover?.src)),
  );

  for (const [slug, versions] of shown) {
    const first = versions[0]!.doc;
    const values = {
      status: "published",
      publishedAt: new Date(first.publishedAt),
      coverId: first.cover ? (media.get(first.cover.src) ?? null) : null,
      tags: first.tags,
      canonicalUrl: first.canonicalUrl,
      updatedAt: now,
    };
    const [row] = await tx
      .insert(posts)
      .values({ slug, ...values })
      .onConflictDoUpdate({ target: posts.slug, set: values })
      .returning({ id: posts.id });
    if (!row) throw new Error(`failed to restore post "${slug}"`);

    for (const { locale, doc } of versions) {
      const text = {
        title: doc.title,
        excerpt: doc.excerpt,
        body: unrenderBody(doc.body),
        seoTitle: doc.seo.title,
        seoDescription: doc.seo.description,
        updatedAt: now,
      };
      await tx
        .insert(postTranslations)
        .values({ postId: row.id, locale, ...text })
        .onConflictDoUpdate({
          target: [postTranslations.postId, postTranslations.locale],
          set: text,
        });
    }
  }

  const restoredSlugs = [...shown.keys()];
  await tx
    .update(posts)
    .set({ status: "draft", updatedAt: now })
    .where(
      and(
        eq(posts.status, "published"),
        restoredSlugs.length ? notInArray(posts.slug, restoredSlugs) : undefined,
      ),
    );
}

/**
 * Makes the draft match an earlier publication, so it can be edited from there
 * and published again. Nothing goes live until the next publish.
 *
 * Deliberately non-destructive: items the publication did not show (added
 * since, or hidden then) are hidden — or, for posts, unpublished — rather than
 * deleted, so a restore can never cost work that exists only in the draft.
 * Items are matched by their stable keys: skill id, project and post slug,
 * experience id, and label + URL for socials. Snapshots from before content
 * model v2 are upcast first.
 */
export async function restoreDraftFromPublication(
  sourceId: number,
  updatedBy: string | null = null,
): Promise<{ restored: Locale[] }> {
  return getDb().transaction(async (tx) => {
    const sources = toSources(await loadPublication(tx, sourceId));
    const now = new Date();

    await restoreIdentityAndDocs(tx, sources, now, updatedBy);
    await restoreSocials(tx, sources.base.socials, now);
    await restoreSkills(tx, sources, now);
    await restoreProjects(tx, sources, now);
    await restoreExperiences(tx, sources, now);
    await restorePosts(tx, sources, now);

    return { restored: [...sources.byLocale.keys()] };
  });
}
