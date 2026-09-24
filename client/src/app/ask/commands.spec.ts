import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { appContentSchema, type AppContent } from "../content/schema";
import { ASK_COPY } from "./ask-copy";
import {
  complete,
  offlineLines,
  openTarget,
  parseInput,
  projectLines,
  whoamiLines,
} from "./commands";

const here = dirname(fileURLToPath(import.meta.url));
const base = appContentSchema.parse(
  JSON.parse(readFileSync(resolve(here, "../content/fallback.en.json"), "utf8")),
);

/** The fallback content with one project that has a case study, and one post. */
const content: AppContent = {
  ...base,
  projects: base.projects.map((p, i) =>
    i === 0 ? { ...p, slug: "atlas", name: "Atlas", hasCaseStudy: true } : p,
  ),
  posts: [
    {
      slug: "evals-first",
      title: "Evals first",
      excerpt: "",
      publishedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      tags: [],
      cover: null,
      readingMinutes: 3,
      alternates: { en: "/en/writing/evals-first", de: null },
    } as unknown as AppContent["posts"][number],
  ],
};
const copy = ASK_COPY.en;

describe("parseInput", () => {
  it("runs a command only when the whole input is one", () => {
    expect(parseInput("help")).toEqual({ kind: "local", name: "help", arg: "" });
    expect(parseInput("  LS   Projects ")).toEqual({ kind: "local", name: "ls-projects", arg: "" });
    expect(parseInput("help me find his projects")).toEqual({
      kind: "ask",
      text: "help me find his projects",
      deep: false,
    });
    expect(parseInput("cat atlas")).toEqual({ kind: "local", name: "cat", arg: "atlas" });
    expect(parseInput("cat is a nice animal right")).toMatchObject({ kind: "ask" });
  });

  it("knows ask, deep, lang and the easter egg", () => {
    expect(parseInput("deep compare his projects")).toEqual({
      kind: "ask",
      text: "compare his projects",
      deep: true,
    });
    expect(parseInput("deep")).toEqual({ kind: "local", name: "deep-usage", arg: "" });
    expect(parseInput("ask what is atlas")).toEqual({
      kind: "ask",
      text: "what is atlas",
      deep: false,
    });
    expect(parseInput("lang DE")).toEqual({ kind: "local", name: "lang", arg: "de" });
    expect(parseInput("sudo hire alireza")).toMatchObject({ kind: "local", name: "sudo" });
    expect(parseInput("   ")).toEqual({ kind: "empty" });
  });
});

describe("complete", () => {
  it("completes commands and project names when only one matches", () => {
    expect(complete("wh", content)).toBe("whoami");
    expect(complete("ls s", content)).toBe("ls skills");
    expect(complete("ls", content)).toBeNull();
    expect(complete("cat at", content)).toBe("cat atlas");
    expect(complete("open con", content)).toBe("open contact");
  });
});

describe("local answers", () => {
  it("opens sections, case studies and posts, and nothing else", () => {
    expect(openTarget(content, "en", "contact")).toBe("/en#contact");
    expect(openTarget(content, "en", "atlas")).toBe("/en/work/atlas");
    expect(openTarget(content, "de", "evals-first")).toBe("/de/writing/evals-first");
    expect(openTarget(content, "en", "https://evil.test")).toBeNull();
    expect(openTarget(content, "en", "admin")).toBeNull();
  });

  it("prints a project and says when there is none", () => {
    const lines = projectLines(content, "en", "Atlas", copy);
    expect(lines[0]!.text).toMatch(/^Atlas — /);
    expect(lines.at(-1)).toMatchObject({ href: "/en/work/atlas", internal: true });
    expect(projectLines(content, "en", "nope", copy)).toEqual([
      { text: "No project called “nope”. Try `ls projects`.", tone: "error" },
    ]);
  });

  it("answers common questions offline, and always offers contact", () => {
    const lines = offlineLines("Which projects has he built?", content, "en", copy);
    expect(lines[0]!.text).toBe(copy.offlineIntro);
    expect(lines.some((l) => l.label === "atlas")).toBe(true);
    expect(lines.at(-1)!.text).toBe(copy.offlineContact);
    expect(offlineLines("Wo wohnt er?", content, "de", ASK_COPY.de)).toEqual(
      expect.arrayContaining(whoamiLines(content, "de", ASK_COPY.de)),
    );
  });
});
