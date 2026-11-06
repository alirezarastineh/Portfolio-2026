import { describe, expect, it } from "vitest";

import { homeSections } from "./home-sections";

const entry = {} as never;

describe("homeSections", () => {
  it("hides experience and writing when they are empty", () => {
    expect(homeSections({ experiences: [], posts: [] })).toEqual([
      "hero",
      "projects",
      "about",
      "skills",
      "contact",
    ]);
  });

  it("keeps every section when there is content for it, the person after the work", () => {
    expect(homeSections({ experiences: [entry], posts: [entry] })).toEqual([
      "hero",
      "projects",
      "about",
      "experience",
      "skills",
      "writing",
      "contact",
    ]);
  });
});
