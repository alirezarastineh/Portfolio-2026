import type { Locale } from "../content/schema.js";
import type { CorpusDocument } from "./corpus/build.js";
import type { AskCorpus } from "./corpus/index.js";
import { coreLimit, coreView, type CoreLayout } from "./corpus/render.js";
import { allowedPath } from "./tools.js";

/**
 * The page a question is asked on (visitor plan V8; the book's Context
 * Triage: what the visitor is reading is the active task, P0). The browser
 * sends the page's path. It names a document only when `allowedPath` takes it
 * and it is a published case study or post, in the page's own language:
 * nothing else about the path is trusted.
 */

/** The longest page path a request may send: the site's own are under 100 characters. */
export const PAGE_CHARS = 160;

/** How a core holds a document: all of it, cut short, or as a line in the other language's list. */
export type Held = "whole" | "clipped" | "handle";

export interface PageDocument {
  /** The document the page shows, in the page's language. */
  document: CorpusDocument;
  /** How the core the answer reads holds it: anything but whole is promoted into the page block. */
  held: Held;
  /** A case study's project, which the router counts as named; absent on a post. */
  project?: string;
}

/** A case study or a post, as `allowedPath` returns it. */
const DOCUMENT_PAGE = /^\/(en|de)\/(work|writing)\/([a-z0-9-]+)$/;

type PageCorpus = Pick<AskCorpus, "byId" | "documents" | "layout" | "projects" | "posts">;

/** The document `page` shows, or null: any other page, or a path that is not one of the site's. */
export function pageDocument(
  corpus: PageCorpus,
  page: string | undefined,
  reading: Locale,
): PageDocument | null {
  const path = page ? allowedPath(corpus, page) : null;
  const match = path ? DOCUMENT_PAGE.exec(path) : null;
  if (!match) return null;
  const locale = match[1] as Locale;
  const slug = match[3]!;
  const work = match[2] === "work";
  const document = corpus.byId.get(`${work ? "project" : "post"}:${slug}@${locale}`);
  if (!document) return null;
  const project = work
    ? corpus.projects.find((p) => p.locale === locale && p.slug === slug)?.name
    : undefined;
  return { document, held: heldIn(corpus, document, reading), ...(project ? { project } : {}) };
}

/** Each corpus's handles, per layout and reading language: worked out once, not per question. */
const handleSets = new WeakMap<readonly CorpusDocument[], Map<string, ReadonlySet<string>>>();

function handlesOf(
  documents: readonly CorpusDocument[],
  layout: CoreLayout,
  reading: Locale,
): ReadonlySet<string> {
  let sets = handleSets.get(documents);
  if (!sets) {
    sets = new Map();
    handleSets.set(documents, sets);
  }
  const key = `${layout}:${reading}`;
  let handles = sets.get(key);
  if (!handles) {
    handles = new Set(coreView(documents, reading, layout).handles.map((d) => d.id));
    sets.set(key, handles);
  }
  return handles;
}

/** How the core read in `reading` holds `document` (perception.ts's `fetchKind`, named for a page). */
export function heldIn(
  corpus: Pick<AskCorpus, "documents" | "layout">,
  document: CorpusDocument,
  reading: Locale,
): Held {
  if (handlesOf(corpus.documents, corpus.layout, reading).has(document.id)) return "handle";
  const limit = coreLimit(document, corpus.layout);
  return limit !== undefined && document.text.length > limit ? "clipped" : "whole";
}
