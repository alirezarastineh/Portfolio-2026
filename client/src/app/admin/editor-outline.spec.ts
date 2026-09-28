import { describe, expect, it } from "vitest";

import type { PostRow, ProjectRow } from "./admin-api.service";
import { hasText, postOutline, problemsUnder, projectOutline } from "./editor-outline";

function translation(fill: boolean) {
  const text = fill ? "Written" : "";
  return {
    name: fill ? "Atlas" : "TODO: name",
    descriptor: text,
    hook: text,
    problem: fill ? "<p>Search was slow.</p>" : "<p></p>",
    aiArchitecture: text,
    fullStackInfra: text,
    outcomes: fill ? ["Faster"] : [],
    role: text,
    categoryLabel: "",
    metrics: fill ? [{ value: "40%", label: "faster" }] : [],
    body: "",
    seoDescription: "",
  };
}

function project(fill: boolean): ProjectRow {
  return {
    id: "p1",
    slug: "atlas",
    coverId: fill ? "c1" : null,
    coverPath: fill ? "/media/c1.webp" : "/projects/atlas.svg",
    stack: fill ? ["Angular"] : [],
    linkLive: "",
    linkRepo: "",
    linkCaseStudy: "",
    isVisible: true,
    featured: false,
    periodStart: fill ? "2025-01-01" : null,
    periodEnd: null,
    category: fill ? "ai" : "",
    tags: [],
    gallery: [],
    translations: { en: translation(fill), de: translation(fill) },
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as ProjectRow;
}

describe("hasText", () => {
  it("wants words a visitor reads, not tags or the seed's TODO", () => {
    expect(hasText("Hello")).toBe(true);
    expect(hasText("<p><br></p>")).toBe(false);
    expect(hasText("TODO: write the hook")).toBe(false);
    expect(hasText(null)).toBe(false);
  });
});

describe("problemsUnder", () => {
  it("matches a field, what is inside it, and either language through *", () => {
    const paths = ["slug", "translations.de.name", "translations.en.metrics.0.value", "slugs"];
    expect(problemsUnder(paths, ["slug"])).toBe(1);
    expect(problemsUnder(paths, ["translations.*.name"])).toBe(1);
    expect(problemsUnder(paths, ["translations.*.metrics"])).toBe(1);
    expect(problemsUnder(paths, ["translations"])).toBe(2);
  });
});

describe("projectOutline", () => {
  it("ticks what is filled in, and leaves the optional sections open without nagging", () => {
    const states = Object.fromEntries(
      projectOutline(project(true), []).map((i) => [i.id, i.state]),
    );
    expect(states).toEqual({
      details: "done",
      cover: "done",
      stack: "done",
      card: "done",
      story: "done",
      outcomes: "done",
      metrics: "done",
      "case-study": "optional",
      search: "optional",
      gallery: "optional",
    });
  });

  it("marks what a visitor will miss, and the seed's stub cover and TODO names as not done", () => {
    const items = projectOutline(project(false), []);
    const todo = items.filter((i) => i.state === "todo").map((i) => i.id);
    expect(todo).toEqual(["details", "cover", "stack", "card", "story", "outcomes"]);
  });

  it("puts each problem in its section", () => {
    const items = projectOutline(project(true), [
      "slug",
      "translations.de.hook",
      "translations.en.body",
      "gallery.0.mediaId",
    ]);
    const problems = Object.fromEntries(items.map((i) => [i.id, i.problems]));
    expect(problems).toMatchObject({ details: 1, card: 1, "case-study": 1, gallery: 1, story: 0 });
  });
});

describe("postOutline", () => {
  it("treats a language left out as optional, and one without a body as to do", () => {
    const post = {
      id: "x",
      slug: "hello",
      status: "draft",
      publishedAt: null,
      coverId: null,
      coverPath: null,
      tags: [],
      canonicalUrl: "",
      translations: {
        en: { title: "Hello", excerpt: "", body: "", seoTitle: "", seoDescription: "" },
        de: null,
      },
      createdAt: "",
      updatedAt: "",
    } as unknown as PostRow;
    const states = Object.fromEntries(postOutline(post, ["translations"]).map((i) => [i.id, i]));
    expect(states["post-en"]?.state).toBe("todo");
    expect(states["post-de"]?.state).toBe("optional");
    expect(states["post-details"]).toMatchObject({ state: "done", problems: 1 });
  });
});
