import { describe, expect, it } from "vitest";

import { diffJson } from "./json-diff";

describe("diffJson", () => {
  it("reports nothing for identical documents", () => {
    const doc = { ui: { hero: "Hi" }, projects: [{ slug: "a", name: "A" }] };
    expect(diffJson(doc, structuredClone(doc))).toEqual([]);
  });

  it("reports a changed leaf by its dotted path", () => {
    expect(diffJson({ ui: { hero: "Old" } }, { ui: { hero: "New" } })).toEqual([
      { path: "ui.hero", kind: "changed", before: "Old", after: "New" },
    ]);
  });

  it("reports added and removed keys", () => {
    expect(diffJson({ a: "1" }, { b: "2" })).toEqual([
      { path: "a", kind: "removed", before: "1" },
      { path: "b", kind: "added", after: "2" },
    ]);
  });

  /** A reorder is one change, not every field of every project shifting. */
  it("keys object lists by slug, so a reorder is a single order change", () => {
    const before = { projects: [{ slug: "a", name: "A" }, { slug: "b", name: "B" }] };
    const after = { projects: [{ slug: "b", name: "B" }, { slug: "a", name: "A" }] };

    expect(diffJson(before, after)).toEqual([
      { path: "projects (order)", kind: "changed", before: "a, b", after: "b, a" },
    ]);
  });

  it("addresses fields inside a keyed list by slug", () => {
    const before = { projects: [{ slug: "a", name: "A" }] };
    const after = { projects: [{ slug: "a", name: "A2" }] };

    expect(diffJson(before, after)).toEqual([
      { path: "projects[a].name", kind: "changed", before: "A", after: "A2" },
    ]);
  });

  it("treats a list of plain values as one leaf", () => {
    expect(diffJson({ stack: ["Angular", "Go"] }, { stack: ["Go"] })).toEqual([
      { path: "stack", kind: "changed", before: '["Angular","Go"]', after: '["Go"]' },
    ]);
  });

  it("falls back to indexes for object lists without an identity", () => {
    const before = { socials: [{ label: "GitHub" }] };
    const after = { socials: [{ label: "GitLab" }] };

    expect(diffJson(before, after)).toEqual([
      { path: "socials[0].label", kind: "changed", before: "GitHub", after: "GitLab" },
    ]);
  });

  it("distinguishes non-string values from their string spelling", () => {
    expect(diffJson({ v: 1 }, { v: "1" })).toEqual([
      { path: "v", kind: "changed", before: "1", after: "1" },
    ]);
    expect(diffJson({ v: true }, { v: false })).toEqual([
      { path: "v", kind: "changed", before: "true", after: "false" },
    ]);
  });
});
