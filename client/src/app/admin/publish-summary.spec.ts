import { describe, expect, it } from "vitest";

import type { AppContent } from "../content/schema";
import type { LocaleReview } from "./admin-api.service";
import {
  changesLabel,
  contentDiff,
  countChanges,
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

describe("countChanges", () => {
  it("counts fields and pages, not a list's new order beside the items that moved", () => {
    const core = [
      { path: "projects (order)", kind: "changed" as const },
      { path: "projects[atlas].name", kind: "added" as const },
    ];
    expect(countChanges(core, 2, true)).toBe(3);
  });

  it("still counts a reorder on its own: visitors see it", () => {
    expect(countChanges([{ path: "projects (order)", kind: "changed" }], 0, true)).toBe(1);
  });

  it("is 0 when nothing changed", () => {
    expect(countChanges([], 0, false)).toBe(0);
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
