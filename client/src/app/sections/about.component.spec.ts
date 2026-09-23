import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signal, type Signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ContentStore } from "../content/content.store";
import { appContentSchema, type AppContent, type Locale } from "../content/schema";
import { LanguageService } from "../services/language.service";
import { AboutSectionComponent } from "./about.component";

const here = dirname(fileURLToPath(import.meta.url));

function fallback(locale: Locale): AppContent {
  const raw = readFileSync(resolve(here, `../content/fallback.${locale}.json`), "utf8");
  return appContentSchema.parse(JSON.parse(raw));
}

class StubContentStore {
  readonly state: Record<Locale, ReturnType<typeof signal<AppContent>>> = {
    en: signal(fallback("en")),
    de: signal(fallback("de")),
  };
  content(locale: Locale): Signal<AppContent> {
    return this.state[locale].asReadonly();
  }
}

describe("AboutSectionComponent", () => {
  beforeAll(() => {
    // jsdom has neither; the component guards matchMedia but constructs an
    // IntersectionObserver directly once it believes it is in a browser.
    globalThis.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof IntersectionObserver;

    globalThis.matchMedia ??= ((query: string) =>
      ({
        matches: true, // report reduced motion so the typewriter resolves instantly
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof globalThis.matchMedia;
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ContentStore, useValue: new StubContentStore() }, provideRouter([])],
    });
  });

  /**
   * Regression test. `lines` used to be a field initializer
   * (`readonly lines = this.buildLines()`), which snapshotted the copy once —
   * so the terminal kept rendering English after switching to German. It is a
   * computed now, kept in step by an effect.
   */
  it("re-renders the terminal when the language changes", async () => {
    const fixture = TestBed.createComponent(AboutSectionComponent);
    const language = TestBed.inject(LanguageService);
    fixture.detectChanges();
    await fixture.whenStable();

    const english = fixture.nativeElement.textContent as string;
    expect(english).toContain("Building AI applications");
    expect(english).not.toContain("KI-Anwendungen");

    language.activate("de");
    fixture.detectChanges();
    await fixture.whenStable();

    const german = fixture.nativeElement.textContent as string;
    expect(german).toContain("KI-Anwendungen");
    expect(german).not.toContain("Building AI applications");
  });

  /**
   * The CMS heading is `// about`: the slashes are decoration, so the `<h2>`
   * holds only the name and the section is labelled by it.
   */
  it("renders the localized heading without the comment slashes", async () => {
    const fixture = TestBed.createComponent(AboutSectionComponent);
    const language = TestBed.inject(LanguageService);
    fixture.detectChanges();
    await fixture.whenStable();

    const heading = () => fixture.nativeElement.querySelector("h2") as HTMLElement;
    expect(heading().textContent?.trim()).toBe("about");
    expect(fixture.nativeElement.querySelector("section").getAttribute("aria-labelledby")).toBe(
      heading().id,
    );

    language.activate("de");
    fixture.detectChanges();
    await fixture.whenStable();

    expect(heading().textContent?.trim()).toBe("über mich");
  });

  it("renders every line in full before any typing, as the server does", async () => {
    const fixture = TestBed.createComponent(AboutSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("cat contact.txt");
    expect(text).toContain("Open to senior full-stack and AI engineering roles");
    // Nothing is held back for the typewriter.
    const hidden = [...fixture.nativeElement.querySelectorAll(".invisible")] as HTMLElement[];
    expect(hidden.filter((el) => el.textContent?.trim())).toEqual([]);
  });
});
