import { describe, expect, it } from "vitest";

import type { I18nItem } from "./admin-api.service";
import { isHidden, visibleI18n } from "./hidden-fields";

const row = (change: Partial<I18nItem>): I18nItem => ({
  kind: "section",
  id: "ui",
  label: "Site copy",
  missingDe: [],
  missingEn: [],
  stale: false,
  absent: null,
  ...change,
});

describe("isHidden", () => {
  it("names a section's field by its document, anything else by its kind", () => {
    expect(isHidden("section", "ui", "about.subtitle")).toBe(true);
    expect(isHidden("section", "seo", "ogUrl")).toBe(true);
    expect(isHidden("skill", "card", "caption")).toBe(true);
    expect(isHidden("section", "ui", "about.heading")).toBe(false);
    expect(isHidden("skill", "card", "title")).toBe(false);
    // A post's or project's field of the same name is not a section's.
    expect(isHidden("project", "p1", "subtitle")).toBe(false);
    // Read as `category.label`, by the case study and the assistant: the builder renames it.
    expect(isHidden("project", "p1", "categoryLabel")).toBe(false);
  });
});

describe("visibleI18n", () => {
  it("keeps a row's other fields, and drops a row only hidden fields put out of step", () => {
    expect(
      visibleI18n([
        row({ missingDe: ["about.subtitle", "about.heading"] }),
        row({ kind: "skill", id: "card", label: "Backend", missingDe: ["caption"] }),
      ]),
    ).toEqual([row({ missingDe: ["about.heading"] })]);
  });

  it("keeps a row that is stale or missing a language whatever its fields", () => {
    const stale = row({ kind: "skill", id: "card", missingDe: ["caption"], stale: true });
    const absent = row({ kind: "post", id: "w1", absent: "de" });
    expect(visibleI18n([stale, absent])).toEqual([{ ...stale, missingDe: [] }, absent]);
  });
});
