import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";

import type { DbExecutor } from "../../content/build.js";
import { buildAll } from "../../content/publish.js";
import { htmlToText, imageMarker, mediaImages } from "../../content/sanitize.js";
import { docKey, LOCALES, type AppContent, type Doc, type Locale } from "../../content/schema.js";
import { payloadVersion, upcast, upcastDocs } from "../../content/upcast.js";
import { getDb } from "../../db/client.js";
import { contentPointers, contentVersionDocs, contentVersions } from "../../db/schema.js";
import { resolveMediaPath } from "../../lib/media-store.js";

/**
 * The published portfolio as one text, for the "Ask my portfolio" assistant
 * (Phase 7) to hold in context and cite from.
 *
 * Built only from what is live — never from the draft tables, never from the
 * legal pages — in a fixed order: per locale the profile, experience, projects
 * (with their case studies), posts and skills, then each CV. The same live
 * versions always produce the same bytes, which is what lets the model
 * provider cache the prefix; a publish or rollback changes the versions and
 * so the memo key, and the next call rebuilds.
 */

export type CorpusKind =
  "profile" | "experience" | "project" | "post" | "skills" | "cv" | "faq" | "system-card";

export interface CorpusDocument {
  /** Stable and unique across both languages, e.g. `project:atlas@en`. */
  id: string;
  kind: CorpusKind;
  locale: Locale;
  title: string;
  /** Where a citation links to: a page path, or the CV file. */
  url: string;
  text: string;
  /**
   * The admin's tier (plan phase 16, `corpus/render.ts`): promoted documents
   * are held whole at the front of the core, demoted ones cut shorter. Set
   * when the corpus is assembled, so a snapshot keeps it.
   */
  tier?: "promoted" | "demoted";
  /**
   * The pictures it shows (cover, body, gallery), in the order their
   * `[image: …]` markers stand in `text` (plan phase 17): what the admin's
   * image descriptions attach to when the corpus is assembled.
   */
  images?: CorpusImage[];
  /**
   * When it last changed, `YYYY-MM-DD` (plan phase 19), so an answer can say
   * "as of": a project's or post's own date, the FAQ entry's, else the
   * publish that holds it. Absent where nothing says.
   */
  updated?: string;
  /**
   * Documents an exception may sit in, same language, at most five (plan
   * phase 19, `corpus/related.ts`). Set when the corpus is assembled.
   */
  related?: string[];
}

/** A picture a document shows: its media file and its alt text, as its marker reads. */
export interface CorpusImage {
  file: string;
  alt: string;
}

/** `/media/<file>` → `<file>`; null for anything else. */
function mediaFile(src: string): string | null {
  return /^\/media\/([^/?#]+)$/.exec(src)?.[1] ?? null;
}

/** A project as data, for questions like "which projects used RAG?". */
export interface ProjectFacts {
  id: string;
  slug: string;
  locale: Locale;
  name: string;
  descriptor: string;
  role: string;
  period: string | null;
  category: string | null;
  stack: string[];
  tags: string[];
  metrics: string[];
  url: string;
  hasCaseStudy: boolean;
}

export interface PostFacts {
  slug: string;
  locale: Locale;
  title: string;
  url: string;
}

export interface Corpus {
  /** The live version of each locale, e.g. `en:12|de:13`. */
  key: string;
  documents: CorpusDocument[];
  /** Every document, in order, as Markdown with a header per document. */
  text: string;
  projects: ProjectFacts[];
  posts: PostFacts[];
}

interface LiveLocale {
  locale: Locale;
  versionId: number;
  core: AppContent;
  docs: Map<string, Doc>;
  /** When this version was published; a draft has none. */
  publishedAt?: string;
}

/** An ISO timestamp's day; the later of several, ignoring the missing. */
function day(...stamps: (string | undefined)[]): string | undefined {
  const known = stamps.filter((s): s is string => !!s).sort((a, b) => a.localeCompare(b));
  return known.at(-1)?.slice(0, 10);
}

let memo: { key: string; corpus: Promise<Corpus> } | undefined;

/** Forgets the memo (tests; the key already changes with every publish). */
export function resetCorpusMemo(): void {
  memo = undefined;
}

function period(start: string, end: string | null, present: string): string {
  return `${start} – ${end ?? present}`;
}

function experienceDocument(
  entry: AppContent["experiences"][number],
  locale: Locale,
  ui: AppContent["ui"],
  updated: string | undefined,
): CorpusDocument {
  return {
    id: `experience:${entry.id}@${locale}`,
    kind: "experience",
    locale,
    title: `${entry.title} — ${entry.org.name}`,
    url: `/${locale}#experience`,
    text: [
      `${entry.title}, ${entry.org.name} (${entry.kind})`,
      period(entry.period.start, entry.period.end, ui.experience.present),
      entry.location,
      entry.summary,
      ...entry.highlights.map((h) => `- ${h}`),
      entry.skills.length ? `Skills: ${entry.skills.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    ...(updated ? { updated } : {}),
  };
}

/**
 * Collects a document's pictures in the order their markers are written:
 * `rich` turns rich text into text with `[image: …]` markers, `picture` a
 * cover or gallery image into a line. Call them in the order of the lines.
 */
function pictures() {
  const images: CorpusImage[] = [];
  return {
    images,
    rich(html: string): string {
      images.push(...mediaImages(html));
      return htmlToText(html, { images: true });
    },
    picture(label: string, image: { src: string; alt: string }, caption = ""): string {
      const file = mediaFile(image.src);
      if (file) images.push({ file, alt: image.alt });
      // The marker ends the line: a description follows it on the next.
      const lead = caption.trim() ? `${caption.trim()} ` : "";
      return `${label}: ${lead}${imageMarker(image.alt)}`;
    },
  };
}

function projectDocument(
  project: AppContent["projects"][number],
  doc: Doc | undefined,
  locale: Locale,
  ui: AppContent["ui"],
): CorpusDocument {
  const { images, rich, picture } = pictures();
  const body = doc?.kind === "project" ? doc : undefined;
  const text = [
    `${project.name} — ${project.descriptor}`,
    project.hook,
    project.cover ? picture("Cover", project.cover) : "",
    project.role ? `Role: ${project.role}` : "",
    project.period
      ? `Period: ${period(project.period.start, project.period.end, ui.experience.present)}`
      : "",
    project.category ? `Category: ${project.category.label}` : "",
    `Stack: ${project.stack.join(", ")}`,
    ...project.metrics.map((m) => {
      const context = m.context ? ` (${m.context})` : "";
      return `Metric: ${m.value} ${m.label}${context}`;
    }),
    `${ui.projectCard.problem}: ${rich(project.problem)}`,
    `${ui.projectCard.arch}: ${rich(project.aiArchitecture)}`,
    `${ui.projectCard.infra}: ${rich(project.fullStackInfra)}`,
    ...project.outcomes.map((o) => `- ${o}`),
    body ? rich(body.body) : "",
    ...(body?.gallery ?? []).map((g) => picture("Gallery", g, g.caption)),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: `project:${project.slug}@${locale}`,
    kind: "project",
    locale,
    title: project.name,
    url: project.hasCaseStudy ? `/${locale}/work/${project.slug}` : `/${locale}#projects`,
    text,
    ...(images.length ? { images } : {}),
    updated: day(project.updatedAt, body?.updatedAt)!,
  };
}

function postDocument(
  post: AppContent["posts"][number],
  doc: Doc | undefined,
  locale: Locale,
): CorpusDocument {
  const { images, rich, picture } = pictures();
  const text = [
    post.title,
    `Published: ${post.publishedAt.slice(0, 10)}`,
    post.excerpt,
    post.cover ? picture("Cover", post.cover) : "",
    doc?.kind === "post" ? rich(doc.body) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: `post:${post.slug}@${locale}`,
    kind: "post",
    locale,
    title: post.title,
    url: `/${locale}/writing/${post.slug}`,
    text,
    ...(images.length ? { images } : {}),
    updated: day(post.updatedAt, doc?.kind === "post" ? doc.updatedAt : undefined)!,
  };
}

function documentsFor(
  live: Pick<LiveLocale, "locale" | "core" | "docs" | "publishedAt">,
): CorpusDocument[] {
  const { locale, core, docs } = live;
  const ui = core.ui;
  const identity = core.identity;
  // What only the publish dates: the profile, the experience and the skills.
  const published = day(live.publishedAt);
  const dated = published ? { updated: published } : {};

  const profileDoc: CorpusDocument = {
    id: `profile@${locale}`,
    kind: "profile",
    locale,
    title: identity.name,
    url: `/${locale}`,
    text: [
      `${identity.name} (${identity.handle}) — ${ui.profile.role}`,
      ui.profile.heroHeadline,
      ui.profile.heroSubheadline,
      ui.about.philosophy,
      `Availability: ${identity.availability}`,
      `Location: ${[identity.location.city, identity.location.country].filter(Boolean).join(", ") || ui.profile.location}`,
      identity.timezone ? `Time zone: ${identity.timezone}` : "",
      `Contact: ${identity.contactEmail}`,
      ...core.socials.map((s) => `${s.label}: ${s.href}`),
    ]
      .filter(Boolean)
      .join("\n"),
    ...dated,
  };

  const skillsDoc: CorpusDocument = {
    id: `skills@${locale}`,
    kind: "skills",
    locale,
    title: ui.skills.heading,
    url: `/${locale}#skills`,
    text: core.skills
      .map((s) => {
        const narrative = s.narrative ? ` — ${s.narrative}` : "";
        return `${s.title}: ${s.items.join(", ")}${narrative}`;
      })
      .join("\n"),
    ...dated,
  };

  return [
    profileDoc,
    ...core.experiences.map((entry) => experienceDocument(entry, locale, ui, published)),
    ...core.projects.map((project) =>
      projectDocument(project, docs.get(docKey("projects", project.slug)), locale, ui),
    ),
    ...core.posts.map((post) => postDocument(post, docs.get(docKey("posts", post.slug)), locale)),
    skillsDoc,
  ];
}

/** The CV's text layer; empty when the file is missing or unreadable. */
async function cvText(href: string): Promise<string> {
  const filename = /^\/media\/([^/?#]+)$/.exec(href)?.[1];
  const path = filename ? resolveMediaPath(filename) : null;
  if (!path) return "";
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: await readFile(path) });
    try {
      const rawText = (await parser.getText()).text;
      return rawText
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    console.error(`[ask] could not read the CV ${filename}`, error);
    return "";
  }
}

function toMarkdown(documents: CorpusDocument[]): string {
  return documents
    .map((d) =>
      [
        "---",
        `id: ${d.id}`,
        `locale: ${d.locale}`,
        `title: ${d.title}`,
        `url: ${d.url}`,
        "---",
        d.text,
      ].join("\n"),
    )
    .join("\n\n");
}

async function loadLive(db: DbExecutor): Promise<LiveLocale[]> {
  const rows = await db
    .select({
      locale: contentPointers.locale,
      versionId: contentVersions.id,
      payload: contentVersions.payload,
      createdAt: contentVersions.createdAt,
    })
    .from(contentPointers)
    .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId));

  const docRows = rows.length
    ? await db
        .select({
          versionId: contentVersionDocs.versionId,
          key: contentVersionDocs.key,
          payload: contentVersionDocs.payload,
        })
        .from(contentVersionDocs)
        .where(
          inArray(
            contentVersionDocs.versionId,
            rows.map((r) => r.versionId),
          ),
        )
    : [];

  const live = (
    await Promise.all(
      LOCALES.map(async (locale): Promise<LiveLocale | null> => {
        const row = rows.find((r) => r.locale === locale);
        if (!row) return null;
        const result = upcast(row.payload, row.createdAt.toISOString());
        if (!result.ok) return null;
        const docs = await upcastDocs(
          payloadVersion(row.payload) ?? result.from,
          locale,
          docRows.filter((d) => d.versionId === row.versionId),
        );
        return {
          locale,
          versionId: row.versionId,
          core: result.content,
          docs,
          publishedAt: row.createdAt.toISOString(),
        };
      }),
    )
  ).filter((entry): entry is LiveLocale => entry !== null);
  return live;
}

function projectFacts(live: Pick<LiveLocale, "locale" | "core">): ProjectFacts[] {
  const { locale, core } = live;
  return core.projects.map((p) => ({
    id: `project:${p.slug}@${locale}`,
    slug: p.slug,
    locale,
    name: p.name,
    descriptor: p.descriptor,
    role: p.role,
    period: p.period ? period(p.period.start, p.period.end, core.ui.experience.present) : null,
    category: p.category?.label ?? null,
    stack: p.stack,
    tags: p.tags,
    metrics: p.metrics.map((m) => `${m.value} ${m.label}`),
    url: p.hasCaseStudy ? `/${locale}/work/${p.slug}` : `/${locale}#projects`,
    hasCaseStudy: p.hasCaseStudy,
  }));
}

async function buildCorpus(
  key: string,
  live: Pick<LiveLocale, "locale" | "core" | "docs" | "publishedAt">[],
): Promise<Corpus> {
  const documents = live.flatMap(documentsFor);
  const cvs = (
    await Promise.all(
      live.map(async ({ locale, core }): Promise<CorpusDocument | null> => {
        const resume = core.identity.resume;
        if (!resume) return null;
        const text = await cvText(resume.href);
        if (!text) return null;
        return {
          id: `cv@${locale}`,
          kind: "cv",
          locale,
          title: `CV (${locale})`,
          url: resume.href,
          text,
        };
      }),
    )
  ).filter((cv): cv is CorpusDocument => cv !== null);
  documents.push(...cvs);
  // The assistant's FAQ and system card are added by `ask/corpus/index.ts`:
  // they are live on save, not published.
  return {
    key,
    documents,
    text: toMarkdown(documents),
    projects: live.flatMap(projectFacts),
    posts: live.flatMap(({ locale, core }) =>
      core.posts.map((p) => ({
        slug: p.slug,
        locale,
        title: p.title,
        url: `/${locale}/writing/${p.slug}`,
      })),
    ),
  };
}

/**
 * The same corpus from the draft tables, for the admin's playground: what the
 * assistant would know after the next publish. Never cached — drafts change
 * with every save — and never reachable from the public endpoint.
 */
export async function getDraftCorpus(db: DbExecutor = getDb()): Promise<Corpus> {
  const built = await buildAll(db);
  return buildCorpus(
    `draft:${built.map((b) => b.checksum.slice(0, 12)).join("|")}`,
    built.map((b) => ({ locale: b.locale, core: b.built.core, docs: b.built.docs })),
  );
}

export async function getCorpus(db: DbExecutor = getDb()): Promise<Corpus> {
  // Only the pointers on every call: the payloads are read when they changed.
  const pointers = await db
    .select({ locale: contentPointers.locale, versionId: contentPointers.versionId })
    .from(contentPointers);
  const key = LOCALES.flatMap((locale) => {
    const pointer = pointers.find((p) => p.locale === locale);
    return pointer ? [`${locale}:${pointer.versionId}`] : [];
  }).join("|");
  if (memo?.key !== key) {
    const corpus = loadLive(db).then((live) => buildCorpus(key, live));
    memo = { key, corpus };
    // A failed build must not stay memoised.
    corpus.catch(() => {
      if (memo?.corpus === corpus) memo = undefined;
    });
  }
  return memo.corpus;
}
