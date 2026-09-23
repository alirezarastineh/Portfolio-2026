import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Component, signal, type Signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { beforeEach, describe, expect, it } from "vitest";

import { ContentStore } from "../content/content.store";
import { appContentSchema, type AppContent, type Locale } from "../content/schema";
import { LanguageService } from "./language.service";

const here = dirname(fileURLToPath(import.meta.url));

function fallback(locale: Locale): AppContent {
  const raw = readFileSync(resolve(here, `../content/fallback.${locale}.json`), "utf8");
  return appContentSchema.parse(JSON.parse(raw));
}

/** Stands in for the HTTP-backed store so these tests never touch the network. */
class StubContentStore {
  readonly state: Record<Locale, ReturnType<typeof signal<AppContent | null>>> = {
    en: signal<AppContent | null>(fallback("en")),
    de: signal<AppContent | null>(fallback("de")),
  };

  content(locale: Locale): Signal<AppContent | null> {
    return this.state[locale].asReadonly();
  }
}

@Component({ template: "" })
class Blank {}

function setup() {
  const store = new StubContentStore();
  TestBed.configureTestingModule({
    providers: [
      { provide: ContentStore, useValue: store },
      provideRouter([{ path: "**", component: Blank }]),
    ],
  });
  return { store, service: TestBed.inject(LanguageService), router: TestBed.inject(Router) };
}

describe("LanguageService", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    try {
      document.cookie = "portfolio-lang=; Path=/; Max-Age=0";
    } catch {
      // Cookies are unavailable in some environments; the service tolerates it.
    }
  });

  it("starts in English until a locale route activates one", () => {
    expect(setup().service.lang()).toBe("en");
  });

  it("switches the copy tree when a locale is activated", () => {
    const { service } = setup();
    const before = service.t().about.heading;

    service.activate("de");

    expect(service.lang()).toBe("de");
    expect(service.t().about.heading).not.toBe(before);
    expect(service.t().about.heading).toContain("über mich");
  });

  it("exposes structural content for the active locale", () => {
    const { service } = setup();
    service.activate("de");
    expect(service.content().skills[0]!.title).toBe("Kernarchitektur");
  });

  /** Reading content outside the locale route is a bug; it must say so, not render blanks. */
  it("fails loudly when content is read before its locale loaded", () => {
    const { service, store } = setup();
    store.state.de.set(null);
    service.activate("de");

    expect(() => service.content()).toThrow(/before the locale route loaded it/);
  });

  it("remembers an explicit choice in the cookie that `/` negotiates from", () => {
    setup().service.remember("de");
    expect(document.cookie).toContain("portfolio-lang=de");
  });

  it("links the current page in both languages", async () => {
    const { service, router } = setup();
    await router.navigateByUrl("/en/legal/imprint#top");

    expect(router.serializeUrl(service.alternates().de)).toBe("/de/legal/imprint#top");
    expect(router.serializeUrl(service.alternates().en)).toBe("/en/legal/imprint#top");
    expect(service.page()).toBe("/legal/imprint");
  });

  it("follows a page's pinned alternates, and only while that page is shown", async () => {
    const { service, router } = setup();
    await router.navigateByUrl("/en/writing/notes");
    service.pinAlternates("/en/writing/notes", { en: "/en/writing/notes", de: "/de/writing" });

    expect(router.serializeUrl(service.alternates().de)).toBe("/de/writing");
    expect(router.serializeUrl(service.alternates().en)).toBe("/en/writing/notes");

    // The same page in another language still counts as that page…
    await router.navigateByUrl("/de/writing/notes");
    expect(router.serializeUrl(service.alternates().de)).toBe("/de/writing");

    // …any other page swaps the language in its own URL again.
    await router.navigateByUrl("/en/legal/privacy");
    expect(router.serializeUrl(service.alternates().de)).toBe("/de/legal/privacy");
  });

  /** With `<base href="/">`, a bare `#projects` would resolve to `/#projects` and reload the site. */
  it("anchors content fragments to the localized home page", () => {
    const { service } = setup();
    service.activate("de");

    expect(service.homeHref("#projects")).toBe("/de#projects");
    expect(service.homeHref("https://example.com")).toBe("https://example.com");
    expect(service.homeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
  });
});
