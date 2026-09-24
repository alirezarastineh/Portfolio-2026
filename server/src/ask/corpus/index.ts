import { createHash } from "node:crypto";

import type { Locale } from "../../content/schema.js";
import { getAskConfig, type AskConfig } from "../config.js";
import { assistantState, type AiSettings, type FaqEntry } from "../settings.js";
import { countTokens } from "../tokens.js";
import { assistantDocuments } from "./assistant-docs.js";
import {
  getCorpus,
  getDraftCorpus,
  type Corpus,
  type CorpusDocument,
  type CorpusKind,
} from "./build.js";
import { CorpusSearch } from "./search.js";

/**
 * What the assistant knows for one question: the published corpus plus its
 * own FAQ and system card, rendered as the byte-stable prefix it holds in
 * context (the core), a much shorter version for models without tools, and a
 * search index. Memoised by key, so between publishes and admin edits every
 * question reuses the same bytes — which is what Gemini's implicit cache needs.
 */

export interface AskCorpus extends Omit<Corpus, "text"> {
  byId: Map<string, CorpusDocument>;
  /** The prefix: every document, long ones cut short with a pointer to `get_document`. */
  core: string;
  /** For answer-only models (small context, no tools). */
  compact: string;
  coreTokens: number;
  search: CorpusSearch;
}

/** Characters kept in the prefix per kind; the rest is one `get_document` away. */
const CORE_LIMIT: Partial<Record<CorpusKind, number>> = {
  project: 2_400,
  post: 1_500,
  cv: 2_500,
};
const COMPACT_DOC_CHARS = 420;
const COMPACT_TOTAL_CHARS = 40_000;

function header(d: CorpusDocument): string {
  return ["---", `id: ${d.id}`, `title: ${d.title}`, `url: ${d.url}`, "---"].join("\n");
}

function clip(text: string, limit: number | undefined, id: string): string {
  if (!limit || text.length <= limit) return text;
  const cut = text.lastIndexOf("\n", limit);
  return `${text.slice(0, cut > limit / 2 ? cut : limit)}\n[… continues: get_document("${id}")]`;
}

export function renderCore(documents: CorpusDocument[]): string {
  return documents
    .map((d) => `${header(d)}\n${clip(d.text, CORE_LIMIT[d.kind], d.id)}`)
    .join("\n\n");
}

export function renderCompact(documents: CorpusDocument[]): string {
  const parts: string[] = [];
  let total = 0;
  for (const d of documents) {
    const body =
      d.text.length > COMPACT_DOC_CHARS ? `${d.text.slice(0, COMPACT_DOC_CHARS)}…` : d.text;
    const part = `[${d.id}] ${d.title} (${d.url})\n${body}`;
    if (total + part.length > COMPACT_TOTAL_CHARS) break;
    parts.push(part);
    total += part.length;
  }
  return parts.join("\n\n");
}

function revision(settings: AiSettings, faq: FaqEntry[]): string {
  return createHash("sha256")
    .update(JSON.stringify([settings.systemCard, faq.map((f) => [f.id, f.translations])]))
    .digest("hex")
    .slice(0, 12);
}

export function assembleCorpus(
  base: Corpus,
  settings: AiSettings,
  faq: FaqEntry[],
  config: AskConfig,
): AskCorpus {
  const documents = [...base.documents, ...assistantDocuments(settings, faq, config)];
  const core = renderCore(documents);
  return {
    key: `${base.key}|a:${revision(settings, faq)}`,
    documents,
    projects: base.projects,
    posts: base.posts,
    byId: new Map(documents.map((d) => [d.id, d])),
    core,
    compact: renderCompact(documents),
    coreTokens: countTokens(core),
    search: new CorpusSearch(documents),
  };
}

let memo: { key: string; corpus: AskCorpus } | undefined;

export async function getAskCorpus(config: AskConfig = getAskConfig()): Promise<AskCorpus> {
  const [base, { settings, faq }] = await Promise.all([getCorpus(), assistantState()]);
  const key = `${base.key}|a:${revision(settings, faq)}`;
  if (memo?.key !== key) memo = { key, corpus: assembleCorpus(base, settings, faq, config) };
  return memo.corpus;
}

/** The playground's corpus: the draft content with the same assistant documents. */
export async function getDraftAskCorpus(config: AskConfig = getAskConfig()): Promise<AskCorpus> {
  const [base, { settings, faq }] = await Promise.all([getDraftCorpus(), assistantState()]);
  return assembleCorpus(base, settings, faq, config);
}

/** `project:atlas`, `project:atlas@de` or a full id → the document, this locale first. */
export function resolveDocument(
  corpus: Pick<AskCorpus, "byId">,
  raw: string,
  locale: Locale,
): CorpusDocument | undefined {
  const id = raw.trim().replace(/^\[\^?|\]$/g, "");
  const direct = corpus.byId.get(id);
  if (direct) return direct;
  const base = id.replace(/@(en|de)$/, "");
  return (
    corpus.byId.get(`${base}@${locale}`) ??
    corpus.byId.get(`${base}@${locale === "en" ? "de" : "en"}`)
  );
}

/** Tests only. */
export function resetAskCorpusMemo(): void {
  memo = undefined;
}
