import { createRequire } from "node:module";

import AxeBuilder from "@axe-core/playwright";
import { test as base, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

/**
 * Playwright 1.65's own Firefox (159, build 1572) crashes the page when axe reads `aria-labelledby`
 * after Playwright has worked out accessible names (microsoft/playwright#43967; Mozilla's Firefox does
 * not): the nightly's Firefox job failed 17 cases, 5 more passed on their retry. So in Firefox, under
 * that version, an axe scan stands aside and says so in the report; Chromium scans on every push and
 * WebKit every night.
 * shortcut: no axe in Firefox while Playwright is 1.65.x; the next Playwright version scans again by itself.
 */
const pkg = createRequire(import.meta.url)("@playwright/test/package.json") as { version: string };
const PLAYWRIGHT = pkg.version;
if (PLAYWRIGHT.startsWith("1.65.")) {
  const analyze = Reflect.get(AxeBuilder.prototype, "analyze");
  AxeBuilder.prototype.analyze = function (this: AxeBuilder) {
    const info = test.info();
    if (info.project.name !== "firefox") {
      return analyze.call(this);
    }
    info.annotations.push({
      type: "axe skipped",
      description: `Playwright ${PLAYWRIGHT}'s Firefox crashes in axe (microsoft/playwright#43967)`,
    });
    return Promise.resolve({
      violations: [],
      passes: [],
      incomplete: [],
      inapplicable: [],
    } as never);
  };
}

/** What went wrong in the browser while a test ran. */
export interface PageProblems {
  /** `securitypolicyviolation` events: "<directive> <blocked URI>". */
  cspViolations: string[];
  /** Uncaught exceptions. */
  pageErrors: string[];
  /** console.error output, minus requests this fixture blocked on purpose. */
  consoleErrors: string[];
}

declare global {
  var __reportCspViolation: ((violation: string) => void) | undefined;
}

async function watchProblems(page: Page): Promise<PageProblems> {
  const problems: PageProblems = { cspViolations: [], pageErrors: [], consoleErrors: [] };
  // The documents the page loaded, for a 404 page's report of its own status below.
  const documents = new Set<string>();
  page.on("request", (request) => {
    if (request.isNavigationRequest()) {
      documents.add(request.url());
    }
  });

  await page.exposeFunction("__reportCspViolation", (violation: string) => {
    problems.cspViolations.push(violation);
  });
  // Init scripts run before any of the page's own, so even a blocked inline
  // script in the served HTML is caught.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const source = event.sourceFile ? ` at ${event.sourceFile}:${event.lineNumber}` : "";
      globalThis.__reportCspViolation?.(
        `${event.effectiveDirective} ${event.blockedURI || "inline"}${source}`,
      );
    });
  });

  page.on("pageerror", (error) => problems.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    // Requests to other origins are aborted below; their failures are expected.
    if (text.includes("ERR_BLOCKED_BY_CLIENT")) {
      return;
    }
    // Chrome and WebKit report a 404 page's own status as a failed load; the status is the
    // point. WebKit reports it before page.url() names the new page, hence the loaded documents.
    if (text.startsWith("Failed to load resource") && documents.has(message.location().url)) {
      return;
    }
    problems.consoleErrors.push(text);
  });

  return problems;
}

export const test = base.extend<{ problems: PageProblems }>({
  page: async ({ page, baseURL = "http://127.0.0.1" }, use) => {
    // Hermetic: nothing leaves the test server — not the API baked into the
    // build, not analytics, not error reporting.
    const origin = new URL(baseURL).origin;
    await page.route(
      (url) => url.origin !== origin && url.protocol.startsWith("http"),
      (route) => route.abort("blockedbyclient"),
    );
    await use(page);
  },
  problems: async ({ page }, use) => {
    await use(await watchProblems(page));
  },
});

/**
 * Waits until the page is interactive: Angular has hydrated it, including the
 * `@defer` blocks that hydrate once the browser is idle (projects, writing,
 * the contact form). The server-rendered markup is visible long before that,
 * so a visible element proves nothing — until hydration, links are plain
 * links, key handlers do not exist yet, and a form's typing can be lost.
 *
 * The app marks the moment on `<html>` (src/app/app-interactive.ts). Waiting
 * on the network alone was flaky: under parallel load it could go quiet
 * before the app had even started loading (boot-after-paint). The network
 * wait stays after the mark for anything a hydrated section fetches next.
 */
export async function interactive(page: Page): Promise<void> {
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.waitForLoadState("networkidle"); // NOSONAR: a floor after the app's own mark (see above)
}

/**
 * The assistant's console: in the panel on every page, or on home's stage while it holds it (plan
 * 4 U11b). Specs reach it only through this, so moving the assistant changes this alone (plan 4 U7).
 */
export function askPanel(page: Page): Locator {
  return page
    .getByRole("dialog", { name: /^(Ask about my work|Fragen zu meiner Arbeit)$/ })
    .or(page.locator("app-ask-stage app-ask-console"));
}

/**
 * Waits until the page's CSS transitions and animations have finished, before
 * axe reads computed colours. A button just enabled fades from 50% to full
 * opacity over 150 ms (`hlmBtn`: `transition-all`, `data-disabled:opacity-50`),
 * and caught mid-fade it fails color-contrast that its settled state passes:
 * WebKit's FAQ pipeline test did, now and then. Infinite animations (a spinner,
 * the caret) and scroll-driven ones never finish, so they are left out.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.timeline === document.timeline &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime),
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** Scripts the browser would execute inline (not `src`, not JSON data blocks). */
export function inlineScripts(html: string): { attrs: string; nonce: string | null }[] {
  const scripts: { attrs: string; nonce: string | null }[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    if (/\bsrc=/i.test(attrs)) {
      continue;
    }
    const type = /\btype="([^"]*)"/i.exec(attrs)?.[1]?.toLowerCase();
    if (type === "application/json" || type === "application/ld+json") {
      continue;
    }
    scripts.push({ attrs, nonce: /\bnonce="([^"]*)"/i.exec(attrs)?.[1] ?? null });
  }
  return scripts;
}

/** The nonce a policy header allows, if any. */
export function policyNonce(policy = ""): string | null {
  return /'nonce-([^']+)'/.exec(policy)?.[1] ?? null;
}

/** Runs async steps one after another when each step shares Playwright page state. */
export async function runSequentially<T>(
  items: readonly T[],
  step: (item: T, index: number) => Promise<void>,
): Promise<void> {
  await items.reduce<Promise<void>>(
    (chain, item, index) => chain.then(() => step(item, index)),
    Promise.resolve(),
  );
}

/** Fetches a path via Playwright's request context and returns its text body. */
export async function fetchText(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(path);
  return response.text();
}

/** Returns a locator's bounding box, throwing if it is not rendered. */
export async function requireBox(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("Expected locator to have a bounding box");
  }
  return box;
}

/** Returns the page's viewport size, throwing if no viewport is set. */
export function requireViewport(page: Page): { width: number; height: number } {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("Expected page to have a viewport size");
  }
  return viewport;
}
