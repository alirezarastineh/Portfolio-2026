import type { AppContent } from "../../app/content/schema";
import { MCP_TOOLS } from "./llms";

/**
 * The portfolio's A2A agent card (plan phase 32), served at
 * `/.well-known/agent-card.json`: who the assistant is, its AI disclosure, and
 * where an agent reads the same content. It lists no A2A interface, and says
 * so: the portfolio serves none of A2A's operations, and A2A asks a binding to
 * be equivalent to them. The read-only MCP endpoint is declared as an
 * extension instead (not required), which an A2A client may ignore; the skills
 * are its tools, so a card that knows no endpoint lists none.
 */

export const MCP_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];

export function buildAgentCard(content: AppContent, origin: string, mcpUrl: string | null) {
  const { identity } = content;
  const name = identity.name.trim();
  const project = content.projects[0]?.name;
  return {
    name: `${name}: portfolio assistant`,
    description: [
      `${content.seo.description.trim()}`,
      `The site's assistant is an AI: it answers visitors' questions about ${name}'s work in the site's terminal, from the published portfolio only, cites its sources, and says when the portfolio does not answer.`,
      "It takes no A2A messages, so this card lists no A2A interface.",
      mcpUrl
        ? "Agents can read the same published content over MCP (read-only, no sign-in, no model behind it): see capabilities.extensions. Each skill is one of its tools."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    version: "1.0",
    provider: { organization: name, url: origin },
    documentationUrl: `${origin}/llms.txt`,
    iconUrl: `${origin}/icon-512.png`,
    supportedInterfaces: [],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      ...(mcpUrl
        ? {
            extensions: [
              {
                uri: "https://modelcontextprotocol.io/specification/2026-07-28",
                description:
                  "The portfolio's published content over the Model Context Protocol: Streamable HTTP, JSON replies, read-only tools, no sign-in.",
                required: false,
                params: { endpoint: mcpUrl, protocolVersions: MCP_VERSIONS, tools: MCP_TOOLS },
              },
            ],
          }
        : {}),
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: mcpUrl ? skills(project) : [],
  };
}

/** The MCP endpoint's tools, as A2A skills: each id is the tool's name. */
function skills(project: string | undefined) {
  return [
    {
      id: "search_portfolio",
      name: "Search the portfolio",
      description:
        "MCP tool: finds the profile, experience, projects and case studies, writing, skills, CV and FAQ entries that mention some words, with their best passage.",
      tags: ["portfolio", "search", "mcp"],
      examples: ["Which projects used pgvector?", "Is remote work an option?"],
    },
    {
      id: "get_document",
      name: "Read a document",
      description:
        "MCP tool: reads one document of the portfolio whole, by the id a search returned.",
      tags: ["portfolio", "read", "mcp"],
      examples: [project ? `Read the ${project} case study.` : "Read the profile."],
    },
    {
      id: "list_projects",
      name: "List the projects",
      description:
        "MCP tool: lists the projects with their role, period, stack, tags, metrics and links, optionally only those mentioning a word.",
      tags: ["portfolio", "projects", "mcp"],
      examples: ["Which projects are in production?"],
    },
    {
      id: "get_resume",
      name: "Get the CV",
      description: "MCP tool: gets the CV as text, with a link to the PDF, in English or German.",
      tags: ["portfolio", "cv", "mcp"],
      examples: ["What is the current role on the CV?"],
    },
  ];
}
