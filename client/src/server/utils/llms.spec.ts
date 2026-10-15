import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  appContentSchema,
  type AppContent,
  type Locale,
  type PostSummary,
} from "../../app/content/schema";
import { buildAgentCard, MCP_VERSIONS } from "./agent-card";
import { buildLlmsTxt, mcpEndpoint, MCP_TOOLS } from "./llms";

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://example.test";
const MCP = "https://api.example.test/v1/mcp";

function fallback(locale: Locale): AppContent {
  const raw = readFileSync(resolve(here, `../../app/content/fallback.${locale}.json`), "utf8");
  return appContentSchema.parse(JSON.parse(raw));
}

function post(slug: string, over: Partial<PostSummary> = {}): PostSummary {
  return {
    slug,
    title: `Post ${slug}`,
    excerpt: "An excerpt.",
    publishedAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
    tags: [],
    cover: null,
    readingMinutes: 4,
    alternates: { en: `/en/writing/${slug}`, de: null },
    ...over,
  };
}

/** The fallback with what it lacks: a case study, a post, a CV. */
function published(): AppContent {
  const content = fallback("en");
  const [first, ...rest] = content.projects;
  return {
    ...content,
    identity: { ...content.identity, resume: { href: "/media/cv.pdf", bytes: 1000 } },
    projects: [{ ...first!, slug: "atlas", name: "Atlas", hasCaseStudy: true }, ...rest],
    posts: [post("evals-first", { title: "Evals first", excerpt: "Measure,\n  then change." })],
  };
}

describe("llms.txt (plan phase 32)", () => {
  it("indexes the portfolio for language models: who, the projects, the writing, the CV, absolute links", () => {
    const content = published();
    const text = buildLlmsTxt(content, ORIGIN, MCP);
    const lines = text.split("\n");

    // The format's shape: an H1, a quoted summary, then sections of link lists.
    expect(lines[0]).toBe(`# ${content.identity.name}`);
    expect(lines[2]).toBe(`> ${content.seo.description.replace(/\s+/g, " ").trim()}`);
    expect(lines[4]).toContain(`${content.identity.name} (${content.identity.handle}): `);
    // A case study links its page; a project without one, the projects on the home page.
    expect(text).toContain(`- [Atlas](${ORIGIN}/en/work/atlas)`);
    expect(content.projects.length).toBeGreaterThan(1);
    for (const project of content.projects.slice(1)) {
      expect(text).toContain(`- [${project.name}](${ORIGIN}/en#projects)`);
    }
    expect(text).toContain(
      `## Writing\n\n- [Evals first](${ORIGIN}/en/writing/evals-first): Measure, then change.`,
    );
    expect(text).toContain(`## CV\n\n- [The CV, as a PDF](${ORIGIN}/en/resume.pdf)`);
    // Every link is absolute.
    for (const [, url] of text.matchAll(/\]\(([^)]+)\)/g)) expect(url).toMatch(/^https:\/\//);

    // For agents: the MCP endpoint and its tools, the agent card; the optional links last.
    expect(text).toContain(`## For agents\n\n- [MCP](${MCP}): read-only MCP endpoint`);
    expect(text).toContain(MCP_TOOLS.join(", "));
    expect(text).toContain(`- [Agent card](${ORIGIN}/.well-known/agent-card.json)`);
    expect(text).toContain(`## Optional\n\n- [RSS](${ORIGIN}/en/rss.xml)`);
    expect(text).toContain(`- [Deutsche Fassung](${ORIGIN}/de/llms.txt)`);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("speaks the page's language, and leaves the MCP line out without the API's origin", () => {
    const text = buildLlmsTxt(fallback("de"), ORIGIN, null);
    expect(text).toContain("## Für Agenten");
    expect(text).not.toContain("[MCP]");
    expect(text).toContain(`- [Agent card](${ORIGIN}/.well-known/agent-card.json)`);
    // "Optional" keeps its English name: the format gives it a meaning.
    expect(text).toContain(`## Optional\n\n- [RSS](${ORIGIN}/de/rss.xml)`);
    expect(text).toContain(`- [English version](${ORIGIN}/en/llms.txt)`);
  });

  it("keeps a link's text a link's text, and leaves out what the content does not have", () => {
    const content = fallback("en");
    const text = buildLlmsTxt(
      { ...content, posts: [post("brackets", { title: "Arrays [and] lists", excerpt: "" })] },
      ORIGIN,
      null,
    );
    expect(text).toContain(`- [Arrays \\[and\\] lists](${ORIGIN}/en/writing/brackets)\n`);
    // No CV published, no CV section; no posts, no Writing section.
    expect(text).not.toContain("## CV");
    expect(buildLlmsTxt({ ...content, posts: [] }, ORIGIN, null)).not.toContain("## Writing");
  });

  it("says the availability in the owner's published words, as the hero does", () => {
    const content = fallback("en");
    const who = (availability: "open" | "limited" | "closed", hero = content.ui.hero) =>
      buildLlmsTxt(
        {
          ...content,
          identity: { ...content.identity, availability },
          ui: { ...content.ui, hero },
        },
        ORIGIN,
        null,
      ).split("\n")[4];
    const hero = {
      ...content.ui.hero,
      availabilityOpen: "Open to staff roles",
      availabilityLimited: "Booked until March!",
      availabilityClosed: "  Not looking\n right now  ",
    };
    expect(who("open", hero)!.endsWith(" Open to staff roles.")).toBe(true);
    // A label that ends a sentence keeps its own stop.
    expect(who("limited", hero)!.endsWith(" Booked until March!")).toBe(true);
    expect(who("closed", hero)!.endsWith(" Not looking right now.")).toBe(true);
    expect(who("open")!.endsWith(` ${content.ui.hero.availabilityOpen}.`)).toBe(true);
  });

  it("finds the endpoint from the API's origin, and nothing without one", () => {
    expect(mcpEndpoint({ VITE_API_BASE_URL: "https://api.example.test/" })).toBe(MCP);
    expect(mcpEndpoint({ VITE_API_BASE_URL: "" })).toBeNull();
    expect(mcpEndpoint({})).toBeNull();
  });
});

describe("the agent card (plan phase 32)", () => {
  it("is an A2A card: its required fields, the disclosure, and no A2A interface it does not serve", () => {
    const content = fallback("en");
    const card = buildAgentCard(content, ORIGIN, MCP);
    expect(card).toMatchObject({
      name: `${content.identity.name}: portfolio assistant`,
      version: "1.0",
      provider: { organization: content.identity.name, url: ORIGIN },
      documentationUrl: `${ORIGIN}/llms.txt`,
      supportedInterfaces: [],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain", "application/json"],
    });
    expect(card.description).toContain("The site's assistant is an AI");
    expect(card.description).toContain(
      "It takes no A2A messages, so this card lists no A2A interface.",
    );
    // The skills are the MCP endpoint's tools, and say so.
    expect(card.skills.map((s) => s.id)).toEqual(MCP_TOOLS);
    for (const skill of card.skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toMatch(/^MCP tool: /);
      expect(skill.tags).toContain("mcp");
    }
    // The MCP endpoint, declared as an extension an A2A client may ignore.
    expect(card.capabilities).toEqual({
      streaming: false,
      pushNotifications: false,
      extensions: [
        expect.objectContaining({
          required: false,
          params: { endpoint: MCP, protocolVersions: MCP_VERSIONS, tools: MCP_TOOLS },
        }),
      ],
    });
  });

  it("names no endpoint it does not know, nor the skills only that endpoint has", () => {
    const card = buildAgentCard(fallback("en"), ORIGIN, null);
    expect(card.capabilities).toEqual({ streaming: false, pushNotifications: false });
    expect(card.description).not.toContain("MCP");
    expect(card.description).toContain("this card lists no A2A interface");
    expect(card.skills).toEqual([]);
  });
});
