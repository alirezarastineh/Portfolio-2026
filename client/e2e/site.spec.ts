import type { Page } from "@playwright/test";

import { expect, interactive, test } from "./fixtures";

// The site-wide pieces: home layout, theme, skip link, command palette and the
// contact form. Content from e2e/fixture-content.mjs.

declare global {
  interface Window {
    /** Whether `<body>` existed when the theme first changed (see below). */
    __themeSetWithBody?: boolean;
    /** The view transitions' types, and what each circle clip animated (see below). */
    __reveals?: { types: string[]; clips: string[] };
  }
}

/** An init script: records the types of each view transition and each circle clip's target. */
function recordReveals() {
  const log = { types: [] as string[], clips: [] as string[] };
  window.__reveals = log;
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (options) => {
    if (typeof options === "object") log.types.push(...(options.types ?? []));
    return start(options);
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    if (typeof options === "object" && JSON.stringify(keyframes).includes("circle(")) {
      log.clips.push(options.pseudoElement ?? "");
    }
    return animate.call(this, keyframes, options);
  };
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
      page.locator("#hero").getByRole("textbox", { name: "ask my portfolio" }),
    ).toBeVisible();
    // Before the app is interactive, sending still leads to the terminal.
    await expect(page.locator("#hero form")).toHaveAttribute("action", "/en#about");
  });

  test("the hero shows proof only when there is some: orgs and a project's numbers", async ({
    page,
  }) => {
    await page.goto("/en");
    const hero = page.locator("#hero");
    await expect(hero).toContainText("Shipped at");
    await expect(hero).toContainText("Example GmbH");
    // Education and certifications are not "shipped at".
    await expect(hero).not.toContainText("TU Example");
    await expect(hero.locator("dd")).toHaveText(["−42%", "3.1×", "99.95%"]);
  });

  test("section headings are real text; the comment slashes are decoration", async ({ page }) => {
    await page.goto("/en");
    const heading = page.getByRole("heading", { level: 2, name: "projects", exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator("#projects")).toHaveAttribute("aria-labelledby", "projects-heading");
    // Numbered in page order, counting only the sections that render.
    await expect(page.locator("#projects header span[aria-hidden]").first()).toHaveText("01");
    await expect(page.locator("#contact header span[aria-hidden]").first()).toHaveText("06");
  });

  test("the server sends the About terminal's whole text", async ({ request }) => {
    const html = await (await request.get("/en")).text();
    expect(html).toContain("cat philosophy.txt");
    expect(html).toContain("Building AI applications in a Jupyter notebook is easy");
  });

  test("beside the About terminal, the person: a bio and a few facts", async ({ page }) => {
    await page.goto("/en");
    const about = page.locator("#about");
    await expect(about).toContainText("I turn language models into products");
    await expect(about.locator("dt")).toHaveText(["Based in", "Shipping since", "Status"]);
    await expect(about.locator("dd")).toHaveText([
      "Remote",
      "2021",
      "Open to senior AI / full-stack roles",
    ]);
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
    await interactive(page);
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

  test("a featured project spans the row; the others go two across", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en");
    const widths = await page
      .locator("#projects > div > ul > li")
      .evaluateAll((items) => items.map((li) => Math.round(li.getBoundingClientRect().width)));
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeGreaterThan(widths[1]! * 1.9);
    expect(widths[1]).toBe(widths[2]);
  });

  test("a card with a case study is one link, as large as the card", async ({ page }) => {
    await page.goto("/en");
    await interactive(page);
    const card = page.locator("#projects li").first();
    await expect(card.getByRole("link")).toHaveCount(1);
    // Its image, well away from the link's text, is part of the link too.
    await card.scrollIntoViewIfNeeded();
    const image = (await card.locator(".card-media").boundingBox())!;
    await page.mouse.click(image.x + image.width / 2, image.y + image.height / 2);
    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
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
    await interactive(page);

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

  test("the new theme grows from the button; under reduced motion it switches at once", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(recordReveals);
    await page.goto("/en");
    await interactive(page);
    const html = page.locator("html");

    await page.getByRole("button", { name: "Switch to the light theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect
      .poll(() => page.evaluate(() => window.__reveals))
      .toEqual({ types: ["theme"], clips: ["::view-transition-new(root)"] });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Switch to the dark theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => window.__reveals?.types)).toEqual(["theme"]);
  });

  test("the browser's own colour is the page's, from before the first paint", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/en");
    const color = page.locator('meta[name="theme-color"]');
    await expect(color).toHaveCount(1);
    await expect(color).toHaveAttribute("content", "#f9fafb");

    await interactive(page);
    await page.getByRole("button", { name: "Switch to the dark theme" }).click();
    await expect(color).toHaveAttribute("content", "#101012");

    // No page's tags name a colour, so moving to another page keeps it.
    await page
      .getByRole("link", { name: /Read case study/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(color).toHaveAttribute("content", "#101012");
  });
});

test.describe("motion", () => {
  test("a card below the fold rises in as it is reached; under reduced motion it is just there", async ({
    page,
  }) => {
    await page.goto("/en");
    await interactive(page);
    const card = page.locator("#projects > div > ul > li").first();
    const opacity = () => card.evaluate((el) => getComputedStyle(el).opacity);

    expect(await opacity()).toBe("0");
    await card.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect.poll(opacity).toBe("1");

    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(opacity).toBe("0");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(opacity).toBe("1");
  });

  test("a held button sinks a little; not under reduced motion", async ({ page }) => {
    await page.goto("/en");
    await interactive(page);
    const talk = page.getByRole("link", { name: "Let's talk" });
    const scale = () => talk.evaluate((el) => getComputedStyle(el).scale);
    const hold = async () => {
      const box = (await talk.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
    };
    // Moved off before the release, so nothing is clicked.
    const letGo = async () => {
      await page.mouse.move(0, 0);
      await page.mouse.up();
    };

    await hold();
    await expect.poll(scale).toBe("0.98");
    await letGo();
    await expect.poll(scale).toBe("none");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await hold();
    expect(await scale()).toBe("none");
    await letGo();
  });
});

test.describe("keyboard", () => {
  test("the first Tab reaches a skip link that moves focus into the page", async ({ page }) => {
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    // Seen, not only in view: nothing (the fixed header) covers it.
    expect(
      await skip.evaluate((link) => {
        const box = link.getBoundingClientRect();
        return link.contains(
          document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
        );
      }),
    ).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });
});

test.describe("command palette", () => {
  test("⌘K opens it; typing filters, and Enter goes to the result", async ({ page, problems }) => {
    await page.goto("/en");
    await interactive(page);
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
    await interactive(page);
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
    await interactive(page);
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
  // The form hydrates when the browser is idle, which on a busy machine can be
  // after the network has gone quiet: wait for the form itself to be ready.
  test.beforeEach(async ({ page }) => {
    await page.goto("/en#contact");
    await expect(page.locator("#contact form[data-ready]")).toBeAttached();
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

  test("beside it: the email to copy, profiles by handle, and a reply time", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const contact = page.locator("#contact");
    await expect(
      contact.getByRole("link", { name: /^GitHub\s*github\.com\/alirezarastineh$/ }),
    ).toHaveAttribute("href", "https://github.com/alirezarastineh");
    await expect(contact).toContainText("I reply within 24 hours.");

    await contact.getByRole("button", { name: "Copy the email address" }).click();
    await expect(contact.getByRole("button", { name: /^Copied ✓/ })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "contact@alirezarastineh.me",
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

test.describe("contact form before hydration", () => {
  test("keeps what was typed before the form's code arrived", async ({ page }) => {
    // The form's code held back until a field is filled: the visitor types
    // into the server's markup, then the form hydrates around their text.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/contact\.component-[^/]*\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/en#contact");
    await page.locator("#contact-name").fill("Ada");
    release();
    await expect(page.locator("#contact form[data-ready]")).toBeAttached();
    await expect(page.locator("#contact-name")).toHaveValue("Ada");
  });
});
