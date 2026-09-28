import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";

import { expect, interactive, test } from "./fixtures";

/**
 * The admin against the production build, with its API faked in the browser:
 * the page header, the dashboard's tiles, the sidebar's counts and Publish,
 * the load states and the login. No database, no real API: every call the
 * admin makes is answered below, and anything else is recorded as unmocked.
 */

const content = (locale: "en" | "de") =>
  JSON.parse(
    readFileSync(new URL(`../src/app/content/fallback.${locale}.json`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;

const USER = { id: "u1", email: "admin@example.com", totpEnrolled: true };
const NOW = new Date().toISOString();
const HOUR_AGO = new Date(Date.now() - 3600_000).toISOString();

function message(id: string, name: string, status: string) {
  return {
    id,
    createdAt: HOUR_AGO,
    locale: "en",
    name,
    email: `${id}@example.com`,
    message: `A message from ${name}.`,
    status,
    mailStatus: "sent",
    mailError: null,
  };
}

/** What each admin endpoint answers; a function may vary its answer per call. */
type Answer = unknown | ((call: number) => { status: number; body: unknown });

function defaults(): Record<string, Answer> {
  const en = content("en");
  const de = content("de");
  return {
    "GET /auth/me": { user: USER, pendingTotp: false, csrfToken: "x" },
    "GET /admin/status": {
      user: USER,
      pointers: [
        { locale: "en", versionId: 12, publishedAt: HOUR_AGO },
        { locale: "de", versionId: 12, publishedAt: HOUR_AGO },
      ],
      lastEdit: NOW,
      lastPublish: HOUR_AGO,
      hasUnpublishedChanges: true,
    },
    "GET /admin/publish/review": {
      canPublish: true,
      locales: [
        {
          locale: "en",
          issues: [],
          changed: true,
          draft: { ui: { a: "2", b: "new" } },
          live: { ui: { a: "1" } },
          liveVersionId: 12,
          docs: [],
        },
        {
          locale: "de",
          issues: [],
          changed: true,
          draft: { ui: { a: "2" } },
          live: { ui: { a: "1" } },
          liveVersionId: 12,
          docs: [],
        },
      ],
    },
    "GET /admin/messages": {
      messages: [
        message("m1", "Ada Lovelace", "new"),
        message("m2", "Grace Hopper", "new"),
        message("m3", "Spam Bot", "spam"),
        message("m4", "Alan Turing", "read"),
      ],
    },
    "GET /admin/i18n": {
      items: [
        {
          kind: "project",
          id: "p1",
          label: "Project One",
          missingDe: ["hook"],
          missingEn: [],
          stale: false,
          absent: null,
        },
      ],
    },
    "GET /admin/assistant/health": {
      state: { state: "ok", deepAllowed: true, spentUsd: 0.42, budgetUsd: 2 },
      inFlight: 0,
      breakers: [
        {
          model: "gemini-flash",
          state: "open",
          openUntil: NOW,
          consecutiveFailures: 3,
          lastSuccessAt: HOUR_AGO,
          lastFailureAt: NOW,
          lastError: "quota",
          p50TtftMs: 420,
        },
      ],
      last24h: { answers: 12, failures: 3, fallbackRate: 0.1, models: [] },
      corpus: null,
    },
    "GET /admin/publications": {
      publications: [
        {
          id: 12,
          kind: "publish",
          label: "New case study",
          schemaVersion: 2,
          restoredFrom: null,
          createdAt: HOUR_AGO,
          versions: [
            { id: 23, locale: "en", live: true },
            { id: 24, locale: "de", live: true },
          ],
          live: true,
        },
      ],
    },
    "GET /admin/media-reconcile": {
      missingFiles: [],
      orphanFiles: [],
      totalAssets: 0,
      totalBytes: 0,
    },
    "GET /admin/content/preview/en": en,
    "GET /admin/content/preview/de": de,
    "GET /admin/sections/ui": {
      section: "ui",
      updatedAt: HOUR_AGO,
      data: { en: en["ui"], de: de["ui"] },
    },
  };
}

const CORS = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type, x-csrf-token",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
};

/** Answers the admin API wherever the build points it; returns what went unanswered. */
async function fakeApi(
  page: Page,
  baseURL: string | undefined,
  overrides: Record<string, Answer> = {},
): Promise<string[]> {
  const answers = { ...defaults(), ...overrides };
  const calls = new Map<string, number>();
  const unmocked: string[] = [];
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;

  const handle = async (route: Route) => {
    const request = route.request();
    const headers = { ...CORS, "access-control-allow-origin": request.headers()["origin"] ?? "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });

    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    const call = (calls.get(key) ?? 0) + 1;
    calls.set(key, call);
    const answer = answers[key];
    if (answer === undefined) {
      unmocked.push(key);
      return route.fulfill({ status: 404, headers, json: { error: "not_found" } });
    }
    const { status, body } =
      typeof answer === "function"
        ? (answer as (n: number) => { status: number; body: unknown })(call)
        : { status: 200, body: answer };
    return route.fulfill({ status, headers, json: body });
  };

  // Registered after the fixture's catch-all, so these win for the API's calls.
  await page.route(
    (url) => /^\/(?:admin|auth)\//.test(url.pathname) && url.origin !== origin,
    handle,
  );
  // An empty VITE_API_BASE_URL sends them to this origin instead: only the data calls.
  await page.route(
    (url) => /^\/(?:admin|auth)\//.test(url.pathname) && url.origin === origin,
    (route) =>
      ["fetch", "xhr"].includes(route.request().resourceType()) ? handle(route) : route.fallback(),
  );
  return unmocked;
}

/** The admin renders in the browser only: wait for its sidebar, not just hydration. */
async function openAdmin(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await interactive(page);
  await page.locator("[data-slot=sidebar-inset]").waitFor();
}

test.describe("admin", () => {
  test("the dashboard's tiles and the sidebar agree on what needs a look", async ({
    page,
    baseURL,
  }) => {
    const unmocked = await fakeApi(page, baseURL);
    await openAdmin(page, "/admin");

    const glance = page.getByRole("region", { name: "At a glance" });
    await expect(glance.getByText("3 changes")).toBeVisible();
    await expect(glance.getByText("EN 2 · DE 1")).toBeVisible();
    await expect(glance.getByText("2 new")).toBeVisible();
    await expect(glance.getByText("12 answers")).toBeVisible();
    await expect(glance.getByText("$0.42 of $2.00 today")).toBeVisible();
    await expect(glance.getByText("A model is failing: its breaker is open")).toBeVisible();
    await expect(glance.getByText("1 to check")).toBeVisible();

    // Spam stays out of the latest messages.
    const latest = page.getByRole("region", { name: "Latest messages" });
    await expect(latest.getByText("Ada Lovelace", { exact: true })).toBeVisible();
    await expect(latest.getByText("Spam Bot", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Recent publications" }).getByText("New case study"),
    ).toBeVisible();

    const sidebar = page.locator("[data-slot=sidebar-inner]");
    await expect(sidebar.getByRole("link", { name: "Inbox, 2 new" })).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Dashboard, 1 translation to check" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: /^Assistant, A model is failing/ }),
    ).toBeVisible();

    // Publish is in reach from the sidebar, and opens the one review.
    const publish = sidebar.getByRole("button", { name: "Publish: 3 changes unpublished" });
    await expect(publish).toBeEnabled();
    await publish.click();
    const review = page.getByRole("dialog", { name: "Review and publish" });
    await expect(review).toBeVisible();
    await expect(review.getByText("2 changes")).toBeVisible();

    expect(unmocked).toEqual([]);
  });

  test("the page header sticks to the top of a long editor, on a surface", async ({
    page,
    baseURL,
  }) => {
    await fakeApi(page, baseURL);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openAdmin(page, "/admin/about");

    const title = page.getByRole("heading", { level: 1, name: "About" });
    await expect(title).toBeVisible();
    const row = page.locator(".sticky", { has: title });
    await expect(row).not.toHaveAttribute("data-stuck");
    await expect(page.getByRole("link", { name: "Preview (opens in a new tab)" })).toHaveAttribute(
      "target",
      "_blank",
    );

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(row).toHaveAttribute("data-stuck", "");
    const box = await title.boundingBox();
    expect(box?.y ?? 999).toBeLessThan(40);
  });

  test("a section that did not load says so, and loads on Try again", async ({ page, baseURL }) => {
    await fakeApi(page, baseURL, {
      "GET /admin/sections/seo": (call: number) =>
        call === 1
          ? { status: 502, body: { error: "upstream_down" } }
          : {
              status: 200,
              body: {
                section: "seo",
                updatedAt: HOUR_AGO,
                data: { en: content("en")["seo"], de: content("de")["seo"] },
              },
            },
    });
    await openAdmin(page, "/admin/seo");

    const failed = page.getByRole("alert").filter({ hasText: "Could not load this section" });
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("upstream_down");

    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed).toHaveCount(0);
    await expect(page.getByText("Page title", { exact: true })).toBeVisible();
  });

  test("the sign-in is a terminal window that shakes at a wrong password", async ({
    page,
    baseURL,
  }) => {
    await fakeApi(page, baseURL, {
      "POST /auth/login": () => ({ status: 401, body: { error: "invalid_credentials" } }),
    });
    await page.goto("/admin/login");
    await interactive(page);

    const window = page.locator("app-terminal-window");
    await expect(window.locator("header")).toContainText("admin@portfolio — login");

    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("wrong-password");
    const shook = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const frame = document.querySelector("app-terminal-window")!.parentElement!;
          frame.addEventListener("animationstart", () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 3000);
        }),
    );
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    expect(await shook).toBe(true);
  });

  test("the sign-in stays still under reduced motion", async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fakeApi(page, baseURL, {
      "POST /auth/login": () => ({ status: 401, body: { error: "invalid_credentials" } }),
    });
    await page.goto("/admin/login");
    await interactive(page);

    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();

    const animations = await page
      .locator("app-terminal-window")
      .evaluate((el) => el.parentElement!.getAnimations().length);
    expect(animations).toBe(0);
  });
});

test.describe("admin accessibility", () => {
  test.use({ reducedMotion: "reduce" });

  for (const colorScheme of ["dark", "light"] as const) {
    for (const path of ["/admin", "/admin/about"]) {
      test(`${path} in the ${colorScheme} theme has no accessibility violations`, async ({
        page,
        baseURL,
      }) => {
        await page.emulateMedia({ colorScheme });
        await fakeApi(page, baseURL);
        await openAdmin(page, path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        // Loaded: the dashboard's tiles, or the editor's fields.
        await expect(page.locator("[role=status] .sr-only")).toHaveCount(0);

        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        expect(
          violations.map((v) => ({
            rule: v.id,
            help: v.help,
            targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
          })),
        ).toEqual([]);
      });
    }
  }
});
