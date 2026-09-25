import { describe, expect, it } from "vitest";

import { previewedPath, previewTarget } from "./preview-links";

const ORIGIN = "https://alirezarastineh.me";
const at = (href: string) => new URL(href, ORIGIN);

describe("previewTarget", () => {
  it("keeps public pages inside the preview, query and fragment included", () => {
    expect(previewTarget(at("/en/work/atlas"), ORIGIN)).toEqual({
      navigate: "/admin/preview/en/work/atlas",
    });
    expect(previewTarget(at("/de?tag=ai#projects"), ORIGIN)).toEqual({
      navigate: "/admin/preview/de?tag=ai#projects",
    });
  });

  it("opens files, feeds and other sites in a new tab", () => {
    expect(previewTarget(at("/en/resume.pdf"), ORIGIN)).toEqual({
      newTab: `${ORIGIN}/en/resume.pdf`,
    });
    expect(previewTarget(at("/en/rss.xml"), ORIGIN)).toEqual({ newTab: `${ORIGIN}/en/rss.xml` });
    expect(previewTarget(at("/media/x.webp"), ORIGIN)).toEqual({
      newTab: `${ORIGIN}/media/x.webp`,
    });
    expect(previewTarget(at("https://github.com/x"), ORIGIN)).toEqual({
      newTab: "https://github.com/x",
    });
  });

  it("leaves mail links and admin links alone", () => {
    expect(previewTarget(at("mailto:hi@example.com"), ORIGIN)).toBeNull();
    expect(previewTarget(at("/admin/preview/en"), ORIGIN)).toBeNull();
    expect(previewTarget(at("/admin"), ORIGIN)).toBeNull();
  });
});

describe("previewedPath", () => {
  it("strips the preview prefix", () => {
    expect(previewedPath("/admin/preview/de/work/atlas")).toBe("/de/work/atlas");
    expect(previewedPath("/admin/preview")).toBe("/");
  });
});
