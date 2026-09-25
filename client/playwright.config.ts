import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env["CI"]);
const PORT = process.env["E2E_PORT"] ?? "4173";
const BASE_URL = `http://127.0.0.1:${PORT}`;
/**
 * The design-review screenshots (e2e/visual.spec.ts) are a project that only
 * exists when asked for (`pnpm e2e:visual` sets this), so neither `pnpm e2e`
 * nor CI runs them. Their baselines stay on the machine that took them.
 */
const VISUAL = Boolean(process.env["E2E_VISUAL"]);

/**
 * End-to-end checks against the production build (`pnpm build`, then
 * `pnpm e2e`): routing, head tags, CSP, hydration, navigation and axe.
 * Locally they drive the installed Chrome; CI installs Playwright's Chromium.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    ...(CI ? {} : { channel: "chrome" }),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /visual\.spec\.ts/ },
    // The phone layout: mobile menu and language switch only.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /navigation\.spec\.ts/ },
    ...(VISUAL
      ? [
          {
            name: "visual",
            use: { ...devices["Desktop Chrome"] },
            testMatch: /visual\.spec\.ts/,
            // Per platform: fonts render differently on Windows and Linux.
            snapshotPathTemplate: "{testDir}/visual-baseline/{platform}/{arg}{ext}",
          },
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
