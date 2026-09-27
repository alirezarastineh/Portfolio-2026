import { describe, expect, it } from "vitest";

import { editDistance, suggestPages, type PageSuggestion } from "./did-you-mean";

const PAGES: PageSuggestion[] = [
  { path: "/en/writing", label: "Writing" },
  { path: "/en/work/project-one", label: "Project One" },
  { path: "/en/work/project-two", label: "Project Two" },
  { path: "/en/writing/shipping-rag-to-production", label: "Shipping RAG to production" },
  { path: "/en/legal/imprint", label: "Imprint" },
  { path: "/en/legal/privacy", label: "Privacy" },
];

const paths = (typed: string) => suggestPages(typed, PAGES).map((page) => page.path);

describe("editDistance", () => {
  it("counts insertions, deletions and substitutions", () => {
    expect(editDistance("", "")).toBe(0);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("writing", "wrting")).toBe(1);
    expect(editDistance("abc", "")).toBe(3);
  });
});

describe("suggestPages", () => {
  it("finds a typo anywhere in the path, in any case, with a trailing slash or query", () => {
    expect(paths("/en/wrting")).toEqual(["/en/writing"]);
    expect(paths("/EN/Legal/Imprnt/?ref=mail")[0]).toBe("/en/legal/imprint");
  });

  it("finds the right slug under the wrong section", () => {
    expect(paths("/en/project-one")[0]).toBe("/en/work/project-one");
  });

  it("finds the page a truncated link was cut from", () => {
    expect(paths("/en/writing/shipping-rag")).toEqual(["/en/writing/shipping-rag-to-production"]);
  });

  it("ranks the nearest first and stops at the limit", () => {
    expect(paths("/en/work/project-on")[0]).toBe("/en/work/project-one");
    expect(suggestPages("/en/work", PAGES, 1)).toHaveLength(1);
  });

  it("suggests nothing for an address like nothing on the site", () => {
    expect(paths("/en/does-not-exist")).toEqual([]);
    expect(paths("/de/gibt-es-nicht")).toEqual([]);
    expect(paths("/en/x")).toEqual([]);
  });
});
