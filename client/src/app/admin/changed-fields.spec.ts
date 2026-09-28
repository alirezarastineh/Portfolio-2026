import { describe, expect, it } from "vitest";

import { changedFieldsLabel, countChangedFields } from "./changed-fields";

describe("countChangedFields", () => {
  const saved = {
    slug: "atlas",
    coverId: "a",
    coverPath: "/media/a.png",
    stack: ["Angular", "Hono"],
    translations: {
      en: { name: "Atlas", hook: "Search", metrics: [{ value: "40%", label: "faster" }] },
      de: { name: "Atlas", hook: "Suche", metrics: [] },
    },
  };

  it("is 0 for the same values, even as different objects", () => {
    expect(countChangedFields(saved, structuredClone(saved))).toBe(0);
  });

  it("counts each nested field once", () => {
    const edited = structuredClone(saved);
    edited.slug = "atlas-2";
    edited.translations.en.hook = "Search, better";
    edited.translations.de.hook = "Bessere Suche";
    expect(countChangedFields(saved, edited)).toBe(3);
  });

  it("counts a list as one field, however much of it changed", () => {
    const edited = structuredClone(saved);
    edited.stack = ["Angular", "Hono", "Postgres", "Drizzle"];
    edited.translations.en.metrics = [];
    expect(countChangedFields(saved, edited)).toBe(2);
  });

  it("leaves out keys derived from others", () => {
    const edited = { ...structuredClone(saved), coverId: "b", coverPath: "/media/b.png" };
    expect(countChangedFields(saved, edited)).toBe(2);
    expect(countChangedFields(saved, edited, ["coverPath"])).toBe(1);
  });

  it("counts a translation switched on or off as one change", () => {
    const post = { slug: "x", translations: { en: { title: "Hi" }, de: null } };
    const withGerman = { ...post, translations: { ...post.translations, de: { title: "" } } };
    expect(countChangedFields(post, withGerman)).toBe(1);
  });

  it("reads a missing optional key as empty", () => {
    expect(countChangedFields({ bio: undefined }, { bio: null })).toBe(0);
    expect(countChangedFields({}, { bio: "Hello" })).toBe(1);
  });
});

describe("changedFieldsLabel", () => {
  it("says field or fields", () => {
    expect(changedFieldsLabel(1)).toBe("1 field changed");
    expect(changedFieldsLabel(3)).toBe("3 fields changed");
  });
});
