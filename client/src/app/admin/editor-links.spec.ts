import { describe, expect, it } from "vitest";

import { editorLinkFor, editorLinkForI18n } from "./editor-links";

describe("editorLinkFor", () => {
  it("sends a list item's problem to its own editor, by the slug in the label", () => {
    expect(editorLinkFor({ path: ["projects", 2, "name"], label: "projects[atlas].name" })).toBe(
      "/admin/projects/atlas",
    );
    expect(editorLinkFor({ path: ["posts", 0, "title"], label: "posts[hello-world].title" })).toBe(
      "/admin/writing/hello-world",
    );
    // An index alone (no slug in the label) still lands on the list.
    expect(editorLinkFor({ path: ["projects", 2, "name"], label: "projects[#2].name" })).toBe(
      "/admin/projects",
    );
  });

  it("maps docs and ui groups to the page that edits them", () => {
    expect(editorLinkFor({ path: ["docs", "project:atlas", "body"] })).toBe(
      "/admin/projects/atlas",
    );
    expect(editorLinkFor({ path: ["docs", "post:hello", "title"] })).toBe("/admin/writing/hello");
    expect(editorLinkFor({ path: ["docs", "legal:imprint", "title"] })).toBe("/admin/legal");
    expect(editorLinkFor({ path: ["ui", "nav", "work"] })).toBe("/admin/hero");
    expect(editorLinkFor({ path: ["ui", "notFound", "title"] })).toBe("/admin/copy");
    expect(editorLinkFor({ path: ["identity", "contactEmail"] })).toBe("/admin/hero");
    expect(editorLinkFor({ path: ["seo", "title"] })).toBe("/admin/seo");
    expect(editorLinkFor({ path: ["version"] })).toBeNull();
  });
});

describe("editorLinkForI18n", () => {
  it("links each kind of item, and a ui field to its group's page", () => {
    expect(editorLinkForI18n({ kind: "project", id: "atlas" })).toBe("/admin/projects/atlas");
    expect(editorLinkForI18n({ kind: "faq", id: "x" })).toBe("/admin/assistant");
    expect(editorLinkForI18n({ kind: "section", id: "privacy" })).toBe("/admin/legal");
    expect(editorLinkForI18n({ kind: "section", id: "ui", missingDe: ["about.philosophy"] })).toBe(
      "/admin/about",
    );
  });
});
