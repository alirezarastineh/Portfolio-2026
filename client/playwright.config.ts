import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env["CI"]);
const PORT = process.env["E2E_PORT"] ?? "4173";
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The phone layout: mobile menu and language switch only.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /navigation\.spec\.ts/ },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `${BASE_URL}/en`,
    env: { PORT },
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
