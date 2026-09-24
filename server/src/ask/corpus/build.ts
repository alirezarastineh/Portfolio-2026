import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";

import type { DbExecutor } from "../../content/build.js";
import { buildAll } from "../../content/publish.js";
import { htmlToText } from "../../content/sanitize.js";
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
  };
}

function projectDocument(
  project: AppContent["projects"][number],
  doc: Doc | undefined,
  locale: Locale,
  ui: AppContent["ui"],
): CorpusDocument {
  return {
    id: `project:${project.slug}@${locale}`,
    kind: "project",
    locale,
    title: project.name,
    url: project.hasCaseStudy ? `/${locale}/work/${project.slug}` : `/${locale}#projects`,
    text: [
      `${project.name} — ${project.descriptor}`,
      project.hook,
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
      `${ui.projectCard.problem}: ${htmlToText(project.problem)}`,
      `${ui.projectCard.arch}: ${htmlToText(project.aiArchitecture)}`,
      `${ui.projectCard.infra}: ${htmlToText(project.fullStackInfra)}`,
      ...project.outcomes.map((o) => `- ${o}`),
      doc?.kind === "project" ? htmlToText(doc.body) : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function postDocument(
  post: AppContent["posts"][number],
  doc: Doc | undefined,
  locale: Locale,
): CorpusDocument {
  return {
    id: `post:${post.slug}@${locale}`,
    kind: "post",
    locale,
    title: post.title,
    url: `/${locale}/writing/${post.slug}`,
    text: [
      post.title,
      `Published: ${post.publishedAt.slice(0, 10)}`,
      post.excerpt,
      doc?.kind === "post" ? htmlToText(doc.body) : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function documentsFor(live: Pick<LiveLocale, "locale" | "core" | "docs">): CorpusDocument[] {
  const { locale, core, docs } = live;
  const ui = core.ui;
  const identity = core.identity;

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
  };

  return [
    profileDoc,
    ...core.experiences.map((entry) => experienceDocument(entry, locale, ui)),
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

  const live: LiveLocale[] = [];
  for (const locale of LOCALES) {
    const row = rows.find((r) => r.locale === locale);
    if (!row) continue;
    const result = upcast(row.payload, row.createdAt.toISOString());
    if (!result.ok) continue;
    const docs = await upcastDocs(
      payloadVersion(row.payload) ?? result.from,
      locale,
      docRows.filter((d) => d.versionId === row.versionId),
    );
    live.push({ locale, versionId: row.versionId, core: result.content, docs });
  }
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
  live: Pick<LiveLocale, "locale" | "core" | "docs">[],
): Promise<Corpus> {
  const documents = live.flatMap(documentsFor);
  for (const { locale, core } of live) {
    const resume = core.identity.resume;
    if (!resume) continue;
    const text = await cvText(resume.href);
    if (text) {
      documents.push({
        id: `cv@${locale}`,
        kind: "cv",
        locale,
        title: `CV (${locale})`,
        url: resume.href,
        text,
      });
    }
  }
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
