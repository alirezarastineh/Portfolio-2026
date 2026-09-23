import { and, asc, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";

import {
  appContentSchema,
  CONTENT_SCHEMA_VERSION,
  docKey,
  docSchema,
  LOCALES,
  type AppContent,
  type Doc,
  type Image,
  type LegalDoc,
  type Locale,
  type Metric,
} from "./schema.js";
import { bodyMediaFilenames, readingMinutes, renderBody, type BodyMedia } from "./rich-body.js";
import { withUiDefaults } from "./ui-defaults.js";
import type { Database } from "../db/client.js";
import {
  contentDocuments,
  experiences,
  experienceTranslations,
  mediaAssets,
  mediaVariants,
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
  type MetricValue,
} from "../db/schema.js";

/** A `db` or an open transaction — both expose the query builder. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** One locale as published: the core payload and its long-form docs, by key. */
export interface BuiltLocale {
  core: AppContent;
  docs: Map<string, Doc>;
}

type AssetRow = typeof mediaAssets.$inferSelect;
type VariantRow = typeof mediaVariants.$inferSelect;

/** Media rows needed to turn an asset id or a `/media/<file>` path into an image. */
class MediaIndex {
  private readonly byId = new Map<string, AssetRow>();
  private readonly byFilename = new Map<string, AssetRow>();
  private readonly variants = new Map<string, VariantRow[]>();

  static async load(
    db: DbExecutor,
    ids: (string | null)[],
    filenames: string[],
  ): Promise<MediaIndex> {
    const index = new MediaIndex();
    const wantedIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const wantedNames = [...new Set(filenames)];
    if (wantedIds.length === 0 && wantedNames.length === 0) return index;

    const conditions = [
      ...(wantedIds.length ? [inArray(mediaAssets.id, wantedIds)] : []),
      ...(wantedNames.length ? [inArray(mediaAssets.filename, wantedNames)] : []),
    ];
    const assets = await db
      .select()
      .from(mediaAssets)
      .where(or(...conditions));
    for (const asset of assets) {
      index.byId.set(asset.id, asset);
      index.byFilename.set(asset.filename, asset);
    }
    if (assets.length > 0) {
      const variants = await db
        .select()
        .from(mediaVariants)
        .where(
          inArray(
            mediaVariants.assetId,
            assets.map((a) => a.id),
          ),
        )
        .orderBy(asc(mediaVariants.width));
      for (const variant of variants) {
        const list = index.variants.get(variant.assetId) ?? [];
        list.push(variant);
        index.variants.set(variant.assetId, list);
      }
    }
    return index;
  }

  asset(id: string | null): AssetRow | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  /** An image asset as the payload's `imageSchema`; documents and unknown ids are null. */
  image(id: string | null, locale: Locale, fallbackAlt = ""): Image | null {
    const asset = this.asset(id);
    if (asset?.kind !== "image") return null;

    const variants = this.variants.get(asset.id) ?? [];
    const set = (format: string) =>
      variants
        .filter((v) => v.format === format)
        .map((v) => `/media/${v.filename} ${v.width}w`)
        .join(", ");
    const avif = set("avif");
    const webp = set("webp");
    const own = locale === "de" ? asset.altDe : asset.altEn;
    const other = locale === "de" ? asset.altEn : asset.altDe;

    return {
      src: `/media/${asset.filename}`,
      srcset: webp,
      sources: [
        ...(avif ? [{ type: "image/avif" as const, srcset: avif }] : []),
        ...(webp ? [{ type: "image/webp" as const, srcset: webp }] : []),
      ],
      width: asset.width,
      height: asset.height,
      alt: own?.trim() || other?.trim() || fallbackAlt,
      blur: asset.blurDataUri && asset.blurDataUri.length <= 2048 ? asset.blurDataUri : null,
    };
  }

  /** What `renderBody` needs for inline `/media/…` images. */
  bodyMedia(): Map<string, BodyMedia> {
    const out = new Map<string, BodyMedia>();
    for (const [filename, asset] of this.byFilename) {
      if (asset.kind !== "image") continue;
      out.set(filename, {
        filename,
        width: asset.width,
        height: asset.height,
        variants: (this.variants.get(asset.id) ?? []).map((v) => ({
          format: v.format,
          width: v.width,
          filename: v.filename,
        })),
      });
    }
    return out;
  }
}

/** A `/projects/*.svg` placeholder (or any path without an asset) as an image. */
function legacyImage(path: string | null, alt: string): Image | null {
  if (!path) return null;
  const match = /\/media\/([^/?#]+)$/.exec(path);
  return {
    src: match ? `/media/${match[1]}` : path,
    srcset: "",
    sources: [],
    width: null,
    height: null,
    alt,
    blur: null,
  };
}

function latest(...dates: (Date | null | undefined)[]): string {
  const times = dates.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  return new Date(Math.max(0, ...times)).toISOString();
}

function cleanMetrics(metrics: MetricValue[]): Metric[] {
  return metrics
    .filter((m) => m.value?.trim() && m.label?.trim())
    .map((m) => ({
      value: m.value.trim(),
      label: m.label.trim(),
      ...(m.context?.trim() ? { context: m.context.trim() } : {}),
    }));
}

function originOf(url: string | undefined | null): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

const LEGAL_DOCS: LegalDoc[] = ["imprint", "privacy"];

type ProjectRow = {
  project: typeof projects.$inferSelect;
  translation: typeof projectTranslations.$inferSelect;
};
type PostRow = {
  post: typeof posts.$inferSelect;
  translation: typeof postTranslations.$inferSelect;
};
type GalleryRow = typeof projectGallery.$inferSelect;
type CaseStudyLocaleRow = { projectId: string; locale: Locale; body: string };
type PostLocaleRow = { postId: string; locale: Locale };
type LegalRow = { doc: LegalDoc; title: string; body: string; updatedAt: Date };

async function buildProjects(
  projectRows: ProjectRow[],
  caseStudyLocales: CaseStudyLocaleRow[],
  galleryRows: GalleryRow[],
  media: MediaIndex,
  bodyMedia: Map<string, BodyMedia>,
  locale: Locale,
): Promise<{ projectsOut: AppContent["projects"]; docs: [string, Doc][] }> {
  const projectsOut: AppContent["projects"] = [];
  const docs: [string, Doc][] = [];

  for (const { project, translation } of projectRows) {
    const hasCaseStudy = translation.body.trim() !== "";
    const updatedAt = latest(project.updatedAt, translation.updatedAt);
    projectsOut.push({
      slug: project.slug,
      name: translation.name,
      descriptor: translation.descriptor,
      hook: translation.hook,
      problem: translation.problem,
      aiArchitecture: translation.aiArchitecture,
      fullStackInfra: translation.fullStackInfra,
      outcomes: translation.outcomes,
      stack: project.stack,
      links: {
        live: project.linkLive ?? "",
        repo: project.linkRepo ?? "",
        caseStudy: project.linkCaseStudy ?? "",
      },
      cover:
        media.image(project.coverId, locale, translation.name) ??
        (project.coverId ? null : legacyImage(project.imagePath, translation.name)),
      featured: project.featured,
      period: project.periodStart ? { start: project.periodStart, end: project.periodEnd } : null,
      role: translation.role,
      category: project.category
        ? { key: project.category, label: translation.categoryLabel || project.category }
        : null,
      tags: project.tags,
      metrics: cleanMetrics(translation.metrics),
      hasCaseStudy,
      updatedAt,
    });

    if (hasCaseStudy) {
      const rendered = await renderBody(translation.body, bodyMedia);
      const withBody = new Set(
        caseStudyLocales
          .filter((t) => t.projectId === project.id && t.body.trim() !== "")
          .map((t) => t.locale),
      );
      docs.push([
        docKey("projects", project.slug),
        {
          kind: "project",
          slug: project.slug,
          body: rendered.html,
          toc: rendered.toc,
          gallery: galleryRows
            .filter((g) => g.projectId === project.id)
            .flatMap((g) => {
              const image = media.image(g.mediaId, locale, translation.name);
              return image ? [{ ...image, caption: g.caption[locale] ?? "" }] : [];
            }),
          seo: { title: "", description: translation.seoDescription },
          alternates: Object.fromEntries(
            LOCALES.map((l) => [l, withBody.has(l) ? `/${l}/work/${project.slug}` : null]),
          ) as Record<Locale, string | null>,
          updatedAt,
        },
      ]);
    }
  }

  return { projectsOut, docs };
}

async function buildPosts(
  postRows: PostRow[],
  postLocales: PostLocaleRow[],
  media: MediaIndex,
  bodyMedia: Map<string, BodyMedia>,
  locale: Locale,
): Promise<{ postsOut: AppContent["posts"]; docs: [string, Doc][] }> {
  const postsOut: AppContent["posts"] = [];
  const docs: [string, Doc][] = [];

  for (const { post, translation } of postRows) {
    const available = new Set(postLocales.filter((t) => t.postId === post.id).map((t) => t.locale));
    const summary = {
      slug: post.slug,
      title: translation.title,
      excerpt: translation.excerpt,
      publishedAt: post.publishedAt!.toISOString(),
      updatedAt: latest(post.updatedAt, translation.updatedAt),
      tags: post.tags,
      cover: media.image(post.coverId, locale, translation.title),
      readingMinutes: readingMinutes(translation.body),
      alternates: Object.fromEntries(
        LOCALES.map((l) => [l, available.has(l) ? `/${l}/writing/${post.slug}` : null]),
      ) as Record<Locale, string | null>,
    };
    postsOut.push(summary);

    const rendered = await renderBody(translation.body, bodyMedia);
    docs.push([
      docKey("posts", post.slug),
      {
        ...summary,
        kind: "post",
        body: rendered.html,
        toc: rendered.toc,
        seo: { title: translation.seoTitle, description: translation.seoDescription },
        canonicalUrl: post.canonicalUrl || null,
      },
    ]);
  }

  return { postsOut, docs };
}

async function buildLegal(
  legalRows: LegalRow[],
  bodyMedia: Map<string, BodyMedia>,
): Promise<{ legalOut: AppContent["legal"]; docs: [string, Doc][] }> {
  const legalOut: AppContent["legal"] = [];
  const docs: [string, Doc][] = [];

  for (const legal of legalRows) {
    const updatedAt = legal.updatedAt.toISOString();
    legalOut.push({ doc: legal.doc, title: legal.title, updatedAt });
    const rendered = await renderBody(legal.body, bodyMedia);
    docs.push([
      docKey("legal", legal.doc),
      {
        kind: "legal",
        doc: legal.doc,
        title: legal.title,
        body: rendered.html,
        updatedAt,
      },
    ]);
  }

  return { legalOut, docs };
}

/**
 * Assembles one locale's content from the working tables — i.e. from the
 * current draft. Publishing, preview and the "unpublished changes" badge all
 * go through here, so they can never disagree.
 *
 * `now` decides which scheduled posts are due; everything else is a pure
 * function of the draft, so an unchanged draft yields an identical checksum.
 */
export async function buildLocale(
  db: DbExecutor,
  locale: Locale,
  now: Date = new Date(),
): Promise<BuiltLocale> {
  const [profileRow] = await db.select().from(siteProfile).limit(1);
  if (!profileRow) {
    throw new Error("site_profile is empty — run the seed first");
  }

  const documentRows = await db
    .select({
      section: contentDocuments.section,
      data: contentDocuments.data,
      updatedAt: contentDocuments.updatedAt,
    })
    .from(contentDocuments)
    .where(eq(contentDocuments.locale, locale));

  const ui = documentRows.find((d) => d.section === "ui")?.data;
  const seo = documentRows.find((d) => d.section === "seo")?.data as
    { canonical?: string } | undefined;
  if (!ui || !seo) {
    throw new Error(`content_documents is missing ui/seo for locale "${locale}"`);
  }

  const [resume] = await db
    .select({ mediaId: profileResumes.mediaId })
    .from(profileResumes)
    .where(eq(profileResumes.locale, locale))
    .limit(1);

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
    .select({ project: projects, translation: projectTranslations })
    .from(projects)
    .innerJoin(
      projectTranslations,
      and(eq(projectTranslations.projectId, projects.id), eq(projectTranslations.locale, locale)),
    )
    .where(eq(projects.isVisible, true))
    .orderBy(asc(projects.position), asc(projects.id));

  const projectIds = projectRows.map((r) => r.project.id);
  // The other language's case study decides whether an alternate exists.
  const caseStudyLocales = projectIds.length
    ? await db
        .select({
          projectId: projectTranslations.projectId,
          locale: projectTranslations.locale,
          body: projectTranslations.body,
        })
        .from(projectTranslations)
        .where(inArray(projectTranslations.projectId, projectIds))
    : [];
  const galleryRows = projectIds.length
    ? await db
        .select()
        .from(projectGallery)
        .where(inArray(projectGallery.projectId, projectIds))
        .orderBy(asc(projectGallery.position))
    : [];

  const experienceRows = await db
    .select({ experience: experiences, translation: experienceTranslations })
    .from(experiences)
    .innerJoin(
      experienceTranslations,
      and(
        eq(experienceTranslations.experienceId, experiences.id),
        eq(experienceTranslations.locale, locale),
      ),
    )
    .where(eq(experiences.isVisible, true))
    .orderBy(asc(experiences.position), asc(experiences.id));

  // Published and due. A post missing in this language simply is not listed.
  const postRows = await db
    .select({ post: posts, translation: postTranslations })
    .from(posts)
    .innerJoin(
      postTranslations,
      and(eq(postTranslations.postId, posts.id), eq(postTranslations.locale, locale)),
    )
    .where(
      and(eq(posts.status, "published"), isNotNull(posts.publishedAt), lte(posts.publishedAt, now)),
    )
    .orderBy(desc(posts.publishedAt), asc(posts.slug));
  const postIds = postRows.map((r) => r.post.id);
  const postLocales = postIds.length
    ? await db
        .select({ postId: postTranslations.postId, locale: postTranslations.locale })
        .from(postTranslations)
        .where(inArray(postTranslations.postId, postIds))
    : [];

  const legalRows = LEGAL_DOCS.flatMap((doc) => {
    const row = documentRows.find((d) => d.section === doc);
    const data = row?.data as { title?: unknown; body?: unknown } | undefined;
    return row && typeof data?.title === "string" && data.title && typeof data.body === "string"
      ? [{ doc, title: data.title, body: data.body, updatedAt: row.updatedAt }]
      : [];
  });

  const bodies = [
    ...projectRows.map((r) => r.translation.body),
    ...postRows.map((r) => r.translation.body),
    ...legalRows.map((r) => r.body),
  ];
  const media = await MediaIndex.load(
    db,
    [
      profileRow.avatarId,
      resume?.mediaId ?? null,
      ...projectRows.map((r) => r.project.coverId),
      ...galleryRows.map((g) => g.mediaId),
      ...experienceRows.map((r) => r.experience.logoId),
      ...postRows.map((r) => r.post.coverId),
    ],
    bodies.flatMap(bodyMediaFilenames),
  );
  const bodyMedia = media.bodyMedia();

  const { projectsOut, docs: projectDocs } = await buildProjects(
    projectRows,
    caseStudyLocales,
    galleryRows,
    media,
    bodyMedia,
    locale,
  );
  const { postsOut, docs: postDocs } = await buildPosts(
    postRows,
    postLocales,
    media,
    bodyMedia,
    locale,
  );
  const { legalOut, docs: legalDocs } = await buildLegal(legalRows, bodyMedia);

  const docs = new Map<string, Doc>([...projectDocs, ...postDocs, ...legalDocs]);

  const resumeAsset = media.asset(resume?.mediaId ?? null);

  // parse() is the gate: an invalid payload throws here, inside the publish
  // transaction, so the live pointer never moves to broken content.
  const core = appContentSchema.parse({
    version: CONTENT_SCHEMA_VERSION,
    locale,
    ui: withUiDefaults(ui, locale),
    identity: {
      name: profileRow.name,
      handle: profileRow.handle,
      contactEmail: profileRow.contactEmail,
      primaryCtaHref: profileRow.primaryCtaHref,
      secondaryCtaHref: profileRow.secondaryCtaHref,
      siteUrl: profileRow.siteUrl?.trim() || originOf(seo.canonical),
      availability: profileRow.availability,
      location: { city: profileRow.locationCity, country: profileRow.locationCountry },
      timezone: profileRow.timezone,
      avatar: media.image(profileRow.avatarId, locale, profileRow.name),
      resume:
        resumeAsset?.kind === "document"
          ? { href: `/media/${resumeAsset.filename}`, bytes: resumeAsset.byteSize }
          : null,
    },
    socials: socialRows,
    skills: skillRows,
    projects: projectsOut,
    experiences: experienceRows.map(({ experience: e, translation: t }) => ({
      id: e.id,
      kind: e.kind,
      org: {
        name: e.orgName,
        url: e.orgUrl ?? "",
        logo: media.image(e.logoId, locale, e.orgName),
      },
      title: t.title,
      summary: t.summary,
      highlights: t.highlights.filter((h) => h.trim() !== ""),
      location: e.location,
      employmentType: e.employmentType,
      period: { start: e.startDate, end: e.endDate, precision: e.datePrecision },
      credential:
        e.credentialId || e.credentialUrl
          ? { id: e.credentialId ?? "", url: e.credentialUrl ?? "" }
          : null,
      skills: e.skills,
    })),
    posts: postsOut,
    legal: legalOut,
    seo,
  });

  for (const [key, doc] of docs) docs.set(key, docSchema.parse(doc));
  return { core, docs };
}

/** The core payload only — preview and anything that needs no bodies. */
export async function buildContent(db: DbExecutor, locale: Locale): Promise<AppContent> {
  return (await buildLocale(db, locale)).core;
}
