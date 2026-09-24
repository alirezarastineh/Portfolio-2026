import { tool } from "ai";
import { z } from "zod";

import type { Locale } from "../content/schema.js";
import type { CorpusKind } from "./corpus/build.js";
import { resolveDocument, type AskCorpus } from "./corpus/index.js";

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

const SECTIONS = ["projects", "experience", "skills", "writing", "about", "contact"] as const;
const DOCUMENT_CHARS = 12_000;
const RESUME_CHARS = 12_000;

const kindSchema = z.enum([
  "profile",
  "experience",
  "project",
  "post",
  "skills",
  "cv",
  "faq",
  "system-card",
]) satisfies z.ZodType<CorpusKind>;

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

export function buildTools(corpus: AskCorpus, locale: Locale) {
  return {
    search_portfolio: tool({
      description:
        "Search the published portfolio (projects, posts, experience, CV, FAQ). Returns document ids, titles, URLs and a snippet. Use it when the answer is not clearly in the documents already provided.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(200)
          .describe("Keywords, e.g. 'RAG evaluation' or 'Kubernetes'"),
        kinds: z.array(kindSchema).max(8).optional().describe("Restrict to these document kinds"),
      }),
      execute: async ({ query, kinds }) => {
        const hits = corpus.search.search(query, { locale, ...(kinds ? { kinds } : {}) });
        return hits.length ? { results: hits } : { results: [], note: "No matching documents." };
      },
    }),

    get_document: tool({
      description:
        "The full text of one portfolio document by id (e.g. 'project:atlas@en', 'cv@en', 'post:my-post@de'). Use it for documents shown cut short.",
      inputSchema: z.object({ id: z.string().min(1).max(160) }),
      execute: async ({ id }) => {
        const doc = resolveDocument(corpus, id, locale);
        if (!doc) return { error: "not_found", note: "No document has this id." };
        const text =
          doc.text.length > DOCUMENT_CHARS ? `${doc.text.slice(0, DOCUMENT_CHARS)}…` : doc.text;
        return { id: doc.id, title: doc.title, url: doc.url, text };
      },
    }),

    list_projects: tool({
      description:
        "Projects as structured data (name, role, period, category, stack, tags, metrics, URL), optionally filtered — for questions like 'which projects used RAG?'.",
      inputSchema: z.object({
        text: z
          .string()
          .max(120)
          .optional()
          .describe("Matches name, descriptor, stack, tags or category"),
      }),
      execute: async ({ text }) => {
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
      description: "The CV's text and its download link.",
      inputSchema: z.object({ locale: z.enum(["en", "de"]).optional() }),
      execute: async (input) => {
        const wanted = input.locale ?? locale;
        const doc =
          corpus.byId.get(`cv@${wanted}`) ?? corpus.byId.get(`cv@${wanted === "en" ? "de" : "en"}`);
        if (!doc) return { available: false, note: "No CV is published." };
        const text =
          doc.text.length > RESUME_CHARS ? `${doc.text.slice(0, RESUME_CHARS)}…` : doc.text;
        return { available: true, id: doc.id, download: `/${doc.locale}/resume.pdf`, text };
      },
    }),

    navigate: tool({
      description:
        "Open a page of this site for the visitor: '/en', '/en#projects', '/en/work/<slug>', '/en/writing/<slug>'. Only when the visitor asks to open or go somewhere.",
      inputSchema: z.object({ to: z.string().min(2).max(160) }),
      execute: async ({ to }) => {
        const path = allowedPath(corpus, to);
        return path
          ? { ok: true as const, to: path }
          : { ok: false as const, error: "not_allowed" };
      },
    }),

    suggest_followups: tool({
      description:
        "Offer the visitor 2-3 short follow-up questions, shown as buttons. Call it together with your answer, never alone.",
      inputSchema: z.object({ items: z.array(z.string().min(2).max(90)).min(1).max(3) }),
      execute: async () => ({ ok: true as const }),
    }),

    handoff_contact: tool({
      description:
        "Offer to hand the conversation to the contact form, pre-filled with a short summary. Only when the visitor wants to hire, contact or work with Alireza. The visitor confirms first; nothing is sent.",
      inputSchema: z.object({ summary: z.string().min(10).max(800) }),
      execute: async () => ({ ok: true as const, awaitingConfirmation: true }),
    }),
  };
}

export type AskTools = ReturnType<typeof buildTools>;
