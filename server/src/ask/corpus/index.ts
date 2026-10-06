import { createHash } from "node:crypto";

import { LOCALES, type Locale } from "../../content/schema.js";
import { imageMarker } from "../../content/sanitize.js";
import { getAskConfig, type AskConfig } from "../config.js";
import { assistantState, type AiSettings, type FaqEntry } from "../settings.js";
import { countTokens } from "../tokens.js";
import { assistantDocuments } from "./assistant-docs.js";
import { getCorpus, getDraftCorpus, type Corpus, type CorpusDocument } from "./build.js";
import { imageDescriptions, NO_DESCRIPTIONS, type ImageDescriptions } from "./media.js";
import { relate } from "./related.js";
import { applyTiers, renderCompact, renderCore, type CoreLayout } from "./render.js";
import { CorpusSearch } from "./search.js";

/**
 * What the assistant knows for one question: the published corpus plus its
 * own FAQ and system card, rendered as the byte-stable prefix it holds in
 * context (the core, one per reading locale: corpus/render.ts), a much
 * shorter version for models without tools, and a search index. Memoised by
 * key, so between publishes and admin edits every question in a language
 * reuses the same bytes — which is what Gemini's implicit cache needs.
 */

export interface AskCorpus extends Omit<Corpus, "text"> {
  byId: Map<string, CorpusDocument>;
  /** The prefix per reading locale: its documents, the other language's as handles. */
  core: Record<Locale, string>;
  /** For answer-only models (small context, no tools), per reading locale. */
  compact: Record<Locale, string>;
  coreTokens: Record<Locale, number>;
  /** `"locale"`; `"both"` only for a pairwise eval's Part C side. */
  layout: CoreLayout;
  search: CorpusSearch;
}

export { renderCompact, renderCore } from "./render.js";

/** The cores, compact corpora and their sizes for both reading locales. */
export function renderCorpus(
  documents: readonly CorpusDocument[],
  layout: CoreLayout = "locale",
): Pick<AskCorpus, "core" | "compact" | "coreTokens" | "layout"> {
  const core = Object.fromEntries(
    LOCALES.map((l) => [l, renderCore(documents, l, layout)]),
  ) as Record<Locale, string>;
  return {
    core,
    compact: Object.fromEntries(
      LOCALES.map((l) => [l, renderCompact(documents, l, layout)]),
    ) as Record<Locale, string>,
    coreTokens: Object.fromEntries(LOCALES.map((l) => [l, countTokens(core[l])])) as Record<
      Locale,
      number
    >,
    layout,
  };
}

/** The larger of the two cores: what the admin's single figure and a snapshot row show. */
export function largestCore(corpus: Pick<AskCorpus, "core" | "coreTokens">): {
  chars: number;
  tokens: number;
} {
  return {
    chars: Math.max(...LOCALES.map((l) => corpus.core[l].length)),
    tokens: Math.max(...LOCALES.map((l) => corpus.coreTokens[l])),
  };
}

/** The descriptions of the pictures the corpus shows, in a fixed order, for its key. */
function shownDescriptions(base: Corpus, descriptions: ImageDescriptions): unknown[] {
  const shown = new Set(base.documents.flatMap((d) => (d.images ?? []).map((i) => i.file)));
  return [...descriptions]
    .filter(([file]) => shown.has(file))
    .sort(([a], [b]) => a.localeCompare(b));
}

function revision(
  base: Corpus,
  settings: AiSettings,
  faq: FaqEntry[],
  descriptions: ImageDescriptions,
  documents: readonly CorpusDocument[],
): string {
  const parts: unknown[] = [
    settings.systemCard,
    faq.map((f) => [f.id, f.translations]),
    settings.corpusTiers,
  ];
  // Only when there are any, so a corpus without descriptions keeps its key.
  const described = shownDescriptions(base, descriptions);
  if (described.length) parts.push(described);
  // The related links (plan phase 19): a change to the rules that pick them is a new corpus.
  const links = documents.flatMap((d) => (d.related ? [[d.id, d.related]] : []));
  if (links.length) parts.push(links);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
}

/**
 * The document with each described picture's description after its marker
 * (plan phase 17): the reading language's, else the other's. The markers
 * stand in the order of `images`, so two pictures with the same alt are told
 * apart by their order.
 */
export function describeImages(d: CorpusDocument, descriptions: ImageDescriptions): CorpusDocument {
  if (!d.images?.length || !descriptions.size) return d;
  const other = d.locale === "en" ? "de" : "en";
  let text = d.text;
  let from = 0;
  for (const image of d.images) {
    const marker = imageMarker(image.alt);
    const at = text.indexOf(marker, from);
    if (at < 0) continue;
    from = at + marker.length;
    const own = descriptions.get(image.file);
    const description = (own?.[d.locale] ?? own?.[other])
      ?.replaceAll("[", "(")
      .replaceAll("]", ")");
    if (!description) continue;
    const added = `\n[image description: ${description}]`;
    text = `${text.slice(0, from)}${added}${text.slice(from)}`;
    from += added.length;
  }
  return text === d.text ? d : { ...d, text };
}

export function assembleCorpus(
  base: Corpus,
  settings: AiSettings,
  faq: FaqEntry[],
  config: AskConfig,
  descriptions: ImageDescriptions = NO_DESCRIPTIONS,
): AskCorpus {
  const documents = applyTiers(
    relate(
      [
        ...base.documents.map((d) => describeImages(d, descriptions)),
        ...assistantDocuments(settings, faq, config),
      ],
      base.projects,
    ),
    settings.corpusTiers,
  );
  return {
    key: `${base.key}|a:${revision(base, settings, faq, descriptions, documents)}`,
    documents,
    projects: base.projects,
    posts: base.posts,
    byId: new Map(documents.map((d) => [d.id, d])),
    ...renderCorpus(documents),
    search: new CorpusSearch(documents),
  };
}

/**
 * The same corpus laid out another way, for a pairwise eval's side (Part C's
 * single core: `--compare-core`). Its key says so, so no memo mixes the two.
 */
export function withLayout(corpus: AskCorpus, layout: CoreLayout): AskCorpus {
  if (layout === corpus.layout) return corpus;
  let laid = layouts.get(corpus);
  if (!laid) {
    laid = { ...corpus, key: `${corpus.key}|${layout}`, ...renderCorpus(corpus.documents, layout) };
    layouts.set(corpus, laid);
  }
  return laid;
}

/** Each corpus's other layout, rendered once (a pairwise run asks for it per case). */
const layouts = new WeakMap<AskCorpus, AskCorpus>();

let memo: { key: string; corpus: AskCorpus } | undefined;

export async function getAskCorpus(config: AskConfig = getAskConfig()): Promise<AskCorpus> {
  const [base, { settings, faq }, descriptions] = await Promise.all([
    getCorpus(),
    assistantState(),
    imageDescriptions(),
  ]);
  // What the corpus is assembled from; its own key adds the links the rules pick from it,
  // and the rules cannot change while the process runs.
  const inputs = `${base.key}|a:${revision(base, settings, faq, descriptions, [])}`;
  if (memo?.key !== inputs) {
    memo = { key: inputs, corpus: assembleCorpus(base, settings, faq, config, descriptions) };
  }
  return memo.corpus;
}

/** The playground's corpus: the draft content with the same assistant documents. */
export async function getDraftAskCorpus(config: AskConfig = getAskConfig()): Promise<AskCorpus> {
  const [base, { settings, faq }, descriptions] = await Promise.all([
    getDraftCorpus(),
    assistantState(),
    imageDescriptions(),
  ]);
  return assembleCorpus(base, settings, faq, config, descriptions);
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
