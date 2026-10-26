import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { appContentSchema, type AppContent } from "../content/schema";
import { ASK_COPY } from "./ask-copy";
import type { AskMessage } from "./ask-types";
import { parseInput } from "./commands";
import { requestBody } from "./request-body";
import {
  defaultTour,
  replannable,
  stopLines,
  stopTarget,
  tourData,
  tourLines,
  type TourState,
} from "./tour";

/** The guided tour in the browser (visitor plan V16): the short tour, the server's plan, the moves. */

const here = dirname(fileURLToPath(import.meta.url));
const base = appContentSchema.parse(
  JSON.parse(readFileSync(resolve(here, "../content/fallback.en.json"), "utf8")),
);

const post = (slug: string, title: string, publishedAt: string, excerpt: string) =>
  ({
    slug,
    title,
    excerpt,
    publishedAt,
    updatedAt: publishedAt,
    tags: [],
    cover: null,
    readingMinutes: 3,
    alternates: { en: `/en/writing/${slug}`, de: null },
  }) as unknown as AppContent["posts"][number];

/** The fallback content with two case studies (the third project has none) and two posts. */
const content: AppContent = {
  ...base,
  projects: base.projects.map((p, i) =>
    i < 2
      ? {
          ...p,
          slug: i ? "borealis" : "atlas",
          name: i ? "Borealis" : "Atlas",
          hasCaseStudy: true,
          descriptor: i ? "Document extraction. At scale." : "",
          hook: "A support assistant.",
        }
      : p,
  ),
  posts: [
    post("older", "Older post", "2026-01-01T00:00:00.000Z", "From January."),
    post("newer", "Newer post", "2026-08-01T00:00:00.000Z", "From August. More words."),
  ],
};
const copy = ASK_COPY.en.tour;

describe("the short tour (visitor plan V16)", () => {
  it("goes About, the first case study, the newest post, the second case study, contact", () => {
    const stops = defaultTour(content, "en");
    expect(stops.map((s) => [s.id, s.url])).toEqual([
      ["about", "/en#about"],
      ["project:atlas@en", "/en/work/atlas"],
      ["post:newer@en", "/en/writing/newer"],
      ["project:borealis@en", "/en/work/borealis"],
      ["contact", "/en#contact"],
    ]);
    // Each line is the page's own words: a descriptor (else its hook), an excerpt, a first sentence.
    expect(stops.map((s) => s.line)).toEqual([
      "Building AI applications in a Jupyter notebook is easy; keeping them stable in production is hard.",
      "A support assistant.",
      "From August.",
      "Document extraction.",
      "Open to senior full-stack and AI engineering roles.",
    ]);
    // Headings without their comment marks.
    expect(stops[0]!.title).toBe("about");
  });

  it("leaves out what the content lacks", () => {
    const bare = { ...content, posts: [], projects: base.projects };
    expect(defaultTour(bare, "en").map((s) => s.id)).toEqual(["about", "contact"]);
  });
});

/** An answer with a `data-tour` part, as the server sends it. */
const answer = (data: unknown): AskMessage => ({
  id: "m_tour00000001",
  role: "assistant",
  parts: [
    { type: "text", text: "A tour." },
    { type: "data-tour", data } as unknown as AskMessage["parts"][number],
  ],
});

const PLAN = {
  v: 1,
  kind: "plan",
  interest: "data platforms",
  stops: [
    { id: "project:borealis@en", title: "Borealis", url: "/en/work/borealis", line: "Data." },
    { id: "experience:contoso@en", title: "Contoso", url: "/en#experience", line: "Where." },
    { id: "post:newer@en", title: "Newer post", url: "/en/writing/newer", line: "How." },
  ],
  replanned: false,
  sig: "sig",
};

describe("tourData", () => {
  it("reads the server's plan field by field, and only the site's own paths", () => {
    expect(tourData(answer(PLAN))).toEqual({
      kind: "plan",
      interest: "data platforms",
      stops: PLAN.stops,
      replanned: false,
      sig: "sig",
    });
    const hostile = {
      ...PLAN,
      stops: [...PLAN.stops, { id: "x", title: "X", url: "//evil.example", line: "No." }],
    };
    expect(tourData(answer(hostile))!.stops).toEqual(PLAN.stops);
    expect(tourData(answer({ ...PLAN, kind: "default", stops: [] }))).toMatchObject({
      kind: "default",
      stops: [],
    });
    expect(tourData(answer({ ...PLAN, v: 2 }))).toBeNull();
    expect(tourData(answer({ ...PLAN, stops: [] }))).toBeNull();
    expect(tourData({ id: "m_x0000001", role: "assistant", parts: [] })).toBeNull();
  });
});

describe("a stop's move", () => {
  it("goes only where openTarget takes the page: a case study, a section, home, a post", () => {
    expect(stopTarget(content, "en", "/en/work/atlas")).toBe("/en/work/atlas");
    expect(stopTarget(content, "en", "/en#experience")).toBe("/en#experience");
    expect(stopTarget(content, "en", "/en")).toBe("/en");
    expect(stopTarget(content, "en", "/en/writing/newer")).toBe("/en/writing/newer");
    // Not published as a case study, unknown, or not the site's.
    expect(stopTarget(content, "en", "/en/work/project-three")).toBeNull();
    expect(stopTarget(content, "en", "/en/writing/gone")).toBeNull();
    expect(stopTarget(content, "en", "https://evil.example")).toBeNull();
    expect(stopTarget(content, "en", "/en/work/atlas?x=1")).toBeNull();
    // The other language's page: its shape, which the server checked against its pages.
    expect(stopTarget(content, "en", "/de/work/atlas")).toBe("/de/work/atlas");
  });

  it("prints the list, then each stop with a question about it, and says when it was the last", () => {
    const state: TourState = {
      kind: "plan",
      stops: PLAN.stops,
      at: -1,
      reached: -1,
      interest: "data platforms",
      replanned: false,
    };
    const lines = tourLines(state, copy);
    expect(lines[0]).toEqual({ text: "A tour for “data platforms”, 3 stops:", tone: "accent" });
    expect(lines[1]).toEqual({
      label: "1",
      text: "Borealis — Data.",
      href: "/en/work/borealis",
      internal: true,
    });
    expect(stopLines({ ...state, at: 0 }, copy)).toEqual([
      { label: "stop 1 of 3", text: "Borealis — Data.", tone: "accent" },
      { text: "ask about this ›", ask: "What should I know about Borealis?" },
    ]);
    expect(stopLines({ ...state, at: 2 }, copy).at(-1)).toEqual({
      text: "That was the last stop.",
      tone: "dim",
    });
    expect(tourLines({ ...state, kind: "default" }, copy)[0]!.text).toBe(
      "The short tour, 3 stops:",
    );
  });

  it("replans only from a page of the map", () => {
    expect(replannable(PLAN.stops[0])).toBe(true);
    expect(replannable({ id: "profile@en", title: "", url: "/en", line: "" })).toBe(true);
    expect(replannable({ id: "about", title: "", url: "/en#about", line: "" })).toBe(false);
    expect(replannable(undefined)).toBe(false);
  });
});

describe("the tour's commands and request", () => {
  it("reads tour with any words after it, and next and back alone", () => {
    expect(parseInput("tour")).toEqual({ kind: "local", name: "tour", arg: "" });
    expect(parseInput("tour data platforms")).toEqual({
      kind: "local",
      name: "tour",
      arg: "data platforms",
    });
    expect(parseInput("TOUR stop")).toEqual({ kind: "local", name: "tour", arg: "stop" });
    expect(parseInput("next")).toEqual({ kind: "local", name: "next", arg: "" });
    expect(parseInput("back")).toEqual({ kind: "local", name: "back", arg: "" });
    expect(parseInput("next steps for his team?")).toMatchObject({ kind: "ask" });
  });

  it("sends a tour as its own mode, with its interest and a replan's signed plan", () => {
    const body = requestBody({
      sessionId: "s".repeat(16),
      locale: "en",
      deep: false,
      turnstileToken: "",
      url: "/en",
      tour: {
        interest: "data platforms",
        from: "project:borealis@en",
        plan: {
          messageId: "m_tour00000001",
          stops: ["project:borealis@en"],
          replanned: false,
          sig: "sig",
        },
      },
      messages: [],
    });
    expect(body).toMatchObject({
      mode: "tour",
      tour: { interest: "data platforms", from: "project:borealis@en" },
    });
    const plain = requestBody({
      sessionId: "s".repeat(16),
      locale: "en",
      deep: false,
      turnstileToken: "",
      url: "/en",
      tour: null,
      messages: [],
    });
    expect(plain).not.toHaveProperty("mode");
    expect(plain).not.toHaveProperty("tour");
  });
});
