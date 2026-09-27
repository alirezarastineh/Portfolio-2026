import { describe, expect, it } from "vitest";

import { homeSections, sectionIndexes } from "./home-sections";

const entry = {} as never;

describe("homeSections", () => {
  it("hides experience and writing when they are empty", () => {
    expect(homeSections({ experiences: [], posts: [] })).toEqual([
      "hero",
      "projects",
      "skills",
      "about",
      "contact",
    ]);
  });

  it("keeps every section when there is content for it", () => {
    expect(homeSections({ experiences: [entry], posts: [entry] })).toEqual([
      "hero",
      "projects",
      "experience",
      "skills",
      "writing",
      "about",
      "contact",
    ]);
  });
});

describe("sectionIndexes", () => {
  it("numbers the rendered sections after the hero, and leaves hidden ones blank", () => {
    const indexes = sectionIndexes(homeSections({ experiences: [], posts: [entry] }));
    expect(indexes).toEqual({
      hero: "",
      projects: "01",
      experience: "",
      skills: "02",
      writing: "03",
      about: "04",
      contact: "05",
    });
  });
});
