import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it } from "vitest";

import { appContentSchema, type AppContent, type Locale } from "../../content/schema";
import { AdminApiService, type ApiResult } from "../admin-api.service";
import { ReadinessCardComponent } from "./readiness-card.component";

const here = dirname(fileURLToPath(import.meta.url));
const load = (locale: Locale): AppContent =>
  appContentSchema.parse(
    JSON.parse(readFileSync(resolve(here, `../../content/fallback.${locale}.json`), "utf8")),
  );

type Preview = ApiResult<AppContent>;

async function render(previews: Record<Locale, Preview>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AdminApiService,
        useValue: { preview: async (locale: Locale) => previews[locale] },
      },
    ],
  });
  const fixture = TestBed.createComponent(ReadinessCardComponent);
  fixture.detectChanges();
  // Its own load (not a pending task): let the stubbed answers arrive.
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  return fixture;
}

const doesNotBuild: Preview = { ok: false, error: "invalid_draft", status: 422 };
const text = (fixture: { nativeElement: HTMLElement }) =>
  fixture.nativeElement.textContent?.replaceAll(/\s+/g, " ") ?? "";

describe("ReadinessCardComponent", () => {
  it("lists what the seed content still lacks, placeholders first, each with an editor link", async () => {
    const fixture = await render({
      en: { ok: true, data: load("en") },
      de: { ok: true, data: load("de") },
    });
    const root: HTMLElement = fixture.nativeElement;

    expect(text(fixture)).toMatch(/\d+ \/ 11 ready/);
    const titles = [...root.querySelectorAll("li .font-medium")].map((el) => el.textContent);
    expect(titles[0]).toBe("Placeholder text");
    expect(titles).toContain("No experience");

    const edit = root.querySelector<HTMLAnchorElement>('a[href="/admin/projects/project-one"]');
    expect(edit).not.toBeNull();
  });

  it("folds the nice-to-haves while something more urgent is open", async () => {
    const fixture = await render({
      en: { ok: true, data: load("en") },
      de: { ok: true, data: load("de") },
    });
    const tips = [...(fixture.nativeElement as HTMLElement).querySelectorAll("details")].find(
      (details) => details.querySelector("summary")?.textContent?.includes("nice to have"),
    );
    expect(tips?.open).toBe(false);
    expect(tips?.textContent).toContain("No posts");
  });

  it("shows a few places per check, and all of them on request", async () => {
    const fixture = await render({
      en: { ok: true, data: load("en") },
      de: { ok: true, data: load("de") },
    });
    const root: HTMLElement = fixture.nativeElement;
    const places = () => root.querySelectorAll("li li code").length;
    const before = places();

    const showAll = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Show all"),
    );
    expect(showAll?.getAttribute("aria-expanded")).toBe("false");
    showAll!.click();
    fixture.detectChanges();

    expect(showAll?.getAttribute("aria-expanded")).toBe("true");
    expect(places()).toBeGreaterThan(before);
  });

  it("checks the language that builds, and says which one it could not", async () => {
    const fixture = await render({ en: { ok: true, data: load("en") }, de: doesNotBuild });
    expect(text(fixture)).toContain("The German draft does not build, so it was not checked.");
    expect(text(fixture)).toContain("Placeholder text");
  });

  it("offers to try again when the API does not answer", async () => {
    const down: Preview = { ok: false, error: "http_500", status: 500 };
    const fixture = await render({ en: down, de: down });
    expect(text(fixture)).toContain("Could not check the draft.");
    expect(text(fixture)).toContain("Try again");
  });
});
