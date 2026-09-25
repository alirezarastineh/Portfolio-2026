import { FormControl, FormGroup } from "@angular/forms";
import { describe, expect, it } from "vitest";

import { applyIssues, countServerErrors, FieldIssues, issueSummary } from "./issues";

describe("FieldIssues", () => {
  it("keys issues by path, first message per field, with a prefix taken off", () => {
    const issues = new FieldIssues();
    issues.set(
      [
        { path: ["groups", "translations", "de", "name"], message: "Required" },
        { path: ["groups", "translations", "de", "name"], message: "second" },
        { path: ["groups", "slug"], message: "Taken" },
      ],
      ["groups"],
    );
    expect(issues.get("translations.de.name")).toBe("Required");
    expect(issues.get("slug")).toBe("Taken");
    expect(issues.count()).toBe(2);
  });

  it("finds a message inside a list, and drops a field's messages once it is edited", () => {
    const issues = new FieldIssues();
    issues.set([
      { path: ["translations", "en", "metrics", 1, "label"], message: "Required" },
      { path: ["translations", "en", "name"], message: "Required" },
    ]);
    expect(issues.under("translations.en.metrics")).toBe("Required");
    expect(issues.under("translations.de.metrics")).toBeNull();

    issues.resolve("translations.en.metrics");
    expect(issues.under("translations.en.metrics")).toBeNull();
    expect(issues.count()).toBe(1);
  });
});

describe("applyIssues", () => {
  it("puts each issue on its control until the value changes, and returns the rest", () => {
    const form = new FormGroup({
      en: new FormGroup({ title: new FormControl("") }),
      de: new FormGroup({ title: new FormControl("") }),
    });
    const unplaced = applyIssues(
      [
        { path: ["de", "title"], message: "Required" },
        { path: ["de", "missing"], message: "Nowhere" },
      ],
      ([locale, key]) => form.get(`${String(locale)}.${String(key)}`),
    );

    expect(form.get("de.title")?.errors).toEqual({ server: "Required" });
    expect(unplaced.map((i) => i.message)).toEqual(["Nowhere"]);
    expect(countServerErrors(form)).toBe(1);

    form.get("de.title")?.setValue("Titel");
    expect(form.get("de.title")?.errors).toBeNull();
    expect(countServerErrors(form)).toBe(0);
  });
});

describe("issueSummary", () => {
  it("names the first problem and counts the rest", () => {
    expect(
      issueSummary([
        { path: ["projects", 0, "name"], label: "projects[atlas].name", message: "Required" },
        { path: ["seo", "title"], message: "Required" },
      ]),
    ).toBe("projects[atlas].name: Required (and 1 more)");
    expect(issueSummary([])).toBe("");
  });
});
