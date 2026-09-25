import type { Page } from "@playwright/test";

import { expect, interactive, test } from "./fixtures";

/**
 * Full-page screenshots of the public site for design work: a before/after
 * review, not a gate. `pnpm e2e:visual --update-snapshots` takes a baseline
 * (after `pnpm build`); `pnpm e2e:visual` then compares the current build
 * with it, and the HTML report (`npx playwright show-report`) shows each
 * difference. Baselines live in e2e/visual-baseline/<platform>/, gitignored:
 * take a fresh one on your machine before each piece of design work.
 *
 * Reduced motion keeps every effect at rest; the browser's clock is fixed so
 * durations ("2 yr 6 mo") read the same on every run.
 */
const PAGES = [
  { name: "home-en", path: "/en" },
  // German runs longer: headlines, buttons and chips wrap differently.
  { name: "home-de", path: "/de" },
  { name: "case-study", path: "/en/work/project-one" },
  { name: "writing", path: "/en/writing" },
  { name: "post", path: "/en/writing/shipping-rag-to-production" },
  { name: "legal-de", path: "/de/legal/privacy" },
  { name: "not-found", path: "/en/does-not-exist" },
];

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "wide", width: 1920, height: 1080 },
];

const THEMES = ["dark", "light"] as const;

/** The day every screenshot is taken on, as far as the browser knows. */
const TODAY = new Date("2026-09-25T09:00:00Z");

/**
 * Scrolls to the bottom and back to the top, so every lazy image has loaded
 * and every section has hydrated (with the fixed clock) before the shot: a
 * full-page screenshot does not scroll, and would otherwise catch whatever
 * the first screen left unloaded.
 */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await frame();
      await frame();
    }
    scrollTo(0, 0);
  });
  // Only images on show: a lazy one inside `display: none` (the writing
  // index's covers on phones) never loads, and never needs to.
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete || !image.checkVisibility()),
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test.use({ reducedMotion: "reduce" });

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`${theme} · ${viewport.name}`, () => {
      test.use({
        colorScheme: theme,
        viewport: { width: viewport.width, height: viewport.height },
      });

      for (const { name, path } of PAGES) {
        test(path, async ({ page }) => {
          await page.clock.setFixedTime(TODAY);
          await page.goto(path);
          await interactive(page);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await scrollThrough(page);

          await expect(page).toHaveScreenshot(`${name}-${viewport.name}-${theme}.png`, {
            fullPage: true,
            // Canvas and font anti-aliasing vary by a few pixels between runs.
            maxDiffPixelRatio: 0.001,
          });
        });
      }
    });
  }
}
