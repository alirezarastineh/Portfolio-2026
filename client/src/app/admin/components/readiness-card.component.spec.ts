import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it } from "vitest";

import { appContentSchema, type AppContent, type Locale } from "../../content/schema";
import { AdminApiService, type ApiResult, type I18nItem } from "../admin-api.service";
import { AdminPulseService } from "../pulse.service";
import { ReadinessCardComponent } from "./readiness-card.component";

const here = dirname(fileURLToPath(import.meta.url));
const load = (locale: Locale): AppContent =>
  appContentSchema.parse(
    JSON.parse(readFileSync(resolve(here, `../../content/fallback.${locale}.json`), "utf8")),
  );

type Preview = ApiResult<AppContent>;

const item = (id: string, label: string, missingDe: string[]): I18nItem => ({
  kind: "project",
  id,
  label,
  missingDe,
  missingEn: [],
  stale: false,
  absent: null,
});

async function render(previews: Record<Locale, Preview>, i18n: I18nItem[] = []) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AdminApiService,
        useValue: { preview: async (locale: Locale) => previews[locale] },
      },
      // The rail's list of translations to check: Before launch counts the same one.
      { provide: AdminPulseService, useValue: { i18n: signal(i18n) } },
    ],
  });
  const fixture = TestBed.createComponent(ReadinessCardComponent);
  fixture.detectChanges();
  // Its own load (not a pending task): let the stubbed answers arrive.
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  return fixture;
}

const both = () =>
  ({ en: { ok: true, data: load("en") }, de: { ok: true, data: load("de") } }) as Record<
    Locale,
    Preview
  >;
const doesNotBuild: Preview = { ok: false, error: "invalid_draft", status: 422 };
const text = (el: Element | null | undefined) =>
  el?.textContent?.replaceAll(/\s+/g, " ").trim() ?? "";
const rows = (root: HTMLElement) => [...root.querySelectorAll(":scope ul > li > :is(a, button)")];

describe("ReadinessCardComponent (Today's Before launch)", () => {
  it("lists every failing rule as a row, worst first, whose Fix opens the first place's editor", async () => {
    const fixture = await render(both());
    const root: HTMLElement = fixture.nativeElement;

    expect(text(root.querySelector("h2"))).toBe("Before launch");
    expect([...root.querySelectorAll("p")].map(text)).toContainEqual(
      expect.stringMatching(/^\d+ of 11 ready$/),
    );
    const first = rows(root)[0]!;
    expect(text(first)).toMatch(/^Placeholder text \(\d+\) fix before sharing Fix$/);
    expect(first.getAttribute("href")).toBe("/admin/projects/project-one");
    expect(rows(root).map(text)).toContain("No experience worth fixing Fix");
  });

  it("keeps the nice-to-haves as rows, after the urgent ones", async () => {
    const fixture = await render(both());
    const words = rows(fixture.nativeElement).map(text);
    const tip = words.findIndex((w) => w.includes("nice to have"));
    expect(tip).toBeGreaterThan(words.findIndex((w) => w.includes("worth fixing")));
    expect(words).toContain("No posts nice to have Fix");
  });

  it("unfolds the translations to check in place, each with the editor that holds it", async () => {
    const fixture = await render(both(), [
      item("p1", "Atlas", ["hook"]),
      item("p2", "Release gate", ["hook", "role"]),
    ]);
    const root: HTMLElement = fixture.nativeElement;
    const show = [...root.querySelectorAll("button")].find((b) =>
      text(b).startsWith("2 translations to check"),
    )!;
    expect(show.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector('a[href="/admin/projects/p2"]')).toBeNull();

    show.click();
    fixture.detectChanges();
    expect(show.getAttribute("aria-expanded")).toBe("true");
    expect(text(root.querySelector('a[href="/admin/projects/p2"]'))).toBe(
      "Release gate, project: German empty: hook, role Edit",
    );
  });

  it("checks the language that builds, and says which one it could not", async () => {
    const fixture = await render({ en: { ok: true, data: load("en") }, de: doesNotBuild });
    expect(text(fixture.nativeElement)).toContain(
      "The German draft does not build, so it was not checked.",
    );
    expect(text(fixture.nativeElement)).toContain("Placeholder text");
  });

  it("offers to try again when the API does not answer", async () => {
    const down: Preview = { ok: false, error: "http_500", status: 500 };
    const fixture = await render({ en: down, de: down });
    expect(rows(fixture.nativeElement).map(text)).toEqual(["Could not check the draft. Try again"]);
  });
});
