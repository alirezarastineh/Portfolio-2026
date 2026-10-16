import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env["CI"]);
// GitHub's annotation reporter only where GitHub reads it: Woodpecker sets CI too.
const GITHUB = Boolean(process.env["GITHUB_ACTIONS"]);
const PORT = process.env["E2E_PORT"] ?? "4173";
const BASE_URL = `http://127.0.0.1:${PORT}`;
/**
 * The design-review screenshots (e2e/visual.spec.ts) are a project that only
 * exists when asked for (`pnpm e2e:visual` sets this), so `pnpm e2e` never
 * runs them. Their baselines stay on the machine that took them; CI keeps its
 * Linux set on the agent (ci/visual.sh).
 */
const VISUAL = Boolean(process.env["E2E_VISUAL"]);
/**
 * The desktop suite in Firefox and WebKit, projects that also exist only when
 * asked for: CI's nightly run sets this. They use Playwright's own builds of
 * those browsers (`npx playwright install firefox webkit`).
 */
const CROSS_BROWSER = Boolean(process.env["E2E_CROSS_BROWSER"]);
/** Locally the installed Chrome drives the Chromium projects; CI installs Playwright's Chromium. */
const CHROME = CI ? {} : { channel: "chrome" };

/**
 * End-to-end checks against the production build (`pnpm build`, then
 * `pnpm e2e`): routing, head tags, CSP, hydration, navigation and axe.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [[GITHUB ? "github" : "list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], ...CHROME },
      testIgnore: /visual\.spec\.ts/,
    },
    // The phone layout: mobile menu and language switch only.
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], ...CHROME },
      testMatch: /navigation\.spec\.ts/,
    },
    ...(VISUAL
      ? [
          {
            name: "visual",
            use: { ...devices["Desktop Chrome"], ...CHROME },
            testMatch: /visual\.spec\.ts/,
            // Per platform: fonts render differently on Windows and Linux.
            snapshotPathTemplate: "{testDir}/visual-baseline/{platform}/{arg}{ext}",
          },
        ]
      : []),
    ...(CROSS_BROWSER
      ? [
          {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] },
            testIgnore: /visual\.spec\.ts/,
          },
          { name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: /visual\.spec\.ts/ },
        ]
      : []),
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `${BASE_URL}/en`,
    env: { PORT },
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
