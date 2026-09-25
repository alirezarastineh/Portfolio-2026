import { LEGAL_DEFAULTS, LEGAL_DEFAULTS_UPDATED_AT } from "./legal-defaults.js";
import { renderBody } from "./rich-body.js";
import {
  appContentSchema,
  CONTENT_SCHEMA_VERSION,
  docKey,
  docSchema,
  legalDocSchema,
  type AppContent,
  type Doc,
  type Image,
  type Locale,
} from "./schema.js";
import * as v1 from "./schema-v1.js";
import { withUiDefaults } from "./ui-defaults.js";

/**
 * Bridges snapshots published before content model v2.
 *
 * Every reader of published content — the public API, the publications diff,
 * rollback, restore, the assistant's corpus — goes through `upcast`, so the
 * rest of the code only ever sees v2. Old rows are never rewritten; they are
 * converted on the way out. The conversion is one-way: nothing serves v1.
 */

export function payloadVersion(payload: unknown): number | null {
  const version = (payload as { version?: unknown } | null)?.version;
  return typeof version === "number" ? version : null;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** A v1 image string (relative, legacy SVG, or an absolute `https://api…/media/x`). */
function imageFromV1(image: string, alt: string): Image | null {
  if (!image) return null;
  const media = /\/media\/([^/?#]+)$/.exec(image);
  return {
    src: media ? `/media/${media[1]}` : image,
    srcset: "",
    sources: [],
    width: null,
    height: null,
    alt,
    blur: null,
  };
}

function upcastV1(content: v1.AppContent, publishedAt: string): AppContent {
  const locale = content.locale;
  return appContentSchema.parse({
    version: CONTENT_SCHEMA_VERSION,
    locale,
    ui: withUiDefaults(content.ui, locale),
    identity: {
      ...content.identity,
      siteUrl: originOf(content.seo.canonical),
      availability: "open",
      location: { city: "", country: "" },
      timezone: "",
      avatar: null,
      resume: null,
    },
    socials: content.socials,
    skills: content.skills,
    projects: content.projects.map(({ image, ...project }) => ({
      ...project,
      cover: imageFromV1(image, project.name),
      featured: false,
      period: null,
      role: "",
      category: null,
      tags: [],
      metrics: [],
      hasCaseStudy: false,
      updatedAt: publishedAt,
    })),
    experiences: [],
    posts: [],
    // v1 had no legal documents; the bundled draft stands in, so a rollback
    // to a v1 publication can never take the imprint offline.
    legal: legalDocSchema.options.map((doc) => ({
      doc,
      title: LEGAL_DEFAULTS[locale][doc].title,
      updatedAt: LEGAL_DEFAULTS_UPDATED_AT,
    })),
    seo: content.seo,
  });
}

export type UpcastResult =
  { ok: true; content: AppContent; from: number } | { ok: false; issues: unknown };

/**
 * Any published core payload as v2. `publishedAt` stands in for timestamps v1
 * never recorded (a project's `updatedAt`).
 */
export function upcast(payload: unknown, publishedAt: string): UpcastResult {
  const version = payloadVersion(payload);
  if (version === 1) {
    const parsed = v1.appContentSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, issues: parsed.error.issues };
    try {
      return { ok: true, content: upcastV1(parsed.data, publishedAt), from: 1 };
    } catch (error) {
      return { ok: false, issues: String(error) };
    }
  }
  const parsed = appContentSchema.safeParse(payload);
  return parsed.success
    ? { ok: true, content: parsed.data, from: CONTENT_SCHEMA_VERSION }
    : { ok: false, issues: parsed.error.issues };
}

/**
 * The docs of a published version. v2 versions store theirs; a v1 version has
 * none, so it gets the bundled legal pages its upcast core lists.
 */
export async function upcastDocs(
  version: number,
  locale: Locale,
  stored: { key: string; payload: unknown }[],
): Promise<Map<string, Doc>> {
  const docs = new Map<string, Doc>();
  if (version === 1) {
    for (const doc of legalDocSchema.options) {
      const draft = LEGAL_DEFAULTS[locale][doc];
      const rendered = await renderBody(draft.body);
      docs.set(docKey("legal", doc), {
        kind: "legal",
        doc,
        title: draft.title,
        body: rendered.html,
        updatedAt: LEGAL_DEFAULTS_UPDATED_AT,
      });
    }
    return docs;
  }
  for (const row of stored) {
    docs.set(row.key, docSchema.parse(row.payload));
  }
  return docs;
}
