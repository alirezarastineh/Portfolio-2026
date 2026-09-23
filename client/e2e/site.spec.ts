import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// The site-wide pieces: home layout, theme, skip link, command palette and the
// contact form. Content from e2e/fixture-content.mjs.

declare global {
  interface Window {
    /** Whether `<body>` existed when the theme first changed (see below). */
    __themeSetWithBody?: boolean;
  }
}

test.describe("home", () => {
  test("leads with the work, in the planned order", async ({ page }) => {
    await page.goto("/en");
    const ids = await page
      .locator("#main section[id]")
      .evaluateAll((sections) => sections.map((section) => section.id));
    expect(ids).toEqual([
      "hero",
      "projects",
      "experience",
      "skills",
      "writing",
      "about",
      "contact",
    ]);
  });

  test("the hero's h1 names the person, and says whether they are available", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("h1")).toContainText("Alireza Rastineh");
    await expect(page.locator("#hero")).toContainText("Open to senior AI / full-stack roles");
    await expect(
      page.locator("#hero").getByRole("link", { name: /ask my portfolio/ }),
    ).toHaveAttribute("href", "/en#about");
  });

  test("section headings are real text; the comment slashes are decoration", async ({ page }) => {
    await page.goto("/en");
    const heading = page.getByRole("heading", { level: 2, name: "projects", exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator("#projects")).toHaveAttribute("aria-labelledby", "projects-heading");
  });

  test("the server sends the About terminal's whole text", async ({ request }) => {
    const html = await (await request.get("/en")).text();
    expect(html).toContain("cat philosophy.txt");
    expect(html).toContain("Building AI applications in a Jupyter notebook is easy");
  });

  test("the latest posts, with a link to all of them", async ({ page }) => {
    await page.goto("/en");
    const writing = page.locator("#writing");
    await expect(writing.locator("h3")).toHaveText([
      "Shipping RAG to production",
      "Notes on evals",
    ]);
    await expect(writing.getByRole("link", { name: /All posts/ })).toHaveAttribute(
      "href",
      "/en/writing",
    );
  });

  test("switching language updates the section headings in place", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("#main")).toBeVisible();
    await page.locator('header a[hreflang="de"]').click();
    await expect(page).toHaveURL(/\/de$/);
    await expect(page.locator("#projects-heading")).toHaveText("projekte");
    await expect(page.locator("#skills-heading")).toHaveText("fähigkeiten");
  });

  test("a project without a case study opens its details in place", async ({ page }) => {
    await page.goto("/en");
    const card = page.locator("#projects li").filter({ hasText: "Project Three" });
    await expect(card.getByRole("link", { name: /Read case study/ })).toHaveCount(0);
    const details = card.locator("details");
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText("PROBLEM");
  });
});

test.describe("theme", () => {
  for (const colorScheme of ["dark", "light"] as const) {
    test(`follows a ${colorScheme} system setting while nothing is saved`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/en");
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    });
  }

  test("the toggle switches, remembers the choice, and the page never flashes", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/en");
    await expect(page.locator("#main")).toBeVisible();

    await page.getByRole("button", { name: "Switch to the light theme" }).click();
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(html).not.toHaveClass(/\bdark\b/);

    // On the next load the inline script applies the saved choice while the
    // parser is still in <head>: before <body> exists, so before any paint.
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        window.__themeSetWithBody = document.body !== null;
        observer.disconnect();
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
    });
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => window.__themeSetWithBody)).toBe(false);
    await expect(page.getByRole("button", { name: "Switch to the dark theme" })).toBeVisible();
  });
});

test.describe("keyboard", () => {
  test("the first Tab reaches a skip link that moves focus into the page", async ({ page }) => {
    await page.goto("/en/work/project-one");
    await expect(page.locator("#main")).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });
});

test.describe("command palette", () => {
  test("⌘K opens it; typing filters, and Enter goes to the result", async ({ page, problems }) => {
    await page.goto("/en");
    await expect(page.locator("#main")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();

    await input.fill("project one");
    await expect(dialog.getByRole("option")).toHaveText(["TODO: Project One"]);
    await expect(input).toHaveAttribute("aria-activedescendant", "palette-work-project-one");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
    await expect(dialog).toBeHidden();
    expect(problems.pageErrors).toEqual([]);
  });

  test("arrows move through the results; Escape closes and gives focus back", async ({ page }) => {
    await page.goto("/en/writing");
    await expect(page.locator("#main")).toBeVisible();
    const button = page.getByRole("button", { name: "Search the site" });
    await button.click();

    const dialog = page.getByRole("dialog", { name: "Command palette" });
    const input = dialog.getByRole("combobox");
    await expect(input).toHaveAttribute("aria-activedescendant", "palette-home");
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", "palette-section-projects");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(dialog.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("switches the theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/en");
    await expect(page.locator("#main")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await dialog.getByRole("combobox").fill("light");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

/**
 * Answers the contact endpoint, wherever the build sends it: same origin, or
 * the API's (then cross-origin, so with CORS and its preflight).
 */
async function mockContact(page: Page, onSend: (body: unknown) => void): Promise<void> {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST",
  };
  await page.route("**/contact", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    onSend(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true }, headers: cors });
  });
}

test.describe("contact form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/en#contact");
    await expect(page.locator("#main")).toBeVisible();
  });

  test("an empty submit marks each field, describes the error, and focuses the first", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "> send_message()" }).click();
    const name = page.locator("#contact-name");
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAttribute("aria-describedby", "contact-name-error");
    await expect(page.locator("#contact-name-error")).toHaveText("Required.");
    await expect(page.locator("#contact-email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#contact [role=status]")).toHaveText(
      "Please fix the highlighted fields.",
    );
  });

  test("a sent message takes focus to the confirmation, which offers another", async ({ page }) => {
    let sent: unknown = null;
    await mockContact(page, (body) => (sent = body));

    await page.locator("#contact-name").fill("Ada");
    await page.locator("#contact-email").fill("ada@example.com");
    await page.locator("#contact-message").fill("Hello there, a question about Atlas.");
    await page.getByRole("button", { name: "> send_message()" }).click();

    const confirmation = page.locator("#contact").getByText("> message_sent.");
    await expect(confirmation).toBeVisible();
    await expect(page.locator("#contact [tabindex='-1']")).toBeFocused();
    expect(sent).toMatchObject({ name: "Ada", email: "ada@example.com", locale: "en" });

    await page.getByRole("button", { name: "Send another message" }).click();
    await expect(page.locator("#contact-name")).toBeFocused();
    await expect(page.locator("#contact-name")).toHaveValue("");
  });

  test("a filled honeypot looks sent but sends nothing", async ({ page }) => {
    let requests = 0;
    await mockContact(page, () => (requests += 1));
    const honeypot = page.locator("#contact-website");
    await expect(honeypot).toBeAttached();
    await honeypot.evaluate((input) => {
      const field = input as HTMLInputElement;
      field.value = "spam";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByRole("button", { name: "> send_message()" }).click();
    await expect(page.locator("#contact").getByText("> message_sent.")).toBeVisible();
    expect(requests).toBe(0);
  });
});
