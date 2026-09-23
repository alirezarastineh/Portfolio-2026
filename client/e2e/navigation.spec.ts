import { expect, test, type PageProblems } from "./fixtures";
import type { Page } from "@playwright/test";

/** Counts full page loads, so a test can prove navigation stayed client-side. */
function countDocumentLoads(page: Page): () => number {
  let loads = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") loads += 1;
  });
  return () => loads;
}

function expectCleanConsole(problems: PageProblems): void {
  expect(problems.pageErrors).toEqual([]);
  expect(problems.consoleErrors).toEqual([]);
}

test.describe("hydration", () => {
  for (const path of [
    "/en",
    "/de",
    "/en/work/project-one",
    "/de/writing",
    "/en/writing/shipping-rag-to-production",
    "/en/legal/imprint",
    "/de/legal/privacy",
    "/en/does-not-exist",
  ]) {
    test(`${path} hydrates without errors`, async ({ page, problems }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expectCleanConsole(problems);
    });
  }
});

test.describe("language switch", () => {
  test("keeps the page, changes the language, and stays client-side", async ({
    page,
    problems,
    isMobile,
  }) => {
    await page.goto("/en/legal/privacy");
    await page.waitForLoadState("networkidle");
    const loads = countDocumentLoads(page);

    if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.locator('header a[hreflang="de"]:visible').click();

    await expect(page).toHaveURL(/\/de\/legal\/privacy$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("h1")).toHaveText("Datenschutzerklärung");
    expect(loads()).toBe(0);
    expectCleanConsole(problems);
  });

  test("is a real link that works without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/de/legal/imprint");
    await expect(page.locator('header a[hreflang="en"]').first()).toHaveAttribute(
      "href",
      "/en/legal/imprint",
    );
    await context.close();
  });

  test("remembers the choice for the next visit to /", async ({ page, isMobile }) => {
    await page.goto("/en");
    // The cookie is written by the click handler, so wait for hydration: a
    // click before it follows the plain link without remembering anything.
    await page.waitForLoadState("networkidle");
    if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.locator('header a[hreflang="de"]:visible').click();
    await expect(page).toHaveURL(/\/de$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/de$/);
  });
});

test.describe("site navigation", () => {
  test("a section link from another page lands on that home section", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/en/legal/imprint");
    await page.waitForLoadState("networkidle");

    if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.locator("header nav a:visible", { hasText: "Projects" }).click();

    await expect(page).toHaveURL(/\/en#projects$/);
    await expect(page.locator("#projects")).toBeInViewport();
  });

  test("the footer links both legal pages in the page's language", async ({ page }) => {
    await page.goto("/de");
    const legal = page.getByRole("navigation", { name: "Rechtliches" });
    await expect(legal.getByRole("link")).toHaveCount(2);
    await expect(legal.getByRole("link").first()).toHaveAttribute("href", "/de/legal/imprint");
    await expect(legal.getByRole("link").last()).toHaveAttribute("href", "/de/legal/privacy");
  });

  test("the mobile menu opens and closes", async ({ page, isMobile }) => {
    // The mobile navigation drawer and hamburger toggle are only rendered on mobile viewports.
    if (!isMobile) return;
    await page.goto("/en");
    const toggle = page.getByRole("button", { name: "Toggle navigation" });

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();

    await page
      .getByRole("navigation", { name: "Mobile" })
      .getByRole("link", { name: "Contact" })
      .click();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeHidden();
  });
});
