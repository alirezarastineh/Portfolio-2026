import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signal, type Signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { ContentStore } from "../content/content.store";
import { INITIAL_LOCALE } from "../content/locale.token";
import { appContentSchema, type AppContent, type Locale } from "../content/schema";
import { LanguageService } from "./language.service";

const here = dirname(fileURLToPath(import.meta.url));

function fallback(locale: Locale): AppContent {
  const raw = readFileSync(resolve(here, `../content/fallback.${locale}.json`), "utf8");
  return appContentSchema.parse(JSON.parse(raw));
}

/** Stands in for the HTTP-backed store so these tests never touch the network. */
class StubContentStore {
  readonly state: Record<Locale, ReturnType<typeof signal<AppContent>>> = {
    en: signal(fallback("en")),
    de: signal(fallback("de")),
  };
  readonly resolved = new Set<Locale>();
  loadCalls: Locale[] = [];

  content(locale: Locale): Signal<AppContent> {
    return this.state[locale].asReadonly();
  }
  hasResolved(locale: Locale): boolean {
    return this.resolved.has(locale);
  }
  async load(locale: Locale): Promise<void> {
    this.loadCalls.push(locale);
    this.resolved.add(locale);
  }
}

function setup(initial: Locale = "en") {
  const store = new StubContentStore();
  TestBed.configureTestingModule({
    providers: [
      { provide: ContentStore, useValue: store },
      { provide: INITIAL_LOCALE, useValue: initial },
    ],
  });
  return { store, service: TestBed.inject(LanguageService) };
}

describe("LanguageService", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    try {
      document.cookie = "portfolio-lang=; Path=/; Max-Age=0";
      localStorage.clear();
    } catch {
      // Storage is unavailable in some environments; the service tolerates it.
    }
  });

  /**
   * The no-flash contract: `t()` is seeded from the bundled fallback, so it is
   * never undefined even before any content has been fetched.
   */
  it("exposes usable copy before any content resolves", () => {
    const { service, store } = setup();

    expect(store.hasResolved("en")).toBe(false);
    expect(service.t()).toBeDefined();
    expect(service.t().profile.heroHeadline.length).toBeGreaterThan(0);
  });

  it("starts in German when the token says so", () => {
    expect(setup("de").service.lang()).toBe("de");
  });

  it("starts in English when the token says so", () => {
    expect(setup("en").service.lang()).toBe("en");
  });

  it("flips the copy tree when the language changes", async () => {
    const { service } = setup("en");
    const before = service.t().about.heading;

    await service.setLang("de");

    expect(service.lang()).toBe("de");
    expect(service.t().about.heading).not.toBe(before);
    expect(service.t().about.heading).toContain("über mich");
  });

  it("fetches the target locale before switching, so no stale copy is shown", async () => {
    const { service, store } = setup("en");

    await service.setLang("de");

    expect(store.loadCalls).toEqual(["de"]);
  });

  it("does not refetch a locale that already resolved", async () => {
    const { service, store } = setup("en");
    store.resolved.add("de");

    await service.setLang("de");

    expect(store.loadCalls).toEqual([]);
  });

  it("ignores a switch to the current locale", async () => {
    const { service, store } = setup("en");

    await service.setLang("en");

    expect(store.loadCalls).toEqual([]);
  });

  it("exposes structural content for the active locale", async () => {
    const { service } = setup("en");
    expect(service.content().skills.length).toBeGreaterThan(0);

    await service.setLang("de");
    expect(service.content().skills[0].title).toBe("Kernarchitektur");
  });

  it("persists the choice in a cookie, which is what SSR reads", async () => {
    const { service } = setup("en");

    await service.setLang("de");

    expect(document.cookie).toContain("portfolio-lang=de");
  });
});
