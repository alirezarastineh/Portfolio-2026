import { describe, expect, it } from "vitest";

import { homeSections } from "./home-sections";

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
