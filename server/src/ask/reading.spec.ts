import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../test/ask-fixtures.js";
import { drain, mockEntry, scripted, textTurn, toolTurn } from "../test/ask-models.js";
import { readingLocale, streamAnswer } from "./agent.js";
import type { Corpus, ProjectFacts } from "./corpus/build.js";
import { assembleCorpus } from "./corpus/index.js";
import { wrapVisitor } from "./prompt.js";
import { DEFAULT_SETTINGS } from "./settings.js";

/**
 * Plan phase 16: an answer reads the core of the language it is written in,
 * the visitor's, else the page's; its tools and its citations follow, and
 * its trace records which core it read.
 */

const atlas = (locale: "en" | "de", descriptor: string): ProjectFacts => ({
  id: `project:atlas@${locale}`,
  slug: "atlas",
  locale,
  name: "Atlas",
  descriptor,
  role: "Lead",
  period: null,
  category: null,
  stack: ["Python"],
  tags: [],
  metrics: ["38 %"],
  url: `/${locale}/work/atlas`,
  hasCaseStudy: true,
});

const BASE: Corpus = {
  key: "en:1|de:1",
  documents: [
    {
      id: "profile@en",
      kind: "profile",
      locale: "en",
      title: "Alireza Rastineh",
      url: "/en",
      text: "Senior AI engineer in Berlin.",
    },
    {
      id: "project:atlas@en",
      kind: "project",
      locale: "en",
      title: "Atlas",
      url: "/en/work/atlas",
      text: "Atlas: 38 % fewer escalations.",
    },
    {
      id: "profile@de",
      kind: "profile",
      locale: "de",
      title: "Alireza Rastineh",
      url: "/de",
      text: "Senior-KI-Ingenieur in Berlin.",
    },
    {
      id: "project:atlas@de",
      kind: "project",
      locale: "de",
      title: "Atlas",
      url: "/de/work/atlas",
      text: "Atlas: 38 % weniger Eskalationen.",
    },
  ],
  text: "",
  projects: [atlas("en", "support assistant"), atlas("de", "Support-Assistent")],
  posts: [],
};

describe("the reading language", () => {
  it("is the visitor's when clear, else the page's", () => {
    expect(readingLocale("en", "de")).toBe("de");
    expect(readingLocale("de", null)).toBe("de");
    expect(readingLocale("de", "en")).toBe("en");
  });

  it("picks the core, the tools' language and the citations, and the trace records it", async () => {
    const config = fixtureConfig();
    const corpus = assembleCorpus(BASE, DEFAULT_SETTINGS, [], config);
    const model = scripted([
      toolTurn("list_projects", {}),
      textTurn("Atlas senkte die Eskalationen um 38 % [^project:atlas]."),
    ]);
    // A German question on the English page.
    const { stream, done } = streamAnswer({
      messages: [{ role: "user", content: wrapVisitor("Was hat Atlas erreicht?", "en") }],
      question: "Was hat Atlas erreicht?",
      locale: "en",
      language: "de",
      sessionId: "reading-session-0001",
      sessionHash: "reading",
      source: "eval",
      route: { route: "lite", reason: "test" },
      corpus,
      config,
      chain: [mockEntry("gemini-3.5-flash-lite", model.model)],
      abortSignal: new AbortController().signal,
      persist: false,
    });
    await drain(stream);
    const outcome = await done;

    // The German core: the German documents whole, the English versions as handles.
    const instructions = JSON.stringify(model.calls[0]!.prompt[0]);
    expect(instructions).toContain("id: project:atlas@de");
    expect(instructions).toContain("## Also in English");
    expect(instructions).toContain("- project:atlas@en: Atlas (/en/work/atlas)");
    expect(instructions).not.toContain("id: project:atlas@en");

    // The tools read German: list_projects returned the German project.
    const toolMessage = JSON.stringify(model.calls[1]!.prompt.find((m) => m.role === "tool"));
    expect(toolMessage).toContain("Support-Assistent");
    expect(toolMessage).not.toContain("support assistant");

    // A citation without a language resolves to the reading language's document.
    expect(outcome.citedIds).toEqual(["project:atlas@de"]);
    expect(outcome.steps?.core).toEqual({
      locale: "de",
      layout: "locale",
      tokens: corpus.coreTokens.de,
    });
  });
});
