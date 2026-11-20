import { describe, expect, it } from "vitest";

import { VIEWS, viewOf, viewParam } from "./assistant-views";

describe("the Assistant's views", () => {
  it("names seven views, Now first", () => {
    expect(VIEWS.map((view) => view.label)).toEqual([
      "Now",
      "Conversations",
      "Reviews",
      "Questions",
      "Journal",
      "Quality",
      "Settings",
    ]);
  });

  it("reads each view back from its address, Now from none", () => {
    for (const { id } of VIEWS) {
      expect(viewOf(viewParam(id))).toBe(id);
    }
    expect(viewParam("now")).toBeNull();
    expect(viewParam("quality")).toBe("quality");
  });

  it("lands each of the eleven tabs' old names on the view that holds it", () => {
    const names = [
      "overview",
      "settings",
      "faq",
      "conversations",
      "reviews",
      "insights",
      "playground",
      "evals",
      "journal",
      "copilot",
      "trust",
    ];
    expect(Object.fromEntries(names.map((name) => [name, viewOf(name)]))).toEqual({
      overview: "now",
      settings: "settings",
      faq: "questions",
      conversations: "conversations",
      reviews: "reviews",
      insights: "questions",
      playground: "now",
      evals: "quality",
      journal: "journal",
      copilot: "quality",
      trust: "now",
    });
  });

  it("lands anything else on Now", () => {
    for (const name of ["", "now", "Reviews", "constructor", "toString", "../settings"]) {
      expect(viewOf(name)).toBe("now");
    }
  });
});
