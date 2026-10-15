import { availabilityLabel } from "../../app/content/availability";
import type { AppContent, Locale } from "../../app/content/schema";
import { originOf } from "./csp";

/**
 * llms.txt (llmstxt.org) for one language (plan phase 32): the published
 * portfolio as a short Markdown index a language model reads first: who it is,
 * the projects and the writing with absolute links, the CV, and for agents the
 * read-only MCP endpoint and the agent card. Built from the published content
 * on each request (cached briefly), as the RSS feed is. The "Optional" section
 * keeps its English name in both languages: the format gives it a meaning.
 */

/** The read-only MCP endpoint's address on the API, or null when the API's origin is unknown. */
export function mcpEndpoint(env: Record<string, string | undefined>): string | null {
  const api = originOf(env["VITE_API_BASE_URL"]);
  return api ? `${api}/v1/mcp` : null;
}

/** The tools the endpoint serves (server `ask/mcp/tools.ts`). */
export const MCP_TOOLS = ["search_portfolio", "get_document", "list_projects", "get_resume"];

const COPY: Record<
  Locale,
  {
    basedIn: string;
    projects: string;
    writing: string;
    cv: string;
    cvLine: string;
    agents: string;
    mcpLine: string;
    cardLine: string;
    rss: string;
    otherLanguage: string;
  }
> = {
  en: {
    basedIn: "Based in",
    projects: "Projects",
    writing: "Writing",
    cv: "CV",
    cvLine: "The CV, as a PDF",
    agents: "For agents",
    mcpLine: `read-only MCP endpoint (Streamable HTTP, no sign-in, no model behind it): ${MCP_TOOLS.join(", ")}`,
    cardLine: "what the portfolio's assistant can do, and where its tools are (A2A agent card)",
    rss: "the writing as an RSS feed",
    otherLanguage: "Deutsche Fassung",
  },
  de: {
    basedIn: "Ansässig in",
    projects: "Projekte",
    writing: "Artikel",
    cv: "Lebenslauf",
    cvLine: "Der Lebenslauf als PDF",
    agents: "Für Agenten",
    mcpLine: `MCP-Endpunkt, nur lesend (Streamable HTTP, ohne Anmeldung, ohne Modell dahinter): ${MCP_TOOLS.join(", ")}`,
    cardLine: "was der Assistent des Portfolios kann und wo seine Werkzeuge sind (A2A-Agent-Card)",
    rss: "die Artikel als RSS-Feed",
    otherLanguage: "English version",
  },
};

/** One line of prose, as a list item takes it. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
/** A label as a sentence: the hero's words end without a stop. */
const sentence = (text: string) => {
  const line = oneLine(text);
  return !line || /[.!?…]$/.test(line) ? line : `${line}.`;
};
/** Text inside a link's brackets. */
const linkText = (text: string) => oneLine(text).replace(/[[\]\\]/g, String.raw`\$&`);

type Project = AppContent["projects"][number];
type Post = AppContent["posts"][number];

function projectLine(project: Project, base: string): string {
  const url = project.hasCaseStudy ? `${base}/work/${project.slug}` : `${base}#projects`;
  const about = oneLine(project.descriptor || project.hook);
  const desc = about ? `: ${about}` : "";
  return `- [${linkText(project.name)}](${url})${desc}`;
}

function postLine(post: Post, base: string): string {
  const excerpt = oneLine(post.excerpt);
  const desc = excerpt ? `: ${excerpt}` : "";
  return `- [${linkText(post.title)}](${base}/writing/${post.slug})${desc}`;
}

function bioLine(content: AppContent, basedIn: string): string {
  const { identity } = content;
  const where = [identity.location.city, identity.location.country].filter(Boolean).join(", ");
  return [
    `${oneLine(identity.name)} (${oneLine(identity.handle)}): ${oneLine(content.ui.profile.role)}.`,
    where ? `${basedIn} ${where}.` : "",
    // The owner's own published words, as the hero shows them.
    sentence(availabilityLabel(content.ui.hero, identity.availability)),
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildLlmsTxt(content: AppContent, origin: string, mcpUrl: string | null): string {
  const { locale, identity } = content;
  const copy = COPY[locale];
  const base = `${origin}/${locale}`;
  const other: Locale = locale === "en" ? "de" : "en";

  const lines = [
    `# ${oneLine(identity.name)}`,
    "",
    `> ${oneLine(content.seo.description)}`,
    "",
    bioLine(content, copy.basedIn),
    "",
  ];

  if (content.projects.length) {
    lines.push(`## ${copy.projects}`, "", ...content.projects.map((p) => projectLine(p, base)), "");
  }

  if (content.posts.length) {
    lines.push(`## ${copy.writing}`, "", ...content.posts.map((p) => postLine(p, base)), "");
  }

  if (identity.resume) {
    lines.push(`## ${copy.cv}`, "", `- [${copy.cvLine}](${base}/resume.pdf)`, "");
  }

  lines.push(`## ${copy.agents}`, "");
  if (mcpUrl) lines.push(`- [MCP](${mcpUrl}): ${copy.mcpLine}`);
  lines.push(
    `- [Agent card](${origin}/.well-known/agent-card.json): ${copy.cardLine}`,
    "",
    "## Optional",
    "",
    `- [RSS](${base}/rss.xml): ${copy.rss}`,
    `- [${copy.otherLanguage}](${origin}/${other}/llms.txt)`,
  );
  return `${lines.join("\n")}\n`;
}
