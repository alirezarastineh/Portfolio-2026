import { tool } from "ai";

import type { Locale } from "../content/schema.js";
import type { AskConfig } from "./config.js";
import { resolveDocument, type AskCorpus } from "./corpus/index.js";
import { hybridSearch } from "./embeddings.js";
import type { ModelCall } from "./models/fallback.js";
import { ToolBudget } from "./tool-budget.js";
import { NOTES, TOOL_DEFS } from "./tool-defs.js";

/**
 * The agent's tools. Every one reads; none can change anything. The three the
 * terminal acts on (`navigate`, `suggest_followups`, `handoff_contact`) only
 * validate here and return an acknowledgement: the browser sees the call in
 * the stream and does the rest — the hand-off only after the visitor confirms.
 */

export const TOOL_NAMES = [
  "search_portfolio",
  "get_document",
  "list_projects",
  "get_resume",
  "navigate",
  "suggest_followups",
  "handoff_contact",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** How a tool call ended, for the answer's trace (plan phase 21 adds the last two). */
export type ToolOutcome =
  "ok" | "not_found" | "not_allowed" | "no_hits" | "error" | "duplicate" | "budget_exhausted";

/**
 * Reads a tool's result by the shapes the tools below return: a missing
 * document or CV is not_found, a refused page not_allowed, an empty search or
 * project list no_hits, a repeated call duplicate, a fetch past the answer's
 * envelope budget_exhausted. A tool that throws never gets here: the stream
 * carries a `tool-error` for it instead.
 */
export function toolOutcome(output: unknown): ToolOutcome {
  if (!output || typeof output !== "object") return "ok";
  const result = output as Record<string, unknown>;
  if (result["duplicate"] === true) return "duplicate";
  if (result["error"] === "budget_exhausted") return "budget_exhausted";
  if (result["error"] === "not_found" || result["available"] === false) return "not_found";
  if (result["error"] === "not_allowed") return "not_allowed";
  if (typeof result["error"] === "string") return "error";
  const list = [result["results"], result["projects"]].find(Array.isArray);
  return list?.length === 0 ? "no_hits" : "ok";
}

/** Edits between two names (Levenshtein), for the tool-name repair below. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length]!;
}

/**
 * The one tool a misspelt name can only mean, or null. A model sometimes
 * stutters a name ("suggest_suggest_followups", seen in production and in an
 * eval run), and an unknown tool fails the whole answer: a name that contains
 * exactly one tool's name, or is within two edits of exactly one, is that
 * tool. Anything less certain fails as before.
 */
export function repairToolName(name: string, known: readonly string[]): string | null {
  if (known.includes(name)) return name;
  const containing = known.filter((k) => name.includes(k));
  if (containing.length === 1) return containing[0]!;
  const near = known.filter((k) => distance(name, k) <= 2);
  return near.length === 1 ? near[0]! : null;
}

/** What a search returned, for the trace (plan phase 18): its documents, and whether by meaning too. */
export function searchResult(output: unknown): { hits: string[]; semantic: boolean } | null {
  if (!output || typeof output !== "object") return null;
  const result = output as { results?: unknown; semantic?: unknown };
  if (!Array.isArray(result.results)) return null;
  const hits = result.results
    .map((r) => (r && typeof r === "object" ? (r as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string")
    .slice(0, 6);
  return { hits, semantic: result.semantic === true };
}

const SECTIONS = ["projects", "experience", "skills", "writing", "about", "contact"] as const;

/** Internal pages the terminal may open: home, its sections, and existing pages. */
export function allowedPath(
  corpus: Pick<AskCorpus, "projects" | "posts">,
  raw: string,
): string | null {
  const path = raw.trim();
  const match = /^\/(en|de)(\/[a-z0-9/_-]*)?(#[a-z-]+)?$/i.exec(path);
  if (!match) return null;
  const locale = match[1]!.toLowerCase() as Locale;
  const rest = (match[2] ?? "").replace(/\/$/, "");
  const fragment = match[3]?.slice(1);

  if (!rest) {
    if (!fragment) return `/${locale}`;
    return (SECTIONS as readonly string[]).includes(fragment) ? `/${locale}#${fragment}` : null;
  }
  if (fragment) return null;
  if (rest === "/writing") return `/${locale}/writing`;
  if (rest === "/legal/imprint" || rest === "/legal/privacy") return `/${locale}${rest}`;

  const work = /^\/work\/([a-z0-9-]+)$/.exec(rest);
  if (work) {
    const ok = corpus.projects.some(
      (p) => p.locale === locale && p.slug === work[1] && p.hasCaseStudy,
    );
    return ok ? `/${locale}/work/${work[1]}` : null;
  }
  const post = /^\/writing\/([a-z0-9-]+)$/.exec(rest);
  if (post) {
    const ok = corpus.posts.some((p) => p.locale === locale && p.slug === post[1]);
    return ok ? `/${locale}/writing/${post[1]}` : null;
  }
  return null;
}

/**
 * The tools for one answer, reading in `locale` (the answer's language).
 * With `search.config`, the search is hybrid when the deploy and the admin
 * turned embeddings on (embeddings.ts). Its spend joins `search.calls` (the
 * answer's), and is written as the `embeddings` feature unless `search.record`
 * is false (evals, whose runs record their own spend; the CLI none).
 *
 * Built per answer, so its `ToolBudget` is the answer's (plan phase 21): a
 * repeated search or document returns "already provided", and the documents
 * past the envelope `budget_exhausted`, before any work is done.
 */
export function buildTools(
  corpus: AskCorpus,
  locale: Locale,
  search: { config?: AskConfig; record?: boolean; calls?: ModelCall[] } = {},
) {
  const budget = new ToolBudget();
  /** A document's text through the envelope: read once, cut where the budget says. */
  const readOnce = (id: string, text: string) => {
    if (budget.hasRead(id)) return { id, duplicate: true as const, note: NOTES.alreadyProvided };
    const chars = budget.take(id, text.length);
    if (chars === null) return { error: "budget_exhausted" as const, note: NOTES.budgetSpent };
    return { text: chars < text.length ? `${text.slice(0, chars)}…` : text };
  };

  return {
    search_portfolio: tool({
      ...TOOL_DEFS.search_portfolio,
      execute: async ({ query, kinds }) => {
        // Before the search runs: two identical calls in one step get one result.
        if (!budget.firstSearch(query, kinds)) {
          return { duplicate: true as const, note: NOTES.alreadyProvided };
        }
        const { hits, semantic } = search.config
          ? await hybridSearch(corpus, query, {
              config: search.config,
              reading: locale,
              ...(kinds ? { kinds } : {}),
              spend: { record: search.record ?? true, calls: search.calls },
            })
          : {
              hits: corpus.search.search(query, { locale, ...(kinds ? { kinds } : {}) }),
              semantic: false,
            };
        if (!hits.length) return { results: [], note: NOTES.noHits };
        // `semantic` only when the embeddings took part: BM25's result reads as before.
        return semantic ? { results: hits, semantic } : { results: hits };
      },
    }),

    get_document: tool({
      ...TOOL_DEFS.get_document,
      execute: ({ id }) => {
        const doc = resolveDocument(corpus, id, locale);
        if (!doc) return { error: "not_found" as const, note: NOTES.notFound };
        const read = readOnce(doc.id, doc.text);
        return "text" in read
          ? { id: doc.id, title: doc.title, url: doc.url, text: read.text }
          : read;
      },
    }),

    list_projects: tool({
      ...TOOL_DEFS.list_projects,
      execute: ({ text }) => {
        const needle = text?.trim().toLowerCase();
        const mine = corpus.projects.filter((p) => p.locale === locale);
        const pool = mine.length ? mine : corpus.projects;
        const projects = pool.filter(
          (p) =>
            !needle ||
            [p.name, p.descriptor, p.category ?? "", ...p.stack, ...p.tags]
              .join(" ")
              .toLowerCase()
              .includes(needle),
        );
        return { projects };
      },
    }),

    get_resume: tool({
      ...TOOL_DEFS.get_resume,
      execute: (input) => {
        const wanted = input.locale ?? locale;
        const doc =
          corpus.byId.get(`cv@${wanted}`) ?? corpus.byId.get(`cv@${wanted === "en" ? "de" : "en"}`);
        if (!doc) return { available: false as const, note: NOTES.noCv };
        // The CV is a document: `get_document("cv@en")` after it is a repeat, and the reverse.
        const read = readOnce(doc.id, doc.text);
        if (!("text" in read)) return read;
        const download = `/${doc.locale}/resume.pdf`;
        return { available: true as const, id: doc.id, download, text: read.text };
      },
    }),

    navigate: tool({
      ...TOOL_DEFS.navigate,
      execute: ({ to }) => {
        const path = allowedPath(corpus, to);
        return path
          ? { ok: true as const, to: path }
          : { ok: false as const, error: "not_allowed" };
      },
    }),

    suggest_followups: tool({
      ...TOOL_DEFS.suggest_followups,
      execute: () => ({ ok: true as const }),
    }),

    handoff_contact: tool({
      ...TOOL_DEFS.handoff_contact,
      execute: () => ({ ok: true as const, awaitingConfirmation: true }),
    }),
  };
}

export type AskTools = ReturnType<typeof buildTools>;
