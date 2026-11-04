import { declareExperimentalWebMcpTool, type Injector } from "@angular/core";
import { Router } from "@angular/router";

import type { Locale } from "../content/locale";
import { LanguageService } from "../services/language.service";
import { answersByQuestion } from "./answers";
import { AskStore } from "./ask.store";
import type { AskMessage, Entry } from "./ask-types";
import { isMatchKind, MATCH_BRIEF_CHARS, MATCH_KINDS, matchData } from "./match";
import { fetchMap, type MapPage } from "./portfolio-map";
import { plainText } from "./terminal-markdown";
import { track } from "./track";

/**
 * The visitor's own agent (plan 3 W6): four WebMCP tools, loaded once the page is idle and only
 * where the browser has `modelContext` (main.ts). The two that reach the model spend what the
 * visitor's own question would, under the same limits, and exist only while their feature is
 * on. An agent's arguments are checked here, whatever the schema says.
 */

/** Chrome's guidance for a tool's output. */
const MAX_OUTPUT = 1_500;

const BUSY = "The site's assistant is still answering; try again once it is done.";
const PROVIDER =
  "A model writes the answer from his published pages, so the text goes to the AI model provider the site uses, as its privacy page explains.";

type Tool = Parameters<typeof declareExperimentalWebMcpTool>[0];
/** A tool as written here: it answers in words, which the wrapper caps. */
type AgentTool = Omit<Tool, "execute"> & { execute: (args: unknown) => Promise<string> };

export type AgentStore = Pick<
  InstanceType<typeof AskStore>,
  "chat" | "entries" | "remote" | "askQuestion" | "sendMatch" | "messageFor"
>;

export interface AgentDeps {
  store: AgentStore;
  locale: () => Locale;
  navigate: (url: string) => Promise<unknown>;
  pages: () => Promise<MapPage[] | null>;
}

/** An agent's string argument, or "" for anything else (the arguments may even be an array). */
function arg(args: unknown, key: string): string {
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function cap(text: string, max = MAX_OUTPUT, more = " … (cut at 1,500 characters)"): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - more.length))}${more}`;
}

/** The entry a store call adds (`ask` puts it in before its first await), once it settles. */
async function settle(store: AgentStore, sending: Promise<void>): Promise<Entry | undefined> {
  const id = store.entries().at(-1)?.id;
  await sending;
  return store.entries().find((e) => e.id === id);
}

function answerOf(store: AgentStore, entry: Entry | undefined): AskMessage | undefined {
  return entry?.kind === "ask"
    ? answersByQuestion(store.chat.messages).get(entry.userId)
    : undefined;
}

/** What the visitor would read in the terminal: the answer and its sources, or why there is none. */
function answerText(store: AgentStore, entry: Entry | undefined): string {
  if (!entry) return "No answer: the conversation was reset meanwhile.";
  if (entry.kind === "local") {
    return entry.lines.map((l) => (l.label ? `${l.label}: ${l.text}` : l.text)).join("\n");
  }
  if (entry.failure) return plainText(store.messageFor(entry.failure, entry.retryAfter));
  const parts = answerOf(store, entry)?.parts ?? [];
  const text = plainText(parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n"));
  const sources = parts.flatMap((p) =>
    p.type === "source-url" ? [`- ${p.title ?? p.url}: ${p.url}`] : [],
  );
  const tail = sources.length ? `\nSources:\n${sources.join("\n")}` : "";
  // The sources stay whole: the words are cut first.
  const words = cap(
    text || "No answer came.",
    MAX_OUTPUT - tail.length,
    " … (cut: the site shows it whole)",
  );
  return words + tail;
}

export function agentTools({ store, locale, navigate, pages }: AgentDeps): Tool[] {
  const busy = () => ["submitted", "streaming"].includes(store.chat.status);
  const remote = store.remote();
  const maxChars = () => store.remote()?.limits.maxChars ?? 600;

  const listPages: AgentTool = {
    name: "list_pages",
    description:
      "Lists the published pages of Alireza Rastineh's portfolio in the page's language: each one's path, kind (profile, experience, project, post or skills), title and date. open_page shows one to the user.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const list = await pages();
      if (!list) return "The list of pages could not be loaded; try again.";
      return list
        .map((p) => [p.url, p.kind, p.title, ...(p.updated ? [p.updated] : [])].join(" · "))
        .join("\n");
    },
  };

  const openPage: AgentTool = {
    name: "open_page",
    description:
      "Opens one of the portfolio's pages in this tab, for the user to read. Takes a path exactly as list_pages gives it; any other path is refused.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "A path from list_pages." } },
      required: ["path"],
    },
    execute: async (args) => {
      const path = arg(args, "path");
      const page = (await pages())?.find((p) => p.url === path);
      if (!page) return "Not one of the site's pages: list_pages gives their paths.";
      await navigate(page.url);
      return `Opened "${page.title}" (${page.url}).`;
    },
  };

  const askPortfolio: AgentTool = {
    name: "ask_portfolio",
    description: `Asks the portfolio's assistant one question about Alireza Rastineh's work, as the user could on the site, and returns the answer with its sources. ${PROVIDER} One question at a time, at most ${maxChars()} characters; the text is always asked, never run as a command.`,
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", maxLength: maxChars() } },
      required: ["question"],
    },
    annotations: { untrustedContentHint: true },
    execute: async (args) => {
      const question = arg(args, "question");
      if (!question) return "Ask a question.";
      if (question.length > maxChars()) return `Too long: at most ${maxChars()} characters.`;
      if (busy()) return BUSY;
      return answerText(store, await settle(store, store.askQuestion(question)));
    },
  };

  const matchBrief: AgentTool = {
    name: "match_brief",
    description: `Checks a brief against Alireza Rastineh's published work: kind role (a job ad), project (something to build) or problem (a technical question). Opens the site's match page, where the user sees each point with its evidence, and returns each point's status (evidence, partial or not-published) and the page's path. ${PROVIDER} At most ${MATCH_BRIEF_CHARS} characters; one at a time.`,
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...MATCH_KINDS] },
        brief: { type: "string", maxLength: MATCH_BRIEF_CHARS },
      },
      required: ["kind", "brief"],
    },
    annotations: { untrustedContentHint: true },
    execute: async (args) => {
      if (store.remote()?.match !== true) return "Matching is switched off on this site just now.";
      const kind = arg(args, "kind");
      const brief = arg(args, "brief");
      if (!isMatchKind(kind)) return "kind must be role, project or problem.";
      if (!brief || brief.length > MATCH_BRIEF_CHARS) {
        return `The brief must be 1 to ${MATCH_BRIEF_CHARS} characters.`;
      }
      if (busy()) return BUSY;
      const path = `/${locale()}/match`;
      await navigate(path);
      const entry = await settle(store, store.sendMatch(kind, brief, "agent"));
      // The cites stay on the page, where the user sees them.
      const rows = matchData(answerOf(store, entry), () => null)?.items;
      if (!rows) return answerText(store, entry);
      return [
        `Checked; the user sees the table on ${path}.`,
        ...rows.map((r) => `${r.n}. ${r.text}: ${r.status}`),
      ].join("\n");
    },
  };

  return [
    listPages,
    openPage,
    ...(remote?.state === "ok" ? [askPortfolio] : []),
    ...(remote?.match === true ? [matchBrief] : []),
  ].map((tool): Tool => ({
    ...tool,
    execute: async (args) => {
      track("agent_tool", { tool: tool.name });
      return cap(await tool.execute(args));
    },
  }));
}

/** On the app's root injector: the tools last as long as the page. */
export async function declareAgentTools(injector: Injector): Promise<void> {
  const store = injector.get(AskStore);
  const router = injector.get(Router);
  const lang = injector.get(LanguageService);
  // Which spending tools exist depends on the switches.
  await store.loadConfig();
  const tools = agentTools({
    store,
    locale: () => lang.lang(),
    navigate: (url) => router.navigateByUrl(url),
    pages: () => fetchMap(lang.lang()),
  });
  await Promise.all(tools.map((tool) => declareExperimentalWebMcpTool(tool, injector)));
}
