import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";

const PAGES = [
  "/en",
  "/de",
  "/en/legal/imprint",
  "/de/legal/privacy",
  "/en/does-not-exist",
  "/admin/login",
];

/**
 * Violations that exist today and are scheduled, by rule id. Anything else
 * fails. Phase 6 targets axe 0: remove entries as they get fixed, never add
 * one without a plan to fix it.
 */
const KNOWN: Record<string, string> = {};

test.use({ reducedMotion: "reduce" });

for (const path of PAGES) {
  test(`${path} has no new accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();

    const unexpected = violations
      .filter((violation) => !(violation.id in KNOWN))
      .map((violation) => ({
        rule: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
      }));
    expect(unexpected).toEqual([]);
  });
}
