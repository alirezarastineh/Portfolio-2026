import { describe, expect, it } from "vitest";

import type { MediaAsset } from "./admin-api.service";
import type { DraftMarks } from "./change-trace";
import { altInDraft, deleteBlocker, missingAltLabel, usagePlace, usageState } from "./media-usage";

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

const cover = (alt: string) => ({
  projects: [{ slug: "atlas", cover: { src: "/media/a.png", alt } }],
});

/** The live site in both languages, a project's cover the file, with the alt text published. */
const marks = (en: string, de: string): DraftMarks => ({
  paths: { en: [], de: [] },
  live: { en: cover(en), de: cover(de) } as never,
  asked: 0,
});

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
    expect(usagePlace("ui:de")).toEqual({ label: "Words (DE)", link: "/admin/words" });
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

describe("altInDraft", () => {
  const shown = { usage: { draft: ["project:atlas"], live: true, recent: true } };

  it("is in the draft when the live picture carries other words than the saved ones", () => {
    expect(altInDraft(asset(shown), marks("A thing", "Ein Ding"))).toBe(false);
    expect(altInDraft(asset(shown), marks("A thing", "Altes Ding"))).toBe(true);
  });

  it("is in the draft while only the draft uses the file", () => {
    const draftOnly = { usage: { draft: ["project:atlas"], live: false, recent: false } };
    expect(altInDraft(asset(draftOnly), null)).toBe(true);
  });

  it("is not for an unused file, a PDF, nothing known, or no words to compare", () => {
    expect(altInDraft(asset(), marks("Old", "Alt"))).toBe(false);
    expect(altInDraft(asset({ ...shown, kind: "document" }), marks("Old", "Alt"))).toBe(false);
    expect(altInDraft(asset(shown), null)).toBe(false);
    // Neither language has words: the live site shows a fallback (the project's name), not these.
    const none = asset({ ...shown, altEn: "", altDe: null });
    expect(altInDraft(none, marks("Atlas", "Atlas"))).toBe(false);
  });
});
