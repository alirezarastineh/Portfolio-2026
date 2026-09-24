import AxeBuilder from "@axe-core/playwright";

import { expect, interactive, test } from "./fixtures";

const PAGES = [
  "/en",
  "/de",
  "/en/work/project-one",
  "/de/work/project-one",
  "/en/writing",
  "/de/writing?tag=rag",
  "/en/writing/shipping-rag-to-production",
  "/de/writing/shipping-rag-to-production",
  "/en/legal/imprint",
  "/de/legal/privacy",
  "/en/does-not-exist",
  "/admin/login",
];

/**
 * Violations that exist today and are scheduled, by rule id. Anything else
 * fails. The target is axe 0: remove entries as they get fixed, never add one
 * without a plan to fix it.
 */
const KNOWN: Record<string, string> = {};

test.use({ reducedMotion: "reduce" });

// Both themes: with no saved choice the site follows the system setting.
for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const path of PAGES) {
      test(`${path} has no new accessibility violations`, async ({ page }) => {
        await page.goto(path);
        await interactive(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);

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
  });
}
