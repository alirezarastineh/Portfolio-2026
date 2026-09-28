import { describe, expect, it } from "vitest";

import type { MediaAsset } from "./admin-api.service";
import { deleteBlocker, missingAltLabel, usagePlace, usageState } from "./media-usage";

function asset(change: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "a",
    filename: "a.png",
    originalName: "a.png",
    mime: "image/png",
    kind: "image",
    byteSize: 1,
    width: 1,
    height: 1,
    blurDataUri: null,
    altEn: "A thing",
    altDe: "Ein Ding",
    createdAt: "",
    url: "",
    path: "/media/a.png",
    variants: [],
    usage: { draft: [], live: false, recent: false },
    ...change,
  };
}

describe("usagePlace", () => {
  it("names each place the API reports, with the editor that changes it", () => {
    expect(usagePlace("project:atlas (gallery)")).toEqual({
      label: "Project atlas, gallery",
      link: "/admin/projects/atlas",
    });
    expect(usagePlace("project:atlas").link).toBe("/admin/projects/atlas");
    expect(usagePlace("post:hello world")).toEqual({
      label: "Post hello world",
      link: "/admin/writing/hello%20world",
    });
    expect(usagePlace("profile:avatar")).toEqual({ label: "Your photo", link: "/admin/hero" });
    expect(usagePlace("resume:de").label).toBe("CV (DE)");
    expect(usagePlace("experience:ACME: Labs")).toEqual({
      label: "Experience: ACME: Labs",
      link: "/admin/experience",
    });
    expect(usagePlace("privacy:en")).toEqual({ label: "Privacy (EN)", link: "/admin/legal" });
    expect(usagePlace("ui:de")).toEqual({ label: "Page copy (DE)", link: "/admin/copy" });
    expect(usagePlace("something:else")).toEqual({ label: "something:else", link: null });
  });
});

describe("missingAltLabel", () => {
  it("says which language still lacks a description, and nothing for a PDF", () => {
    expect(missingAltLabel(asset())).toBeNull();
    expect(missingAltLabel(asset({ altDe: " " }))).toBe("no alt DE");
    expect(missingAltLabel(asset({ altEn: null, altDe: null }))).toBe("no alt");
    expect(missingAltLabel(asset({ kind: "document", altEn: null, altDe: null }))).toBeNull();
  });
});

describe("usageState and deleteBlocker", () => {
  it("tells live, draft-only and unused files apart, and says what blocks a delete", () => {
    expect(usageState(asset())).toBe("unused");
    expect(deleteBlocker(asset())).toBeNull();
    const draft = asset({ usage: { draft: ["project:atlas"], live: false, recent: true } });
    expect(usageState(draft)).toBe("draft");
    expect(deleteBlocker(draft)).toMatch(/draft uses it/);
    const live = asset({ usage: { draft: [], live: true, recent: true } });
    expect(usageState(live)).toBe("live");
    expect(deleteBlocker(live)).toMatch(/live site/);
    expect(usageState(asset({ usage: undefined }))).toBe("unknown");
  });
});
