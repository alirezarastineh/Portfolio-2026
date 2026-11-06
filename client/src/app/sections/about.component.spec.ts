import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signal, type Signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it } from "vitest";

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
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ContentStore, useValue: new StubContentStore() }, provideRouter([])],
    });
  });

  /**
   * Regression test: the text once came from a field initializer, which
   * snapshotted the copy, so the section kept English after a switch to German.
   */
  it("re-renders the text when the language changes", async () => {
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

  /** The `<h2>` holds the CMS heading, and the section is labelled by it. */
  it("renders the localized heading and is labelled by it", async () => {
    const fixture = TestBed.createComponent(AboutSectionComponent);
    const language = TestBed.inject(LanguageService);
    fixture.detectChanges();
    await fixture.whenStable();

    const heading = () => fixture.nativeElement.querySelector("h2") as HTMLElement;
    expect(heading().textContent?.trim()).toBe("About");
    expect(fixture.nativeElement.querySelector("section").getAttribute("aria-labelledby")).toBe(
      heading().id,
    );

    language.activate("de");
    fixture.detectChanges();
    await fixture.whenStable();

    expect(heading().textContent?.trim()).toBe("Über mich");
  });

  it("leaves out what the content lacks: without a photo, no frame and no initials", async () => {
    // The seed: no bio, no photo, no experience, no city.
    const fixture = TestBed.createComponent(AboutSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).not.toContain("AR");
    expect([...root.querySelectorAll("dt")].map((dt) => dt.textContent?.trim())).toEqual([
      "Based in",
      "Status",
    ]);
    expect(root.querySelector("dd")?.textContent?.trim()).toBe("Remote");
  });

  it("shows a portrait in black and white, 4:5, when there is one", async () => {
    const store = TestBed.inject(ContentStore) as unknown as StubContentStore;
    store.state.en.update((content) => ({
      ...content,
      identity: {
        ...content.identity,
        avatar: {
          src: "/media/portrait.jpg",
          srcset: "",
          sources: [],
          width: 800,
          height: 1000,
          alt: "Alireza Rastineh",
          blur: null,
        },
      },
    }));
    const fixture = TestBed.createComponent(AboutSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const portrait = fixture.nativeElement.querySelector("img") as HTMLImageElement;
    expect(portrait.alt).toBe("Alireza Rastineh");
    expect(portrait.className).toContain("grayscale");
    expect(portrait.className).toContain("aspect-[4/5]");
  });

  it("says how an answer is made, as text on the line, in both languages", async () => {
    const fixture = TestBed.createComponent(AboutSectionComponent);
    const language = TestBed.inject(LanguageService);
    fixture.detectChanges();
    await fixture.whenStable();
    const figure = () => fixture.nativeElement.querySelector("figure") as HTMLElement;
    const steps = () =>
      [...figure().querySelectorAll("li > span:first-child")].map((s) => s.textContent);

    expect(figure().querySelector("figcaption")?.textContent?.trim()).toBe("How an answer is made");
    expect(steps()).toEqual(["Question", "Search", "Answer", "Check"]);
    // No model name: which model answers is the receipt's to say, per answer.
    expect(figure().textContent).not.toMatch(/gemini|gpt|claude|llama/i);

    language.activate("de");
    fixture.detectChanges();
    await fixture.whenStable();
    expect(figure().querySelector("figcaption")?.textContent?.trim()).toBe(
      "Wie eine Antwort entsteht",
    );
    expect(steps()).toEqual(["Frage", "Suche", "Antwort", "Prüfung"]);
  });

  it("says how he works as prose, with no terminal around it (plan 4 U10)", async () => {
    const fixture = TestBed.createComponent(AboutSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector("#about > div > div > p")?.textContent).toContain(
      "Building AI applications in a Jupyter notebook is easy",
    );
    expect(root.textContent).not.toContain("cat philosophy.txt");
    expect(root.querySelector("app-terminal-window, app-ask-console")).toBeNull();
  });
});
