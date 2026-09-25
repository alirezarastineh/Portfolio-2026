import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

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
  interface Window {
    __reportCspViolation?: (violation: string) => void;
  }
}

async function watchProblems(page: Page): Promise<PageProblems> {
  const problems: PageProblems = { cspViolations: [], pageErrors: [], consoleErrors: [] };

  await page.exposeFunction("__reportCspViolation", (violation: string) => {
    problems.cspViolations.push(violation);
  });
  // Init scripts run before any of the page's own, so even a blocked inline
  // script in the served HTML is caught.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const source = event.sourceFile ? ` at ${event.sourceFile}:${event.lineNumber}` : "";
      window.__reportCspViolation?.(
        `${event.effectiveDirective} ${event.blockedURI || "inline"}${source}`,
      );
    });
  });

  page.on("pageerror", (error) => problems.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Requests to other origins are aborted below; their failures are expected.
    if (text.includes("ERR_BLOCKED_BY_CLIENT")) return;
    // Chrome reports a 404 page's own status as a failed load; the status is the point.
    if (text.startsWith("Failed to load resource") && message.location().url === page.url()) return;
    problems.consoleErrors.push(text);
  });

  return problems;
}

export const test = base.extend<{ problems: PageProblems }>({
  page: async ({ page, baseURL }, use) => {
    // Hermetic: nothing leaves the test server — not the API baked into the
    // build, not analytics, not error reporting.
    const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
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

/** Scripts the browser would execute inline (not `src`, not JSON data blocks). */
export function inlineScripts(html: string): { attrs: string; nonce: string | null }[] {
  const scripts: { attrs: string; nonce: string | null }[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    if (/\bsrc=/i.test(attrs)) continue;
    const type = /\btype="([^"]*)"/i.exec(attrs)?.[1]?.toLowerCase();
    if (type === "application/json" || type === "application/ld+json") continue;
    scripts.push({ attrs, nonce: /\bnonce="([^"]*)"/i.exec(attrs)?.[1] ?? null });
  }
  return scripts;
}

/** The nonce a policy header allows, if any. */
export function policyNonce(policy: string | undefined): string | null {
  return /'nonce-([^']+)'/.exec(policy ?? "")?.[1] ?? null;
}
