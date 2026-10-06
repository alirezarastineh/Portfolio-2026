import type { Locale } from "../../content/schema.js";
import type { CorpusDocument, CorpusKind } from "./build.js";

/**
 * How the corpus sits in the prompt (plan phase 16, Context Triage). The
 * assistant reads one language per answer, the one it answers in, so each
 * reading locale gets its own core:
 *
 * - resident (P1): every document in that language, every document with no
 *   version in it, and the other language's version wherever this one is an
 *   incomplete translation of it ("when in doubt, promote");
 * - handles (P3): the other language's complete translations, one line each,
 *   one `get_document` away.
 *
 * Nothing is dropped: every document is resident or a handle. The order puts
 * the profile first and the FAQ and the system card last, next to the
 * question; a document the admin promoted (perception.ts) moves to the front,
 * whole. The same documents always give the same bytes, which is what the
 * provider's prefix cache needs. Pure: `prompt.ts` hashes the format.
 */

/** `"locale"`: a core per reading locale. `"both"`: one core with both languages (Part C's). */
export type CoreLayout = "locale" | "both";

/** Characters kept in the prefix per kind; the rest is one `get_document` away. */
export const CORE_LIMIT: Partial<Record<CorpusKind, number>> = {
  project: 2_400,
  post: 1_500,
  cv: 2_500,
};
/** A promoted document is held whole, up to what `get_document` returns. */
export const PROMOTED_CHARS = 12_000;
/** A translation shorter than this share of the other version is incomplete. */
export const COMPLETE_SHARE = 0.6;
const COMPACT_DOC_CHARS = 420;
const COMPACT_TOTAL_CHARS = 40_000;

const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

/** Before the handles: profile, promoted, then the long middle; after: FAQ and system card. */
const KIND_RANK: Record<CorpusKind, number> = {
  profile: 0,
  experience: 2,
  project: 3,
  post: 4,
  skills: 5,
  cv: 6,
  faq: 8,
  "system-card": 9,
};
const PROMOTED_RANK = 1;
const HANDLES_RANK = 7;

function rank(d: CorpusDocument): number {
  return d.tier === "promoted" && d.kind !== "profile" ? PROMOTED_RANK : KIND_RANK[d.kind];
}

/** The admin's tiers: document ids (plan phase 16, perception.ts suggests them). */
export interface CorpusTiers {
  promoted: string[];
  demoted: string[];
}

export const NO_TIERS: CorpusTiers = { promoted: [], demoted: [] };
/** Promoted documents are whole, so few: each may hold up to 12,000 characters. */
export const MAX_PROMOTED = 6;
export const MAX_DEMOTED = 30;

/** The documents with the applied tiers marked; an id no document has is ignored. */
export function applyTiers(
  documents: readonly CorpusDocument[],
  tiers: CorpusTiers,
): CorpusDocument[] {
  const promoted = new Set(tiers.promoted);
  const demoted = new Set(tiers.demoted);
  return documents.map((d) => {
    const marked: CorpusDocument = { ...d };
    delete marked.tier;
    if (promoted.has(d.id)) marked.tier = "promoted";
    else if (demoted.has(d.id)) marked.tier = "demoted";
    return marked;
  });
}

/** `project:atlas@de` → `project:atlas`: the document, whatever its language. */
export function baseId(id: string): string {
  return id.replace(/@(en|de)$/, "");
}

/**
 * A document's header. A core per language adds when it changed and what it
 * relates to (plan phase 19); Part C's layout (`both`) stays as it was.
 */
function header(d: CorpusDocument, layout: CoreLayout = "locale"): string {
  const lines = ["---", `id: ${d.id}`, `title: ${d.title}`, `url: ${d.url}`];
  if (layout === "locale") {
    if (d.updated) lines.push(`updated: ${d.updated}`);
    if (d.related?.length) lines.push(`related: ${d.related.join(", ")}`);
  }
  return [...lines, "---"].join("\n");
}

function clip(text: string, limit: number | undefined, id: string): string {
  if (!limit || text.length <= limit) return text;
  const cut = text.lastIndexOf("\n", limit);
  return `${text.slice(0, cut > limit / 2 ? cut : limit)}\n[… continues: get_document("${id}")]`;
}

/**
 * The characters of `d` the core holds: its kind's limit, the whole when
 * promoted, half when demoted. Part C's layout knew no tiers.
 */
export function coreLimit(d: CorpusDocument, layout: CoreLayout = "locale"): number | undefined {
  if (layout === "both") return CORE_LIMIT[d.kind];
  if (d.tier === "promoted") return PROMOTED_CHARS;
  const limit = CORE_LIMIT[d.kind];
  if (limit && d.tier === "demoted") return Math.floor(limit / 2);
  return limit;
}

/**
 * What a translation must keep: numbers (with the separators between digits
 * removed, so `40,000` is `40.000` and `1.4` is `1,4`), emails and links.
 */
export function facts(text: string): Set<string> {
  const found = new Set<string>();
  const joined = text.replaceAll(/(\d)[.,\u2019\u00a0\u202f'](?=\d)/g, "$1");
  for (const match of joined.matchAll(/\d+/g)) found.add(match[0]);
  for (const word of text.toLowerCase().split(/\s+/)) {
    const link = word.search(/https?:\/\//);
    const token = trimPunctuation(link >= 0 ? word.slice(link) : word.replace(/^[(<[{"']+/, ""));
    if (link >= 0 || EMAIL.test(token)) found.add(token);
  }
  return found;
}

const EMAIL = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;
const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">", '"', "'"]);

function trimPunctuation(word: string): string {
  let end = word.length;
  while (end > 0 && TRAILING.has(word[end - 1]!)) end--;
  return word.slice(0, end);
}

/** `version` does not say all `other` says: much shorter, or missing one of its facts. */
export function incompleteTranslation(version: CorpusDocument, other: CorpusDocument): boolean {
  if (version.text.length < COMPLETE_SHARE * other.text.length) return true;
  const kept = facts(version.text);
  for (const fact of facts(other.text)) if (!kept.has(fact)) return true;
  return false;
}

export interface CoreView {
  /** In the core with their text, in order. */
  resident: CorpusDocument[];
  /** In the core as one line each, in corpus order. */
  handles: CorpusDocument[];
}

/** Which documents the core for `reading` holds, and in what order. */
export function coreView(
  documents: readonly CorpusDocument[],
  reading: Locale,
  layout: CoreLayout = "locale",
): CoreView {
  if (layout === "both") return { resident: [...documents], handles: [] };

  const first = new Map<string, number>();
  const inReading = new Map<string, CorpusDocument>();
  documents.forEach((d, i) => {
    const base = baseId(d.id);
    if (!first.has(base)) first.set(base, i);
    if (d.locale === reading) inReading.set(base, d);
  });

  const resident: CorpusDocument[] = [];
  const handles: CorpusDocument[] = [];
  for (const d of documents) {
    const version = inReading.get(baseId(d.id));
    const keep =
      d.locale === reading ||
      !version ||
      d.tier === "promoted" ||
      incompleteTranslation(version, d);
    (keep ? resident : handles).push(d);
  }

  resident.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      first.get(baseId(a.id))! - first.get(baseId(b.id))! ||
      Number(a.locale !== reading) - Number(b.locale !== reading),
  );
  return { resident, handles };
}

function handleBlock(handles: readonly CorpusDocument[], reading: Locale): string {
  const other = reading === "en" ? "de" : "en";
  return [
    `## Also in ${LANGUAGE[other]}`,
    `These are the ${LANGUAGE[other]} versions of documents given here in ${LANGUAGE[reading]}, and they say the same. Fetch one with get_document only when its ${LANGUAGE[other]} wording or page is needed.`,
    ...handles.map((d) => {
      const updated = d.updated ? `, updated ${d.updated}` : "";
      return `- ${d.id}: ${d.title} (${d.url}${updated})`;
    }),
  ].join("\n");
}

/** The core for one reading locale: the prefix every answer in that language holds. */
export function renderCore(
  documents: readonly CorpusDocument[],
  reading: Locale,
  layout: CoreLayout = "locale",
): string {
  if (layout === "both") {
    // Part C's core, byte for byte: every document, kind limits only.
    return documents
      .map((d) => `${header(d, "both")}\n${clip(d.text, CORE_LIMIT[d.kind], d.id)}`)
      .join("\n\n");
  }
  const { resident, handles } = coreView(documents, reading, layout);
  const render = (d: CorpusDocument) => `${header(d)}\n${clip(d.text, coreLimit(d), d.id)}`;
  return [
    ...resident.filter((d) => rank(d) < HANDLES_RANK).map(render),
    ...(handles.length ? [handleBlock(handles, reading)] : []),
    ...resident.filter((d) => rank(d) > HANDLES_RANK).map(render),
  ].join("\n\n");
}

/** For answer-only models (small context, no tools): the resident documents, cut short. */
export function renderCompact(
  documents: readonly CorpusDocument[],
  reading: Locale,
  layout: CoreLayout = "locale",
): string {
  const parts: string[] = [];
  let total = 0;
  for (const d of coreView(documents, reading, layout).resident) {
    const body =
      d.text.length > COMPACT_DOC_CHARS ? `${d.text.slice(0, COMPACT_DOC_CHARS)}…` : d.text;
    const part = `[${d.id}] ${d.title} (${d.url})\n${body}`;
    if (total + part.length > COMPACT_TOTAL_CHARS) break;
    parts.push(part);
    total += part.length;
  }
  return parts.join("\n\n");
}

const sample = (d: CorpusDocument) => d;

/**
 * A small corpus with every kind and every placement rule: a clipped
 * project, a complete and an incomplete translation, a document in one
 * language only, a promoted one longer than `PROMOTED_CHARS` and a demoted
 * one longer than half its kind's limit, so every limit shows in the bytes.
 * `prompt.ts` hashes its rendering, so a change to the format needs a new
 * evaluated baseline.
 */
export const FORMAT_SAMPLE: readonly CorpusDocument[] = [
  sample({
    id: "profile@en",
    kind: "profile",
    locale: "en",
    title: "P",
    url: "/en",
    text: "Profile. 1 a@b.de",
    updated: "2026-10-01",
    related: ["faq:1@en"],
  }),
  sample({
    id: "experience:x@en",
    kind: "experience",
    locale: "en",
    title: "X",
    url: "/en#experience",
    text: "Experience, 2020 – 2024",
    related: ["project:short@en"],
  }),
  sample({
    id: "project:long@en",
    kind: "project",
    locale: "en",
    title: "Long",
    url: "/en/work/long",
    text: "Line of a long case study.\n".repeat(120),
  }),
  sample({
    id: "project:short@en",
    kind: "project",
    locale: "en",
    title: "Short",
    url: "/en#projects",
    text: "Short project, 38 % fewer escalations",
    updated: "2026-09-15",
    related: ["experience:x@en"],
  }),
  sample({
    id: "post:one@en",
    kind: "post",
    locale: "en",
    title: "One",
    url: "/en/writing/one",
    text: "Line of a long post.\n".repeat(620),
    tier: "promoted",
  }),
  sample({
    id: "project:cut@en",
    kind: "project",
    locale: "en",
    title: "Cut",
    url: "/en#projects",
    text: "Line of a case study.\n".repeat(140),
    tier: "demoted",
  }),
  sample({
    id: "skills@en",
    kind: "skills",
    locale: "en",
    title: "S",
    url: "/en#skills",
    text: "TypeScript",
  }),
  sample({
    id: "profile@de",
    kind: "profile",
    locale: "de",
    title: "P",
    url: "/de",
    text: "Profil. 1 a@b.de",
  }),
  sample({
    id: "project:long@de",
    kind: "project",
    locale: "de",
    title: "Lang",
    url: "/de/work/long",
    text: "Zeile einer langen Fallstudie.\n".repeat(110),
    // A handle in the English core: its line carries the date.
    updated: "2026-09-20",
  }),
  sample({
    id: "project:short@de",
    kind: "project",
    locale: "de",
    title: "Kurz",
    url: "/de#projects",
    text: "Kurz",
  }),
  sample({
    id: "post:nur-de@de",
    kind: "post",
    locale: "de",
    title: "Nur",
    url: "/de/writing/nur-de",
    text: "Nur auf Deutsch.",
  }),
  sample({
    id: "cv@en",
    kind: "cv",
    locale: "en",
    title: "CV (en)",
    url: "/media/cv.pdf",
    text: "CV",
  }),
  sample({
    id: "faq:1@en",
    kind: "faq",
    locale: "en",
    title: "Q?",
    url: "/en#about",
    text: "Q: Q?\nA: A.",
    updated: "2026-09-01",
    related: ["profile@en"],
  }),
  sample({
    id: "faq:1@de",
    kind: "faq",
    locale: "de",
    title: "F?",
    url: "/de#about",
    text: "Q: F?\nA: A.",
  }),
  sample({
    id: "system-card@en",
    kind: "system-card",
    locale: "en",
    title: "How",
    url: "/en#about",
    text: "Card",
  }),
  sample({
    id: "system-card@de",
    kind: "system-card",
    locale: "de",
    title: "Wie",
    url: "/de#about",
    text: "Karte",
  }),
];
