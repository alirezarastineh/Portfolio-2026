import { z } from "zod";

import type { CorpusKind } from "./corpus/build.js";
import type { ToolName } from "./tools.js";

/**
 * What the tools tell the model (plan phase 21): each tool's description,
 * which states its input and the exact shape of what it returns, its input
 * schema, and the fixed notes its results carry. The book's measure: precise
 * descriptions raised first-attempt tool success from 71 % to 94 %. All of it
 * is prompt, so `PROMPT_HASH` covers it (`toolDefinitionsText`, prompt.ts):
 * a changed word wants a new recorded eval run, as the system prompt's does.
 * No imports beyond zod and types: prompt.ts reads this file when it loads.
 */

/** Documents (the CV among them) one answer may fetch. */
export const DOCUMENT_CALLS = 4;
/** Characters those fetches may return in all: the last one is cut to what is left. */
export const DOCUMENT_CHARS = 40_000;
/** Where one fetched document or CV is cut. */
export const FETCH_CLIP = 12_000;

const thousands = (n: number) => n.toLocaleString("en-US");

/** The notes a result carries: fixed texts the model reads. */
export const NOTES = {
  noHits: "No matching documents.",
  notFound: "No document has this id.",
  noCv: "No CV is published.",
  /** A repeated call: the model has the result already. */
  alreadyProvided: "Already provided earlier in this answer: use that result.",
  /** A fetch once the envelope is used up: no document, or no character, is left. */
  budgetSpent: `This answer's document budget is spent (${DOCUMENT_CALLS} documents or ${thousands(DOCUMENT_CHARS)} characters): answer with what you have.`,
} as const;

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

const CUT = `cut at ${thousands(FETCH_CLIP)} characters, or at what is left of this answer's ${thousands(DOCUMENT_CHARS)}, ending in '…'`;
const ENVELOPE = `{error: "budget_exhausted", note} once this answer has read ${DOCUMENT_CALLS} documents or ${thousands(DOCUMENT_CHARS)} characters: then answer with what you have`;

export const TOOL_DEFS = {
  search_portfolio: {
    description: `Search the published portfolio (profile, projects, posts, experience, skills, CV, FAQ, how this assistant works) by keywords, the answer's language first. Returns {results: [{id, title, url, snippet, related?}], semantic?}, best first (semantic: true when it matched by meaning as well as by words); {results: [], note} when nothing matches; {duplicate: true, note} for a search already run in this answer: use that earlier result. Use it when the answer is not clearly in the documents already provided.`,
    inputSchema: z.object({
      query: z.string().min(1).max(200).describe("Keywords, e.g. 'RAG evaluation' or 'Kubernetes'"),
      kinds: z.array(kindSchema).max(8).optional().describe("Restrict to these document kinds"),
    }),
  },
  get_document: {
    description: `The full text of one portfolio document by its id, exactly as a document header or a search result gives it (e.g. 'project:atlas@en', 'cv@en', 'post:my-post@de'). Use it for documents shown cut short, and for the other language's versions, which are listed by id only. Returns {id, title, url, text} (text ${CUT}); {error: "not_found", note} for an unknown id; {id, duplicate: true, note} for a document already read in this answer: use that text; ${ENVELOPE}.`,
    inputSchema: z.object({ id: z.string().min(1).max(160) }),
  },
  list_projects: {
    description:
      "Projects as structured data, optionally filtered, for questions like 'which projects used RAG?'. Returns {projects: [{id, slug, locale, name, descriptor, role, period, category, stack, tags, metrics, url, hasCaseStudy}]} in the answer's language (in both, when it has none); an empty list when none matches.",
    inputSchema: z.object({
      text: z
        .string()
        .max(120)
        .optional()
        .describe("Matches name, descriptor, stack, tags or category"),
    }),
  },
  get_resume: {
    description: `The CV's text and its download link, in the language asked for (the answer's by default), else the other. Returns {available: true, id, download, text} (text ${CUT}); {available: false, note} when no CV is published. The CV counts as a document: {id, duplicate: true, note} when it was already read in this answer; ${ENVELOPE}.`,
    inputSchema: z.object({ locale: z.enum(["en", "de"]).optional() }),
  },
  navigate: {
    description:
      "Open a page of this site for the visitor, only when they ask to open or go somewhere. Input, the whole path: '/en'; a section of the home page ('/en#projects', '/en#experience', '/en#skills', '/en#writing', '/en#about', '/en#contact'); '/en/writing' (every post); '/en/writing/<slug>' (a post); '/en/work/<slug>' (a case study); '/en/legal/imprint' or '/en/legal/privacy'; each also under '/de'. Returns {ok: true, to} as the page opens, or {ok: false, error: \"not_allowed\"} for any other path or a page that is not published.",
    inputSchema: z.object({ to: z.string().min(2).max(160) }),
  },
  suggest_followups: {
    description:
      "Offer the visitor 2-3 short follow-up questions, shown as buttons. Call it together with your answer, never alone. Input: the questions, at most 90 characters each. Returns {ok: true}.",
    inputSchema: z.object({ items: z.array(z.string().min(2).max(90)).min(1).max(3) }),
  },
  handoff_contact: {
    description:
      "Offer to hand the conversation to the contact form, pre-filled with a short summary in the visitor's language. Only when the visitor wants to hire, contact or work with Alireza. Returns {ok: true, awaitingConfirmation: true}: the visitor confirms first; nothing is sent.",
    inputSchema: z.object({ summary: z.string().min(10).max(800) }),
  },
} satisfies Record<ToolName, { description: string; inputSchema: z.ZodType }>;

/**
 * The tools as the model reads them, for `PROMPT_HASH`: each name, its
 * description and its input as JSON Schema (draft 7 from the input's side, as
 * the SDK converts it, less the `additionalProperties: false` the SDK adds),
 * and the notes. Deterministic: the same definitions give the same text.
 */
export function toolDefinitionsText(): string {
  return JSON.stringify({
    tools: Object.entries(TOOL_DEFS).map(([name, def]) => ({
      name,
      description: def.description,
      input: z.toJSONSchema(def.inputSchema, { target: "draft-7", io: "input" }),
    })),
    notes: NOTES,
  });
}
