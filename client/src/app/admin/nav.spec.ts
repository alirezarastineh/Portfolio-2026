import { describe, expect, it } from "vitest";

import { crumbsFor, navItemFor, PAGES, remember, titleFor } from "./nav";

describe("the shell's pages", () => {
  it("finds the most specific page, and only on a path boundary", () => {
    expect(navItemFor("/admin")?.label).toBe("Today");
    expect(navItemFor("/admin/projects/project-one")?.label).toBe("Work");
    expect(navItemFor("/admin/agent")?.label).toBe("Content agent");
    expect(navItemFor("/admin/projectsx")).toBeNull();
    expect(navItemFor("/admin/nowhere")).toBeNull();
  });

  it("leads the breadcrumb with the parent and ends with the slug, as a value", () => {
    expect(crumbsFor("/admin/agent")).toEqual([
      { label: "Assistant", path: "/admin/assistant" },
      { label: "Content agent", path: "/admin/agent" },
    ]);
    expect(crumbsFor("/admin/writing/shipping%20llms")).toEqual([
      { label: "Writing", path: "/admin/writing" },
      { label: "shipping llms", path: "/admin/writing/shipping%20llms", value: true },
    ]);
    expect(crumbsFor("/admin")).toEqual([{ label: "Today", path: "/admin" }]);
  });

  it("titles a tab with the page first", () => {
    expect(titleFor("/admin/projects/project-one")).toBe("project-one · Work · Admin");
    expect(titleFor("/admin/agent")).toBe("Content agent · Assistant · Admin");
    expect(titleFor("/admin/nowhere")).toBe("Admin");
  });

  it("has every page once", () => {
    const paths = PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps recent entries newest first, each once, up to the limit", () => {
    const a = { key: "a" };
    const b = { key: "b" };
    const c = { key: "c" };
    expect(remember([a, b], b)).toEqual([b, a]);
    expect(remember([a, b], c, 2)).toEqual([c, a]);
  });
});
