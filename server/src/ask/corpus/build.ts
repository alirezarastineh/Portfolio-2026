import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";

import type { DbExecutor } from "../../content/build.js";
import { buildAll } from "../../content/publish.js";
import { decodeEntities, htmlToText, imageMarker, mediaImages } from "../../content/sanitize.js";
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
  /**
   * A case study's or post's sections, as its page shows them (visitor plan
   * V9): what a visitor can point at with "Ask about this section". Absent
   * on any other document.
   */
  sections?: CorpusSection[];
  /** Its body's code blocks, in page order: what "Explain" points at (visitor plan V9). */
  code?: string[];
}

/** A picture a document shows: its media file and its alt text, as its marker reads. */
export interface CorpusImage {
  file: string;
  alt: string;
}

/** A part of a page under one of its `h2`s, by the id that heading has on the page (visitor plan V9). */
export interface CorpusSection {
  id: string;
  title: string;
  text: string;
  /** Its pictures, in marker order, for the descriptions the corpus adds (plan phase 17). */
  images?: CorpusImage[];
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
  /**
   * The site's public origin as the content declares it (`identity.siteUrl`), for
   * absolute links where a page-relative one is not enough (the MCP tools, plan
   * phase 32). Absent in snapshots and fixtures: links stay relative there.
   */
  siteUrl?: string;
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

/**
 * A label as the case study sets it for a heading: a single all-caps word
 * sentence-cased (`PROBLEM` → `Problem`), as the client's `sentenceCase` does.
 */
function headingLabel(label: string, locale: Locale): string {
  const word = label.trim();
  if (!/^\p{Lu}{4,}$/u.test(word)) return label;
  const lower = word.toLocaleLowerCase(locale);
  return lower.charAt(0).toLocaleUpperCase(locale) + lower.slice(1);
}

/** A section from its HTML: its text, its pictures marked, and those pictures. */
function sectionOf(id: string, title: string, html: string): CorpusSection {
  const images = mediaImages(html);
  return {
    id,
    title,
    text: htmlToText(html, { images: true }),
    ...(images.length ? { images } : {}),
  };
}

const BODY_H2 = /<h2 id="([^"<>]+)">([\s\S]*?)<\/h2>/g;

/**
 * A rendered body's sections (visitor plan V9): each `h2` the build gave an
 * id, with what follows it up to the next. Headings come before code is
 * highlighted, so code never holds one (content/rich-body.ts).
 */
export function bodySections(html: string): CorpusSection[] {
  const heads = [...html.matchAll(BODY_H2)];
  return heads.map((head, i) =>
    sectionOf(
      head[1]!,
      htmlToText(head[2]!).replace(/\s+/g, " ").trim(),
      html.slice(head.index + head[0].length, heads[i + 1]?.index ?? html.length),
    ),
  );
}

const CODE_BLOCK = /<pre class="code-block[^"<>]*"><code>([\s\S]*?)<\/code><\/pre>/g;

/** A rendered body's code blocks in page order, as their source: the highlighting's markup out. */
export function codeBlocks(html: string): string[] {
  return [...html.matchAll(CODE_BLOCK)].map((m) => decodeEntities(m[1]!.replace(/<[^<>]*>/g, "")));
}

/**
 * What a visitor can point at on a case study (visitor plan V9): its fixed
 * sections under the ids its page gives them (a base a body heading holds
 * already takes `-overview`, pages/[locale]/work/[slug].page.ts), then the
 * body's own, then the gallery; and the body's code blocks.
 */
function caseStudyParts(
  project: AppContent["projects"][number],
  body: Extract<Doc, { kind: "project" }>,
  locale: Locale,
  ui: AppContent["ui"],
): Pick<CorpusDocument, "sections" | "code"> {
  const taken = new Set(body.toc.map((entry) => entry.id));
  const id = (base: string) => (taken.has(base) ? `${base}-overview` : base);
  const card = ui.projectCard;
  const fixed = (
    [
      ["problem", card.problem, project.problem],
      ["architecture", card.arch, project.aiArchitecture],
      ["infrastructure", card.infra, project.fullStackInfra],
    ] as const
  ).flatMap(([base, label, html]) =>
    html.trim() ? [sectionOf(id(base), headingLabel(label, locale), html)] : [],
  );
  const outcomes: CorpusSection[] = project.outcomes.length
    ? [
        {
          id: id("outcomes"),
          title: headingLabel(card.outcomes, locale),
          text: project.outcomes.map((o) => `- ${o}`).join("\n"),
        },
      ]
    : [];
  const gallery = pictures();
  const galleryText = body.gallery.map((g) => gallery.picture("Gallery", g, g.caption));
  const shown: CorpusSection[] = galleryText.length
    ? [
        {
          id: id("gallery"),
          title: ui.caseStudy.gallery,
          text: galleryText.join("\n"),
          ...(gallery.images.length ? { images: gallery.images } : {}),
        },
      ]
    : [];
  const code = codeBlocks(body.body);
  return {
    sections: [...fixed, ...outcomes, ...bodySections(body.body), ...shown],
    ...(code.length ? { code } : {}),
  };
}

/** What a visitor can point at on a post (visitor plan V9): its body's sections and code blocks. */
function postParts(body: string): Pick<CorpusDocument, "sections" | "code"> {
  const sections = bodySections(body);
  const code = codeBlocks(body);
  return { ...(sections.length ? { sections } : {}), ...(code.length ? { code } : {}) };
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
    ...(body && project.hasCaseStudy ? caseStudyParts(project, body, locale, ui) : {}),
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
    ...(doc?.kind === "post" ? postParts(doc.body) : {}),
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
    ...siteUrlOf(live),
  };
}

/** The first language's declared origin, when it is a URL. */
function siteUrlOf(live: Pick<LiveLocale, "core">[]): Pick<Corpus, "siteUrl"> {
  for (const { core } of live) {
    try {
      const origin = new URL(core.identity.siteUrl).origin;
      if (origin !== "null") return { siteUrl: origin };
    } catch {
      // Not a URL: try the next language.
    }
  }
  return {};
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
