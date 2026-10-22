import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../test/ask-fixtures.js";
import type { Corpus, CorpusDocument, ProjectFacts } from "./corpus/build.js";
import { assembleCorpus, withLayout } from "./corpus/index.js";
import { CORE_LIMIT } from "./corpus/render.js";
import { pageDocument } from "./page.js";
import { DEFAULT_SETTINGS } from "./settings.js";

/**
 * Visitor plan V8: the page a question is asked on names a document only when
 * it is a published case study or post, in the page's own language.
 */

const doc = (d: CorpusDocument) => d;

const project = (slug: string, locale: "en" | "de", hasCaseStudy: boolean): ProjectFacts => ({
  id: `project:${slug}@${locale}`,
  slug,
  locale,
  name: slug === "atlas" ? "Atlas" : "Card",
  descriptor: "",
  role: "",
  period: null,
  category: null,
  stack: [],
  tags: [],
  metrics: [],
  url: hasCaseStudy ? `/${locale}/work/${slug}` : `/${locale}#projects`,
  hasCaseStudy,
});

const LONG = "A line of the case study, long enough to matter.\n".repeat(80);

const BASE: Corpus = {
  key: "en:1|de:1",
  text: "",
  documents: [
    doc({ id: "profile@en", kind: "profile", locale: "en", title: "P", url: "/en", text: "P" }),
    doc({
      id: "project:atlas@en",
      kind: "project",
      locale: "en",
      title: "Atlas",
      url: "/en/work/atlas",
      text: LONG,
    }),
    // A complete translation: the English core lists it as a handle.
    doc({
      id: "project:atlas@de",
      kind: "project",
      locale: "de",
      title: "Atlas",
      url: "/de#projects",
      text: LONG,
    }),
    doc({
      id: "project:card@en",
      kind: "project",
      locale: "en",
      title: "Card",
      url: "/en#projects",
      text: "A project with a card only.",
    }),
    doc({
      id: "post:notes@en",
      kind: "post",
      locale: "en",
      title: "Notes",
      url: "/en/writing/notes",
      text: "Short notes.",
    }),
    doc({
      id: "post:nur-de@de",
      kind: "post",
      locale: "de",
      title: "Nur",
      url: "/de/writing/nur-de",
      text: "Nur auf Deutsch.",
    }),
  ],
  // The German Atlas has no case study: its page does not exist.
  projects: [
    project("atlas", "en", true),
    project("atlas", "de", false),
    project("card", "en", false),
  ],
  posts: [
    { slug: "notes", locale: "en", title: "Notes", url: "/en/writing/notes" },
    { slug: "nur-de", locale: "de", title: "Nur", url: "/de/writing/nur-de" },
  ],
};

const corpus = assembleCorpus(BASE, DEFAULT_SETTINGS, [], fixtureConfig());

describe("pageDocument", () => {
  it("maps a case study to its project, in the page's language, and names the project", () => {
    for (const path of ["/en/work/atlas", "/en/work/atlas/", " /EN/work/atlas "]) {
      const page = pageDocument(corpus, path, "en");
      expect(page?.document.id, path).toBe("project:atlas@en");
      expect(page?.project).toBe("Atlas");
    }
  });

  it("maps a post to its document, with no project", () => {
    const page = pageDocument(corpus, "/en/writing/notes", "en");
    expect(page?.document.id).toBe("post:notes@en");
    expect(page).not.toHaveProperty("project");
    expect(pageDocument(corpus, "/de/writing/nur-de", "en")?.document.id).toBe("post:nur-de@de");
  });

  it("refuses an unpublished page, the other language's, and every other path", () => {
    for (const path of [
      // No case study, or not in this language.
      "/en/work/card",
      "/de/work/atlas",
      "/de/writing/notes",
      "/en/writing/nur-de",
      // Not published at all.
      "/en/work/nebula",
      "/en/writing/nebula",
      // Pages without a document of their own.
      "/en",
      "/en#projects",
      "/en/writing",
      "/en/legal/privacy",
      // As the browser never sends them, or another site's.
      "/en/work/atlas?x=1",
      "/en/work/atlas#problem",
      "/en/work/Atlas",
      "/en/work/../work/atlas",
      "https://evil.example/en/work/atlas",
      "//evil.example/en/work/atlas",
      "en/work/atlas",
      "",
    ]) {
      expect(pageDocument(corpus, path, "en"), path).toBeNull();
    }
    expect(pageDocument(corpus, undefined, "en")).toBeNull();
  });

  it("says how the reading language's core holds the page: whole, cut short, or a handle", () => {
    expect(pageDocument(corpus, "/en/writing/notes", "en")?.held).toBe("whole");
    expect(LONG.length).toBeGreaterThan(CORE_LIMIT.project!);
    expect(pageDocument(corpus, "/en/work/atlas", "en")?.held).toBe("clipped");
    // Read in German, the English case study is the other language's complete translation.
    expect(pageDocument(corpus, "/en/work/atlas", "de")?.held).toBe("handle");
    // Part C's single core holds every document, cut by its kind's limit only.
    expect(pageDocument(withLayout(corpus, "both"), "/en/work/atlas", "de")?.held).toBe("clipped");
  });
});
