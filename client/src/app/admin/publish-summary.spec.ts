import { describe, expect, it } from "vitest";

import type { AppContent } from "../content/schema";
import type { LocaleReview } from "./admin-api.service";
import {
  changeRows,
  changesLabel,
  contentDiff,
  countRows,
  fieldOf,
  summarizeLocale,
  summarizeReview,
} from "./publish-summary";

function review(overrides: Partial<LocaleReview>): LocaleReview {
  return {
    locale: "en",
    issues: [],
    changed: false,
    draft: null,
    live: null,
    liveVersionId: null,
    docs: [],
    ...overrides,
  };
}

const content = (value: unknown) => value as AppContent;

const image = (name: string, alt: string) => ({
  src: `/media/${name}.webp`,
  srcset: `/media/${name}-640.webp 640w`,
  sources: [{ type: "image/webp", srcset: `/media/${name}-640.webp 640w` }],
  width: 640,
  height: name.length,
  alt,
  blur: null,
});

describe("fieldOf", () => {
  it("makes an image's parts the image, its alt text a field of its own", () => {
    expect(fieldOf("projects[atlas].cover.src")).toBe("projects[atlas].cover");
    expect(fieldOf("projects[atlas].cover.sources[0].srcset")).toBe("projects[atlas].cover");
    expect(fieldOf("identity.avatar.blur")).toBe("identity.avatar");
    expect(fieldOf("projects[atlas].cover.alt")).toBe("projects[atlas].cover.alt");
  });

  it("makes an item of a list without ids the list, and keeps an item keyed by a slug of digits", () => {
    expect(fieldOf("socials[1].href")).toBe("socials");
    expect(fieldOf("projects[atlas].metrics[0].value")).toBe("projects[atlas].metrics");
    expect(fieldOf("projects[2024].name")).toBe("projects[2024].name");
    expect(fieldOf("ui.about.bio")).toBe("ui.about.bio");
  });
});

describe("changeRows", () => {
  const live = {
    projects: [
      { slug: "atlas", name: "Atlas", cover: image("a", "Old"), metrics: [{ value: "1" }] },
      { slug: "old", name: "Old one" },
    ],
    socials: [{ label: "GitHub", href: "https://a.example" }],
  };
  const draft = {
    projects: [
      { slug: "atlas", name: "Atlas", cover: image("bb", "New"), metrics: [{ value: "2" }] },
      { slug: "nova", name: "Nova", hook: "Hi" },
    ],
    socials: [{ label: "GitHub", href: "https://b.example" }],
  };

  it("lists a field once, an image once and its alt text apart, a new or removed item once", () => {
    const rows = changeRows(live, draft);
    expect(rows.map((row) => [row.path, row.kind])).toEqual([
      ["projects (order)", "changed"],
      ["projects[atlas].cover", "changed"],
      ["projects[atlas].cover.alt", "changed"],
      ["projects[atlas].metrics", "changed"],
      ["projects[old]", "removed"],
      ["socials", "changed"],
      ["projects[nova]", "added"],
    ]);
    // Every difference stays behind its row: none is dropped.
    expect(rows.flatMap((row) => row.entries)).toHaveLength(contentDiff(live, draft).length);
  });

  it("says changed for an image set where there was none, not added", () => {
    const rows = changeRows(
      { projects: [{ slug: "atlas", cover: null }] },
      { projects: [{ slug: "atlas", cover: image("a", "A") }] },
    );
    expect(rows.map((row) => [row.path, row.kind])).toEqual([
      ["projects[atlas].cover", "changed"],
      ["projects[atlas].cover.alt", "added"],
    ]);
  });

  it("adds each doc as one row, its page", () => {
    const doc = { key: "project:atlas", change: "changed" as const, draft: null, live: null };
    expect(changeRows({}, {}, [doc])).toEqual([
      { path: "project:atlas", kind: "changed", entries: [], doc },
    ]);
  });
});

describe("countRows", () => {
  it("counts rows, not a list's new order beside the items that moved", () => {
    const rows = changeRows({ projects: [] }, { projects: [{ slug: "atlas", name: "Atlas" }] }, [
      { key: "post:a", change: "added", draft: null, live: null },
      { key: "post:b", change: "added", draft: null, live: null },
    ]);
    expect(countRows(rows, true)).toBe(3);
  });

  it("still counts a reorder on its own: visitors see it", () => {
    const rows = changeRows(
      { projects: [{ slug: "a" }, { slug: "b" }] },
      { projects: [{ slug: "b" }, { slug: "a" }] },
    );
    expect(countRows(rows, true)).toBe(1);
  });

  it("is 0 when nothing changed", () => {
    expect(countRows([], false)).toBe(0);
  });
});

describe("summarizeLocale", () => {
  it("diffs the draft against what is live", () => {
    const summary = summarizeLocale(
      review({
        changed: true,
        live: content({ ui: { hero: "Old", nav: "Same" } }),
        draft: content({ ui: { hero: "New", nav: "Same" } }),
        docs: [{ key: "post:hello", change: "added", draft: null, live: null }],
      }),
    );
    expect(summary).toEqual({ locale: "en", changes: 2, issues: 0 });
  });

  it("counts every field as new before the first publish, and nothing for the empty side", () => {
    const summary = summarizeLocale(
      review({ changed: true, live: null, draft: content({ ui: { a: "1", b: "2" } }) }),
    );
    expect(summary.changes).toBe(2);
    expect(contentDiff(null, { ui: { a: "1" } })).toEqual([
      { path: "ui.a", kind: "added", after: "1" },
    ]);
  });

  /** A draft that does not build has no diff, only the problems that stop it. */
  it("reports the problems of a draft that does not build", () => {
    const summary = summarizeLocale(
      review({
        locale: "de",
        changed: true,
        draft: null,
        issues: [{ path: ["ui"], message: "Required", label: "ui.hero" }],
      }),
    );
    expect(summary).toEqual({ locale: "de", changes: 0, issues: 1 });
  });
});

describe("summarizeReview", () => {
  it("adds up both languages", () => {
    const summary = summarizeReview({
      canPublish: true,
      locales: [
        review({ changed: true, live: content({ a: "1" }), draft: content({ a: "2" }) }),
        review({
          locale: "de",
          changed: true,
          live: content({ a: "1", b: "1" }),
          draft: content({ a: "2", b: "2" }),
        }),
      ],
    });
    expect(summary).toEqual({
      locales: [
        { locale: "en", changes: 1, issues: 0 },
        { locale: "de", changes: 2, issues: 0 },
      ],
      total: 3,
      issues: 0,
      canPublish: true,
    });
  });
});

describe("changesLabel", () => {
  it("says change or changes", () => {
    expect(changesLabel(1)).toBe("1 change");
    expect(changesLabel(4)).toBe("4 changes");
  });
});
