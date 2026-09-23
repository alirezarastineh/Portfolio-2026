import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Component, signal, type Signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, RouterOutlet, withRouterConfig, type Routes } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageService } from "../services/language.service";
import { ContentStore } from "./content.store";
import { guardLocaleRoute, localeContentResolver } from "./locale-route";
import { appContentSchema, type AppContent, type Locale } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const fallback = (locale: Locale): AppContent =>
  appContentSchema.parse(
    JSON.parse(readFileSync(resolve(here, `fallback.${locale}.json`), "utf8")),
  );

class StubContentStore {
  readonly state: Record<Locale, ReturnType<typeof signal<AppContent | null>>> = {
    en: signal<AppContent | null>(null),
    de: signal<AppContent | null>(null),
  };
  readonly ensured: Locale[] = [];

  content(locale: Locale): Signal<AppContent | null> {
    return this.state[locale].asReadonly();
  }
  async ensure(locale: Locale): Promise<AppContent> {
    this.ensured.push(locale);
    const content = fallback(locale);
    this.state[locale].set(content);
    return content;
  }
}

@Component({ imports: [RouterOutlet], template: "[layout]<router-outlet />" })
class Layout {}
@Component({ template: "home" })
class Home {}
@Component({ template: "locale-404" })
class LocaleNotFound {}
@Component({ template: "root-404" })
class RootNotFound {}
@Component({ template: "admin" })
class Admin {}
@Component({ selector: "app-imprint-stub", template: "imprint" })
class Imprint {}

/** How often the home page's (large) chunk was loaded. */
let homeLoads = 0;

/**
 * The shape Analog generates from `pages/`: each file becomes
 * `{ path, loadChildren }`, and its `routeMeta` sits on the empty-path child
 * that loads. `guardLocaleRoute` then adds the guard to the outer route, as
 * app.config.ts does to Analog's real routes.
 */
function fileRoutes(): Routes {
  const routes: Routes = [
    { path: "admin", loadChildren: async () => [{ path: "", component: Admin }] },
    {
      path: ":locale",
      loadChildren: async () => [
        {
          path: "",
          component: Layout,
          resolve: { content: localeContentResolver },
          children: [
            {
              path: "",
              loadChildren: async () => {
                homeLoads += 1;
                return [{ path: "", component: Home }];
              },
            },
            {
              path: "legal",
              children: [
                {
                  path: "imprint",
                  loadChildren: async () => [{ path: "", component: Imprint }],
                },
              ],
            },
            { path: "**", loadChildren: async () => [{ path: "", component: LocaleNotFound }] },
          ],
        },
      ],
    },
    { path: "**", loadChildren: async () => [{ path: "", component: RootNotFound }] },
  ];
  guardLocaleRoute(routes);
  return routes;
}

describe("locale routing", () => {
  let store: StubContentStore;

  beforeEach(() => {
    store = new StubContentStore();
    homeLoads = 0;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ContentStore, useValue: store },
        provideRouter(fileRoutes(), withRouterConfig({ paramsInheritanceStrategy: "always" })),
      ],
    });
  });

  let harness: RouterTestingHarness | null = null;
  beforeEach(() => (harness = null));

  /** One harness per test (Angular's rule); several navigations through it. */
  async function render(url: string): Promise<string> {
    harness ??= await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return (harness.routeNativeElement?.textContent ?? "").trim();
  }

  it("renders a real locale inside the layout, with its content loaded first", async () => {
    expect(await render("/de")).toBe("[layout]home");
    expect(store.ensured).toEqual(["de"]);
    expect(TestBed.inject(LanguageService).lang()).toBe("de");
  });

  /**
   * Regression: with the guard on the inner route, a bare `/fr` still matched
   * `:locale` (no URL left for a child) and rendered an empty 200 page.
   */
  it("sends an unknown locale to the root 404 without loading anything", async () => {
    expect(await render("/fr")).toBe("root-404");
    expect(await render("/fr/legal/imprint")).toBe("root-404");
    expect(await render("/favicon.png")).toBe("root-404");
    expect(store.ensured).toEqual([]);
  });

  it("fails loudly if the locale page is ever renamed", () => {
    expect(() => guardLocaleRoute([{ path: ":lang" }])).toThrow(/no :locale route/);
  });

  /**
   * Regression: the home page is a lazy `path: ''` child. With the default
   * prefix match the router loaded its chunk for every page, only to find it
   * did not match.
   */
  it("loads the home page's code for the home page only", async () => {
    expect(await render("/en/legal/imprint")).toBe("[layout]imprint");
    expect(await render("/en/does-not-exist")).toBe("[layout]locale-404");
    expect(homeLoads).toBe(0);

    expect(await render("/en")).toBe("[layout]home");
    expect(homeLoads).toBe(1);
  });

  it("keeps an unknown page under a real locale inside the site", async () => {
    expect(await render("/en/does-not-exist")).toBe("[layout]locale-404");
  });

  it("lets the static admin route win over the locale param", async () => {
    expect(await render("/admin")).toBe("admin");
    expect(store.ensured).toEqual([]);
  });
});
