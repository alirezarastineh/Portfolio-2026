import { expect, interactive, type PageProblems, test } from "./fixtures";
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
      await interactive(page);
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
    await interactive(page);
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
    await interactive(page);
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
    await interactive(page);

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

  test("the footer lists the case studies, writing and profiles, and the stack", async ({
    page,
  }) => {
    await page.goto("/en/legal/imprint");
    const work = page.getByRole("navigation", { name: "Work", exact: true });
    await expect(work.getByRole("link", { name: "TODO: Project One" })).toHaveAttribute(
      "href",
      "/en/work/project-one",
    );
    await expect(work.getByRole("link", { name: "All work" })).toHaveAttribute(
      "href",
      "/en#projects",
    );
    const writing = page.getByRole("navigation", { name: "Writing", exact: true });
    await expect(writing.getByRole("link", { name: "RSS feed" })).toHaveAttribute(
      "href",
      "/en/rss.xml",
    );
    const elsewhere = page.getByRole("navigation", { name: "Elsewhere" });
    await expect(elsewhere.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(elsewhere.getByRole("link", { name: "Email" })).not.toHaveAttribute("target");
    await expect(page.locator("footer")).toContainText(/Built with Angular \d+, Analog and Hono/);
  });

  test("the mobile menu opens and closes", async ({ page, isMobile }) => {
    // The mobile navigation drawer and hamburger toggle are only rendered on mobile viewports.
    if (!isMobile) return;
    await page.goto("/en");
    const toggle = page.getByRole("button", { name: "Toggle navigation" });

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("navigation", { name: "Mobile" });
    await expect(menu).toBeVisible();
    // The CV, and the language and theme switches, live in the menu below lg.
    await expect(menu.locator('a[href="/en/resume.pdf"][download]')).toBeVisible();
    await expect(
      menu.getByRole("group", { name: "Language" }).getByRole("link", { name: /DE/ }),
    ).toHaveAttribute("href", "/de");
    const theme = menu.getByRole("group", { name: "Theme" });
    await theme.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(theme.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page
      .getByRole("navigation", { name: "Mobile" })
      .getByRole("link", { name: "Contact" })
      .click();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeHidden();
  });

  test("the mobile menu keeps focus inside and closes on Escape or its toggle", async ({
    page,
    isMobile,
  }) => {
    if (!isMobile) return;
    await page.goto("/en");
    await interactive(page);
    const toggle = page.getByRole("button", { name: "Toggle navigation" });
    const menu = page.getByRole("navigation", { name: "Mobile" });

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-controls", "mobile-nav");
    // Shift+Tab from the toggle wraps to the menu's last link, not the page.
    await toggle.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    const inHeader = await page.evaluate(() => !!document.activeElement?.closest("header"));
    expect(inHeader).toBe(true);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();

    // The menu covers the page below the bar, so there is no outside to tap.
    await toggle.click();
    await expect(menu).toBeVisible();
    await toggle.click();
    await expect(menu).toBeHidden();
  });

  test("widening the window to the desktop layout closes the menu", async ({ page, isMobile }) => {
    if (!isMobile) return;
    await page.goto("/en");
    await interactive(page);
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.locator("#mobile-nav")).toHaveCount(0);
  });
});
