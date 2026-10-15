import { z } from "zod";

import type { Locale } from "../../content/schema.js";
import type { CorpusKind } from "../corpus/build.js";
import { resolveDocument, type AskCorpus } from "../corpus/index.js";

/**
 * The MCP endpoint's tools (plan phase 32): the assistant's four reads, for an
 * agent outside, over the same published corpus its answers cite. Words only
 * (BM25): search by meaning would embed the query, a paid call. No model,
 * nothing written. The descriptions are this module's, written for an agent
 * that has never seen the site; the assistant's own (`tool-defs.ts`) belong to
 * its prompt and stay as they are.
 */

export const MCP_TOOL_NAMES = [
  "search_portfolio",
  "get_document",
  "list_projects",
  "get_resume",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

const KINDS = [
  "profile",
  "experience",
  "project",
  "post",
  "skills",
  "cv",
  "faq",
  "system-card",
] as const satisfies readonly CorpusKind[];

/** A document past this many characters is cut, and says so. */
export const DOCUMENT_CHARS = 40_000;

const locale = z
  .enum(["en", "de"])
  .optional()
  .describe(
    "The reading language: en (the default) or de. A document only in the other language is still found.",
  );

const INPUTS = {
  search_portfolio: z.strictObject({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Words to look for, e.g. "pgvector", "remote work" or "Atlas".'),
    kinds: z
      .array(z.enum(KINDS))
      .min(1)
      .max(KINDS.length)
      .optional()
      .describe("Only documents of these kinds."),
    locale,
  }),
  get_document: z.strictObject({
    id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        "A document id from search_portfolio or list_projects, e.g. project:atlas@en. Without its @language suffix (project:atlas) it is read in the reading language.",
      ),
    locale,
  }),
  list_projects: z.strictObject({
    text: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe("Only projects whose name, descriptor, category, stack or tags contain this."),
    locale,
  }),
  get_resume: z.strictObject({ locale }),
} as const;

const DESCRIPTIONS: Record<McpToolName, { title: string; description: string }> = {
  search_portfolio: {
    title: "Search the portfolio",
    description:
      "Searches the published portfolio (profile, experience, projects and their case studies, writing, skills, the CV, the FAQ) by words. Returns up to 6 hits, the best passage of each document: its id, title, absolute url and a snippet, with the ids of related documents. Read a whole document with get_document. Words only, no meaning: when nothing comes back, try other words or list_projects.",
  },
  get_document: {
    title: "Read a document",
    description: `Reads one document of the portfolio whole: a project's case study, a post, the profile, experience, skills, the CV, an FAQ entry. Takes an id from search_portfolio or list_projects. Returns its id, title, absolute url, language and text; a text past ${DOCUMENT_CHARS.toLocaleString("en")} characters is cut and marked so.`,
  },
  list_projects: {
    title: "List the projects",
    description:
      "Lists the portfolio's projects with their facts: name, descriptor, role, period, category, stack, tags, metrics, absolute url, whether it has a case study, and the id get_document reads. Optionally only those whose facts contain a word.",
  },
  get_resume: {
    title: "Get the CV",
    description:
      "Gets the CV: its text and an absolute link to the PDF, in the reading language (the other one when it is missing). Says so when there is none.",
  },
};

/** What `tools/list` lists, in a fixed order. */
export function listTools() {
  return MCP_TOOL_NAMES.map((name) => ({
    name,
    ...DESCRIPTIONS[name],
    inputSchema: z.toJSONSchema(INPUTS[name], { io: "input" }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: true;
}

/** Structured content, and the same JSON as text for clients that read only text. */
const result = (structured: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(structured) }],
  structuredContent: structured,
});

/** A tool execution error: what went wrong, said so the calling model can correct it. */
const toolError = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  structuredContent: { error: message },
  isError: true,
});

/** A site path made absolute with the origin the content declares; as it was without one. */
function absolute(corpus: Pick<AskCorpus, "siteUrl">, url: string): string {
  return corpus.siteUrl && url.startsWith("/") ? `${corpus.siteUrl}${url}` : url;
}

function searchPortfolio(corpus: AskCorpus, args: unknown): ToolResult {
  const input = INPUTS.search_portfolio.parse(args);
  const hits = corpus.search.search(input.query, {
    locale: input.locale ?? "en",
    ...(input.kinds ? { kinds: [...input.kinds] } : {}),
  });
  const results = hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    url: absolute(corpus, hit.url),
    snippet: hit.snippet,
    ...(hit.related?.length ? { related: hit.related } : {}),
  }));
  return result(
    results.length
      ? { results }
      : { results, note: "No document matched those words: try others, or list_projects." },
  );
}

function getDocument(corpus: AskCorpus, args: unknown): ToolResult {
  const input = INPUTS.get_document.parse(args);
  const doc = resolveDocument(corpus, input.id, input.locale ?? "en");
  if (!doc) {
    return toolError(
      `No document has the id "${input.id}". search_portfolio returns ids; list_projects lists the projects' ids.`,
    );
  }
  const cut = doc.text.length > DOCUMENT_CHARS;
  return result({
    id: doc.id,
    title: doc.title,
    url: absolute(corpus, doc.url),
    locale: doc.locale,
    text: cut ? `${doc.text.slice(0, DOCUMENT_CHARS)}…` : doc.text,
    ...(cut ? { truncated: true } : {}),
  });
}

function listProjects(corpus: AskCorpus, args: unknown): ToolResult {
  const input = INPUTS.list_projects.parse(args);
  const reading: Locale = input.locale ?? "en";
  const needle = input.text?.toLowerCase();
  const mine = corpus.projects.filter((p) => p.locale === reading);
  const projects = (mine.length ? mine : corpus.projects)
    .filter(
      (p) =>
        !needle ||
        [p.name, p.descriptor, p.category ?? "", ...p.stack, ...p.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    )
    .map((p) => ({ ...p, url: absolute(corpus, p.url) }));
  return result({ projects });
}

function getResume(corpus: AskCorpus, args: unknown): ToolResult {
  const input = INPUTS.get_resume.parse(args);
  const wanted: Locale = input.locale ?? "en";
  const doc =
    corpus.byId.get(`cv@${wanted}`) ?? corpus.byId.get(`cv@${wanted === "en" ? "de" : "en"}`);
  if (!doc) return result({ available: false, note: "The portfolio publishes no CV." });
  return result({
    available: true,
    id: doc.id,
    locale: doc.locale,
    download: absolute(corpus, `/${doc.locale}/resume.pdf`),
    text: doc.text,
  });
}

function run(corpus: AskCorpus, name: McpToolName, args: unknown): ToolResult {
  switch (name) {
    case "search_portfolio":
      return searchPortfolio(corpus, args);
    case "get_document":
      return getDocument(corpus, args);
    case "list_projects":
      return listProjects(corpus, args);
    case "get_resume":
      return getResume(corpus, args);
  }
}

const isToolName = (name: unknown): name is McpToolName =>
  typeof name === "string" && (MCP_TOOL_NAMES as readonly string[]).includes(name);

/**
 * Runs a tool; null for a name that is not one (a protocol error, the
 * caller's). Arguments that do not fit come back as a tool execution error
 * naming what to fix, so the calling model can correct them.
 */
export function callTool(corpus: AskCorpus, name: unknown, args: unknown): ToolResult | null {
  if (!isToolName(name)) return null;
  const parsed = INPUTS[name].safeParse(args ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
      .join("; ");
    return toolError(`Invalid arguments for ${name}: ${problems}.`);
  }
  return run(corpus, name, parsed.data);
}
