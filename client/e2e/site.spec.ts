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
  test("leads with the work, then the person, then the record, and the header follows", async ({
    page,
  }) => {
    await page.goto("/en");
    const ids = await page
      .locator("#main section[id]")
      .evaluateAll((sections) => sections.map((section) => section.id));
    expect(ids).toEqual([
      "hero",
      "projects",
      "about",
      "experience",
      "skills",
      "writing",
      "contact",
    ]);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link")).toHaveText([
      "Work",
      "About",
      "Experience",
      "Writing",
    ]);
  });

  test("the hero's h1 names the person, and says whether they are available", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("h1")).toContainText("Alireza Rastineh");
    await expect(page.locator("#hero")).toContainText("Open to senior AI / full-stack roles");
    await expect(
      page.locator("#hero").getByRole("textbox", { name: "Ask about my work" }),
    ).toBeVisible();
    // Before the app is interactive, sending leads to the one thing that works without it.
    await expect(page.locator("#hero form")).toHaveAttribute("action", "/en#contact");
    await expect(page.locator("#ask-bar")).not.toHaveAttribute("name");
  });

  test("the hero's headline fits: English keeps its words whole, the action is on a laptop's first screen, German fits a small phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    await expect(page.locator("h1")).toHaveCSS("hyphens", "manual");
    await expect(page.getByRole("link", { name: "See the work" })).toBeInViewport({ ratio: 1 });

    // "Sprachmodellen" is too long for the narrowest phones without its hyphens.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/de");
    await expect(page.locator("h1")).toHaveCSS("hyphens", "auto");
    const wider = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(wider).toBe(0);
  });

  test("the headline ends in the wordmark's orange full stop, unread, and its text stays whole", async ({
    page,
    request,
  }) => {
    const headline = "I turn language models into products that keep working after the demo.";
    // verify-deploy.sh finds the published headline's text before its full stop in the server's HTML.
    const html = await (await request.get("/en")).text();
    expect(html).toContain(headline.slice(0, -1));

    await page.goto("/en");
    await expect(page.locator("h1")).toHaveText(`Alireza Rastineh — ${headline}`);
    const stop = page.locator("h1 .hero-dot");
    await expect(stop).toHaveText(".");
    await expect(stop).toHaveAttribute("aria-hidden", "true");
    await expect(stop).toHaveCSS("color", "rgb(255, 79, 0)");
  });

  test("from lg the line starts at that stop: down to the headline's foot, back to the gutter, on to the page's line", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    test.skip(
      !(await page.evaluate(() => CSS.supports("anchor-name: --a"))),
      "no anchor positioning: the stop stands alone",
    );
    const box = (selector: string) =>
      page.locator(selector).evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
    const [h1, stop, start, line] = await Promise.all(
      ["h1", "h1 .hero-dot", ".hero-line", ".page-line"].map(box),
    );
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    near(start.top, h1.bottom);
    // Its drop is the 1px column at the stop's middle.
    near(start.right - 1, stop.left + stop.width / 2);
    near(start.left, line.left);
    near(start.bottom, line.top);
    await expect(page.locator(".hero-line")).toHaveAttribute("aria-hidden", "true");
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
    await expect(hero.locator(".metric-value")).toHaveText(["−42%", "3.1×", "99.95%"]);
  });

  test("section headings are real text: the name and its node, no number or label", async ({
    page,
  }) => {
    await page.goto("/en");
    const heading = page.getByRole("heading", { level: 2, name: "Selected work", exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator("#projects")).toHaveAttribute("aria-labelledby", "projects-heading");
    await expect(page.locator("#projects header")).toHaveText("Selected work");
    await expect(heading.locator(".page-line-node")).toHaveAttribute("aria-hidden", "true");
  });

  test("the server sends About's whole text, as prose", async ({ request }) => {
    const html = await (await request.get("/en")).text();
    expect(html).toContain("Building AI applications in a Jupyter notebook is easy");
    expect(html).not.toContain("cat philosophy.txt");
  });

  test("beside About's text, the person: a bio and a few facts", async ({ page }) => {
    await page.goto("/en");
    const about = page.locator("#about");
    await expect(about).toContainText("I turn language models into products");
    await expect(about.locator("dt")).toHaveText(["Based in", "Shipping since", "Status"]);
    await expect(about.locator("dd")).toHaveText([
      "Remote",
      "2018",
      "Open to senior AI / full-stack roles",
    ]);
    // How an answer is made: real text, so it needs no other alternative.
    await expect(about.locator("figure figcaption")).toHaveText("How an answer is made");
    await expect(about.locator("figure li")).toHaveCount(4);
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
    await expect(page.locator("#projects-heading")).toHaveText("Ausgewählte Projekte");
    await expect(page.locator("#skills-heading")).toHaveText("Fähigkeiten");
  });

  test("a project without a case study opens its details in place", async ({ page }) => {
    await page.goto("/en");
    const card = page
      .locator("#projects li")
      .filter({ hasText: "Release gate for prompt changes" });
    await expect(card.getByRole("link", { name: /Read case study/ })).toHaveCount(0);
    const details = card.locator("details");
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText("Problem");
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

  test("a plate is flat: its stack plain text, its hook whole, its title underlined while its link is hovered or focused", async ({
    page,
  }) => {
    await page.goto("/en");
    await interactive(page);
    const plate = page.locator("#projects li").first();
    await expect(plate.getByText("TypeScript, Python, FastAPI, Postgres")).toBeVisible();
    await expect(plate.locator(".chip")).toHaveCount(0);
    await expect(plate.getByText(/^Answers support agents/)).toHaveCSS(
      "-webkit-line-clamp",
      "none",
    );

    const underline = () =>
      plate.locator("h3 .title-draw").evaluate((el) => getComputedStyle(el).backgroundSize);
    expect(await underline()).toBe("0px 2px");
    // Over the cover, which the plate's one link covers too.
    await plate.scrollIntoViewIfNeeded();
    const cover = (await plate.locator(".card-media").boundingBox())!;
    await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2);
    await expect.poll(underline).toBe("100% 2px");
    await page.mouse.move(0, 0);
    await expect.poll(underline).toBe("0px 2px");
    await plate.getByRole("link", { name: /Read case study/ }).focus();
    await expect.poll(underline).toBe("100% 2px");
  });

  test("skills are plain text in two columns, each group leading to the work that uses it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en");
    const skills = page.locator("#skills");
    await expect(skills.locator("h3")).toHaveCount(4);
    await expect(skills.locator(".chip, svg")).toHaveCount(0);
    const columns = await skills
      .locator("li")
      .evaluateAll((items) => new Set(items.map((li) => li.getBoundingClientRect().left)).size);
    expect(columns).toBe(2);

    const core = skills.locator("li").filter({ hasText: "Core Architecture" });
    await expect(core).toContainText(
      "Used in: Atlas, Supplier catalogue ingestion, Release gate for prompt changes",
    );
    await expect(core.getByRole("link", { name: "Atlas" })).toHaveAttribute(
      "href",
      "/en/work/project-one",
    );
    // No case study: its plate, on this page.
    const gate = core.getByRole("link", { name: "Release gate for prompt changes" });
    await expect(gate).toHaveAttribute("href", "/en#work-project-three");
    await interactive(page);
    await gate.click();
    await expect(page.locator("#work-project-three h3")).toBeInViewport();
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
    await expect(color).toHaveAttribute("content", "#ffffff");

    await interactive(page);
    await page.getByRole("button", { name: "Switch to the dark theme" }).click();
    await expect(color).toHaveAttribute("content", "#000000");

    // No page's tags name a colour, so moving to another page keeps it.
    await page
      .getByRole("link", { name: /Read case study/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(color).toHaveAttribute("content", "#000000");
  });
});

test.describe("motion", () => {
  test("the line fills as the page is read and a node lights as it is reached; under reduced motion it rests", async ({
    page,
  }) => {
    await page.goto("/en");
    // motion.css fills it on scroll timelines; without them (Firefox) it rests.
    test.skip(
      !(await page.evaluate(() => CSS.supports("animation-timeline: view()"))),
      "no scroll timelines in this browser",
    );
    const fill = () =>
      page.locator(".page-line").evaluate((el) => getComputedStyle(el, "::after").scale);
    const node = (id: string) =>
      page.locator(`#${id} .page-line-node`).evaluate((el) => getComputedStyle(el).borderTopColor);
    const signal = "rgb(255, 79, 0)";

    expect(await fill()).toBe("1 0");
    expect(await node("projects")).not.toBe(signal);

    await page
      .locator("#skills")
      .evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
    await expect.poll(fill).toMatch(/^1 0\.\d+$/);
    await expect.poll(() => node("projects")).toBe(signal);
    expect(await node("contact")).not.toBe(signal);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(fill).toBe("none");
    expect(await node("contact")).toBe(signal);
  });

  test("a held button sinks a little; not under reduced motion", async ({ page, browserName }) => {
    // Moving a held link starts a native drag, after which Firefox leaves it :active.
    test.skip(browserName === "firefox", "Firefox keeps a dragged link :active");
    await page.goto("/en");
    await interactive(page);
    const talk = page.getByRole("link", { name: "Let’s talk" });
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
  test("the header's Ask or search shows this platform's keys, once the browser knows them", async ({
    page,
    request,
  }) => {
    const html = await (await request.get("/en")).text();
    expect(html).not.toMatch(/<kbd[^>]*>\s*(Ctrl|⌘)/);
    await page.goto("/en");
    await interactive(page);
    const keys = page.locator('header [aria-keyshortcuts="Control+K Meta+K"] kbd');
    await expect(keys).toHaveText(/^(Ctrl|⌘)\u00A0K$/);
  });

  test("⌘K opens it; typing filters, and Enter goes to the result", async ({ page, problems }) => {
    await page.goto("/en");
    await interactive(page);
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();

    await input.fill("atlas");
    await expect(dialog.getByRole("option")).toHaveText(["Ask: atlas", "Atlas"]);
    await expect(input).toHaveAttribute("aria-activedescendant", "palette-work-project-one");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
    await expect(dialog).toBeHidden();
    expect(problems.pageErrors).toEqual([]);
  });

  test("arrows move through the results; Escape closes and gives focus back", async ({ page }) => {
    await page.goto("/en/writing");
    await interactive(page);
    const button = page.getByRole("button", { name: "Ask or search" });
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
    await page.getByRole("button", { name: "Send message" }).click();
    const name = page.locator("#contact-name");
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAttribute("aria-describedby", "contact-name-error");
    await expect(page.locator("#contact-name-error")).toHaveText("Required.");
    // Text with an icon beside it, never colour alone.
    await expect(page.locator("#contact-name-error svg")).toBeVisible();
    await expect(page.locator("#contact-email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#contact [role=status]")).toHaveText(
      "Please fix the highlighted fields.",
    );
  });

  test("labels stand above 56px fields, and the address breaks only after its @", async ({
    page,
    request,
  }) => {
    const label = (await page.locator('label[for="contact-name"]').boundingBox())!;
    const name = page.locator("#contact-name");
    expect(label.y + label.height).toBeLessThanOrEqual((await name.boundingBox())!.y);
    await expect(name).toHaveCSS("min-height", "56px");
    await expect(page.locator('label[for="contact-name"]')).toHaveCSS("font-size", "16px");
    const html = await (await request.get("/en")).text();
    expect(html).toMatch(/>contact@<wbr\/?>alirezarastineh\.me</);
    expect(html).not.toContain("break-all");
  });

  test("beside it: the email to copy, profiles by name, and a reply time", async ({
    page,
    context,
    browserName,
  }) => {
    // Only Chromium lets a test grant clipboard access and read it back.
    const readable = browserName === "chromium";
    if (readable) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const contact = page.locator("#contact");
    await expect(contact.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
      "href",
      "https://github.com/alirezarastineh",
    );
    await expect(contact).toContainText("I reply within 24 hours.");

    await contact.getByRole("button", { name: "Copy the email address" }).click();
    await expect(contact.getByRole("button", { name: /^Copied/ })).toBeVisible();
    if (readable) {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        "contact@alirezarastineh.me",
      );
    }
  });

  test("a refused copy says so", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
    });
    await page.reload();
    await interactive(page);
    const contact = page.locator("#contact");
    await contact.getByRole("button", { name: "Copy the email address" }).click();
    await expect(contact.getByRole("button", { name: /^Couldn’t copy/ })).toBeVisible();
  });

  test("a sent message takes focus to the confirmation, which offers another", async ({ page }) => {
    let sent: unknown = null;
    await mockContact(page, (body) => (sent = body));

    await page.locator("#contact-name").fill("Ada");
    await page.locator("#contact-email").fill("ada@example.com");
    await page.locator("#contact-message").fill("Hello there, a question about Atlas.");
    await page.getByRole("button", { name: "Send message" }).click();

    const confirmation = page.locator("#contact").getByText("Message sent");
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
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator("#contact").getByText("Message sent")).toBeVisible();
    expect(requests).toBe(0);
  });

  test("the page's line ends at Send, and after a send at “Message sent”, which closes on the dot", async ({
    page,
  }) => {
    test.skip(
      !(await page.evaluate(() => CSS.supports("anchor-name: --a"))),
      "no anchor positioning: the line runs to the foot of the page",
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    const box = (selector: string) =>
      page.locator(selector).evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    const middle = (rect: DOMRect) => rect.top + rect.height / 2;
    const [line, run, send] = await Promise.all(
      [".page-line", ".page-line-run", "#contact button[type=submit]"].map(box),
    );
    near(line.bottom, middle(send));
    near(run.top, middle(send));
    near(run.left, line.left);
    near(run.right, send.left);
    await expect(page.locator(".page-line-run")).toHaveAttribute("aria-hidden", "true");

    await mockContact(page, () => undefined);
    await page.locator("#contact-name").fill("Ada");
    await page.locator("#contact-email").fill("ada@example.com");
    await page.locator("#contact-message").fill("Hello there, a question about Atlas.");
    await page.getByRole("button", { name: "Send message" }).click();
    const sent = page.locator("#contact .page-line-end");
    await expect(sent).toHaveText("Message sent.");
    await expect(sent.locator("[aria-hidden=true]")).toHaveCSS("color", "rgb(255, 79, 0)");
    await expect(page.locator(".page-line-run")).toHaveCount(0);
    // In one read: the page is still scrolling to the message, which moves both boxes.
    const offset = await page.evaluate(() => {
      const end = document.querySelector("#contact .page-line-end")!.getBoundingClientRect();
      const line = document.querySelector(".page-line")!.getBoundingClientRect();
      return line.bottom - (end.top + end.height / 2);
    });
    near(offset, 0);
  });

  test("an unsent message asks before a link leaves home; its sections and the other language do not", async ({
    page,
  }) => {
    const message = page.locator("#contact-message");
    await message.fill("A question about Atlas.");
    const asked: string[] = [];
    page.on("dialog", (dialog) => {
      asked.push(dialog.message());
      // Stay the first time, leave the second.
      void (asked.length === 1 ? dialog.dismiss() : dialog.accept());
    });

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Work" })
      .click();
    await expect(page).toHaveURL(/\/en#projects$/);
    // The other language keeps the place, and the form with it.
    await page.locator('header a[hreflang="de"]').click();
    await expect(page).toHaveURL(/\/de#projects$/);
    await expect(message).toHaveValue("A question about Atlas.");
    expect(asked).toEqual([]);

    const writing = page
      .getByRole("navigation", { name: "Hauptnavigation" })
      .getByRole("link", { name: "Artikel" });
    await writing.click();
    await expect
      .poll(() => asked)
      .toEqual(["Ihre Nachricht ist noch nicht gesendet. Seite trotzdem verlassen?"]);
    await expect(page).toHaveURL(/\/de#projects$/);
    await expect(message).toHaveValue("A question about Atlas.");
    await writing.click();
    await expect(page).toHaveURL(/\/de\/writing$/);
  });

  test("an unsent message asks before the page reloads or closes", async ({ page }) => {
    await page.locator("#contact-message").fill("A question about Atlas.");
    const dialog = page.waitForEvent("dialog");
    await page.close({ runBeforeUnload: true });
    expect((await dialog).type()).toBe("beforeunload");
    await (await dialog).dismiss();
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

// What a visitor's own settings ask of the public site (plan 4 U32, U33).
test.describe("visitor preferences", () => {
  test("a tap answers in the signal on the public site, not in the admin", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "only Chromium reports the tap colour");
    const tint = () =>
      page.evaluate(() =>
        getComputedStyle(document.querySelector("a, button")!).getPropertyValue(
          "-webkit-tap-highlight-color",
        ),
      );
    await page.goto("/en");
    await interactive(page);
    const publicTint = await tint();
    await page.goto("/admin/login");
    await interactive(page);
    expect(publicTint).not.toBe(await tint());
  });
});
