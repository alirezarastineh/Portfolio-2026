import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";

import type { DbExecutor } from "../../content/build.js";
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

export type CorpusKind = "profile" | "experience" | "project" | "post" | "skills" | "cv";

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

export interface Corpus {
  /** The live version of each locale, e.g. `en:12|de:13`. */
  key: string;
  documents: CorpusDocument[];
  /** Every document, in order, as Markdown with a header per document. */
  text: string;
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

function documentsFor(live: LiveLocale): CorpusDocument[] {
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

async function buildCorpus(key: string, live: LiveLocale[]): Promise<Corpus> {
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
  // Phase 7 appends the curated FAQ entries and the assistant's system card here.
  return { key, documents, text: toMarkdown(documents) };
}

export async function getCorpus(db: DbExecutor = getDb()): Promise<Corpus> {
  const live = await loadLive(db);
  const key = live.map((l) => `${l.locale}:${l.versionId}`).join("|");
  if (memo?.key !== key) {
    const corpus = buildCorpus(key, live);
    memo = { key, corpus };
    // A failed build must not stay memoised.
    corpus.catch(() => {
      if (memo?.corpus === corpus) memo = undefined;
    });
  }
  return memo.corpus;
}
