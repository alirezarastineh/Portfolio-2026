import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, interactive, test } from "./fixtures";

// Content comes from e2e/fixture-content.mjs: `project-one` has a case study in
// both languages, `project-two` in English only; `shipping-rag-to-production`
// is in both, `notes-on-evals` in English only.
const SITE = "https://alirezarastineh.me";

/** The page's JSON-LD graph, parsed, and the types it declares. */
async function jsonLd(request: APIRequestContext, path: string) {
  const html = await (await request.get(path)).text();
  const blocks = [
    ...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ];
  expect(blocks).toHaveLength(1);
  const data = JSON.parse(blocks[0]?.[1] ?? "null") as { "@graph": Record<string, unknown>[] };
  return { graph: data["@graph"], types: data["@graph"].map((node) => node["@type"]) };
}

async function hreflangs(page: Page): Promise<Record<string, string>> {
  const links = page.locator('link[rel="alternate"][hreflang]');
  const out: Record<string, string> = {};
  for (const link of await links.all()) {
    out[(await link.getAttribute("hreflang"))!] = (await link.getAttribute("href"))!;
  }
  return out;
}

/**
 * Prints the page (print media): the site's chrome and `offPage`, all shown on
 * screen first, leave the paper; the article stays, in black on white.
 */
async function expectPaper(page: Page, offPage: Locator[]): Promise<void> {
  const hidden = [
    page.locator(".site-header"),
    page.locator("app-site-footer footer"),
    page.locator(".ask-fab"),
    // The skip link waits above the screen; on paper it would sit at every page's foot.
    page.locator('a[href$="#main"]'),
    ...offPage,
  ];
  for (const locator of hidden) await expect(locator).toBeVisible();

  await page.emulateMedia({ media: "print" });
  for (const locator of hidden) await expect(locator).toBeHidden();
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("main .prose-body").first()).toBeVisible();
  const colours = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return [body.backgroundColor, body.color];
  });
  expect(colours).toEqual(["rgb(255, 255, 255)", "rgb(0, 0, 0)"]);
}

test.describe("case study", () => {
  for (const locale of ["en", "de"] as const) {
    test(`/${locale}/work/project-one renders the full case study`, async ({ page }) => {
      const res = await page.goto(`/${locale}/work/project-one`);
      expect(res?.status()).toBe(200);

      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `${SITE}/${locale}/work/project-one`,
      );
      expect(await hreflangs(page)).toEqual({
        en: `${SITE}/en/work/project-one`,
        de: `${SITE}/de/work/project-one`,
        "x-default": `${SITE}/en/work/project-one`,
      });

      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.getByText(locale === "de" ? "99,95 %" : "99.95%")).toBeVisible();
      await expect(page.locator('main a[href="/' + locale + '#contact"]')).toBeVisible();
    });

    test(`/${locale}/work/project-one declares CreativeWork and a breadcrumb`, async ({
      request,
    }) => {
      const { graph, types } = await jsonLd(request, `/${locale}/work/project-one`);
      expect(types).toEqual(["CreativeWork", "BreadcrumbList"]);
      expect(graph[0]).toMatchObject({
        inLanguage: locale,
        url: `${SITE}/${locale}/work/project-one`,
      });
    });
  }

  test("names a generated social card, which the server draws as a PNG", async ({
    page,
    request,
  }) => {
    await page.goto("/en/work/project-one");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `${SITE}/en/og/work/project-one.png`,
    );

    // Redirects off: a failed render falls back to /og.png, which is a PNG
    // too, so following it would hide the failure.
    const card = await request.get("/en/og/work/project-one.png", { maxRedirects: 0 });
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    expect((await card.body()).subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));

    const post = await request.get("/de/og/writing/shipping-rag-to-production.png", {
      maxRedirects: 0,
    });
    expect(post.status()).toBe(200);
    // No card for what has no page: a project without a case study, an unknown kind.
    expect((await request.get("/en/og/work/project-three.png")).status()).toBe(404);
    expect((await request.get("/en/og/nope/project-one.png")).status()).toBe(404);
    expect((await request.get("/de/og/writing/notes-on-evals.png")).status()).toBe(404);
  });

  test("the body's headings keep their anchors, in the server render too", async ({ request }) => {
    const html = await (await request.get("/en/work/project-one")).text();
    expect(html).toMatch(/<h2[^>]* id="architecture-decisions"[^>]*>Architecture decisions<\/h2>/);
    expect(html).toMatch(/<h3[^>]* id="retrieval"/);
    // The table of contents links to them through the router, not a bare #.
    expect(html).toContain('href="/en/work/project-one#retrieval"');
    // Highlighted at publish time: classes survive Angular's sanitizer.
    expect(html).toContain('<span class="shd-ff7b72 shl-cf222e">const</span>');
  });

  test("the narrative's headings are their names alone, listed in a rail that stays beside the story", async ({
    page,
  }) => {
    await page.goto("/en/work/project-one");
    await interactive(page);
    const main = page.locator("main");
    // The fixed sections read as headings, not the card's capitals (PROBLEM), and unnumbered.
    await expect(
      main.getByRole("heading", { level: 2, name: "Problem", exact: true }),
    ).toBeVisible();
    // The body's own headings look the same, and keep their names too.
    await expect(
      main.getByRole("heading", { level: 2, name: "Architecture decisions", exact: true }),
    ).toBeVisible();
    // From lg the contents are no fold: their links show, and stay in view down the story.
    const contents = page.getByRole("navigation", { name: "On this page" });
    await expect(contents.getByRole("link", { name: "Problem" })).toBeVisible();
    await expect(contents.locator("summary")).toBeHidden();
    await main
      .getByRole("heading", { name: "What I would do differently" })
      .scrollIntoViewIfNeeded();
    await expect(contents.getByRole("link", { name: "Gallery" })).toBeInViewport();
  });

  test("a code block names its language and copies its code", async ({
    page,
    context,
    browserName,
  }) => {
    // Only Chromium lets a test grant clipboard access and read it back.
    const readable = browserName === "chromium";
    if (readable) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/en/work/project-one");
    await interactive(page);
    const frame = page.locator("main .code-frame");
    await expect(frame.locator(".code-tools")).toContainText("ts");
    await frame.getByRole("button", { name: "Copy" }).click();
    await expect(frame.getByRole("button", { name: "Copied" })).toBeVisible();
    if (readable) {
      // Windows' clipboard reads back \r\n.
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied.replaceAll("\r\n", "\n")).toBe(
        'const answer = await retrieve("query");\nreturn answer.text;',
      );
    }

    // Two lines take two lines: the published newline is the only break.
    const lines = await frame.locator("pre").evaluate((pre) => {
      const style = getComputedStyle(pre);
      const inner =
        pre.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      return inner / parseFloat(style.lineHeight);
    });
    expect(lines).toBeCloseTo(2, 1);
  });

  test("code takes the page's colours, in both themes", async ({ page }) => {
    const colour = (selector: string) =>
      page
        .locator(`main .code-block ${selector}`)
        .first()
        .evaluate((el) => getComputedStyle(el).color);
    const token = (name: string) =>
      page.evaluate((name) => {
        const probe = document.createElement("i");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }, name);

    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/en/work/project-one");
      await interactive(page);
      expect(await colour(".shd-ff7b72")).toBe(await token("--accent-orange"));
      expect(await colour(".shd-a5d6ff")).toBe(await token("--data-2"));
      // The themes' purple is gone.
      expect(await colour(".shd-d2a8ff")).toBe(await token("--foreground"));
      await expect(page.locator("main .code-block").first()).toHaveCSS(
        "background-color",
        await token("--card"),
      );
    }
  });

  test("a table-of-contents link scrolls to its section without leaving the page", async ({
    page,
  }) => {
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page
      .getByRole("navigation", { name: "On this page" })
      .getByRole("link", { name: "Retrieval" })
      .click();
    await expect(page).toHaveURL(/\/en\/work\/project-one#retrieval$/);
    await expect(page.locator("#retrieval")).toBeInViewport();
  });

  test("the gallery opens a lightbox that steps through images and closes on Escape", async ({
    page,
    problems,
  }) => {
    await page.goto("/en/work/project-one");
    await interactive(page);

    await page.getByRole("link", { name: /^Open image 1 of 2/ }).click();
    const dialog = page.getByRole("dialog", { name: "Gallery" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("1 / 2");
    const close = dialog.getByRole("button", { name: "Close" });
    await expect(close).toBeFocused();
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("ArrowRight");
    await expect(dialog).toContainText("2 / 2");
    await expect(dialog).toContainText("Latency before and after caching");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(problems.pageErrors).toEqual([]);
  });

  test("links to the next case study, which exists in English only", async ({ page }) => {
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.getByRole("link", { name: /Next project/ }).click();
    await expect(page).toHaveURL(/\/en\/work\/project-two$/);

    // No German version: hreflang says so, and the switch leads to the projects.
    expect(await hreflangs(page)).toEqual({
      en: `${SITE}/en/work/project-two`,
      "x-default": `${SITE}/en/work/project-two`,
    });
    await expect(page.locator('header a[hreflang="de"]').first()).toHaveAttribute(
      "href",
      "/de#projects",
    );
  });

  test("prints its content black on white, without the site around it", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/en/work/project-one");
    await interactive(page);
    const main = page.locator("main");
    await expectPaper(page, [
      main.locator("aside"),
      main.getByRole("link", { name: /Next project/ }),
      main.getByRole("button", { name: "Ask about Atlas" }),
      main.getByRole("button", { name: "Copy" }),
      // What the browser adds to ask about a section or a code block (visitor plan V9).
      main.getByRole("button", { name: "Ask about this section: Problem" }),
      main.getByRole("button", { name: "Explain code block 1" }),
    ]);
    // Code prints in one colour: its highlighting is made for a screen's background.
    const keyword = main.locator(".code-block .shd-ff7b72").first();
    expect(await keyword.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(0, 0, 0)");

    // The assistant's panel, left open, stays off the paper too (plan 4 U8).
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "Ask about my work" }).click();
    const panel = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(panel).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(panel).toBeHidden();
  });

  test("a case study's reader aids: in short, in depth folded, its terms, and on paper", async ({
    page,
    request,
  }) => {
    const plain =
      "A data platform that gathers records from many places, so teams find what they need.";
    const expert =
      "Streaming ingestion with idempotent writes; backfills replay through the same path.";
    // Server-rendered where they are set, and nowhere else.
    const html = await (await request.get("/en/work/project-two")).text();
    expect(html).toContain(plain);
    expect(html).toContain("<details");
    expect(html).toContain("Terms used here");
    const without = await (await request.get("/en/work/project-one")).text();
    expect(without).not.toContain("case-aids");
    expect(without).not.toContain("Terms used here");

    await page.goto("/en/work/project-two");
    await interactive(page);
    const aids = page.locator("main .case-aids");
    await expect(aids.getByRole("heading", { name: "In short" })).toBeVisible();
    await expect(aids.getByText(plain)).toBeVisible();
    await expect(aids.getByText("Drafted with AI, reviewed by Alireza.")).toBeVisible();
    const depth = aids.locator("details");
    expect(await depth.getAttribute("open")).toBeNull();
    await expect(aids.getByText(expert)).toBeHidden();
    await depth.getByText("In depth").click();
    await expect(aids.getByText(expert)).toBeVisible();

    // After the narrative, not in it: no number, no anchor, not in the contents.
    const terms = page.locator("main section").filter({
      has: page.getByRole("heading", { name: "Terms used here" }),
    });
    await expect(terms.locator("dt")).toHaveText(["Ingestion", "Backfill"]);
    await expect(terms.locator("dd").first()).toHaveText(
      "Taking data in from outside sources and storing it for use.",
    );
    const heading = terms.getByRole("heading", { name: "Terms used here" });
    expect(
      await heading.evaluate(
        (h) => h.closest(".case-flow") === null && !h.id && !h.classList.contains("case-h"),
      ),
    ).toBe(true);

    // On paper: the plain summary and the terms; an "In depth" left closed stays off.
    await depth.getByText("In depth").click();
    expect(await depth.getAttribute("open")).toBeNull();
    await page.emulateMedia({ media: "print" });
    await expect(aids.getByText(plain)).toBeVisible();
    await expect(depth).toBeHidden();
    await expect(heading).toBeVisible();
  });

  test("the home page's card opens its case study client-side", async ({ page }) => {
    await page.goto("/en");
    await interactive(page);
    let loads = 0;
    page.on("request", (request) => {
      if (request.resourceType() === "document") loads += 1;
    });

    const link = page.getByRole("link", { name: /^Read case study/ });
    await expect(link).toHaveCount(2);
    await link.first().click();
    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
    await expect(page.locator("main h1")).toBeVisible();
    expect(loads).toBe(0);
  });

  for (const path of [
    "/en/work/nope",
    "/en/work/project-three",
    "/de/work/project-two",
    "/en/work/UPPER",
  ]) {
    test(`${path} is a real, unindexed 404`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(404);
      expect(await res.text()).toMatch(/<meta name="robots" content="noindex/);
    });
  }
});

test.describe("case study on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const top = async (locator: Locator) => (await locator.boundingBox())!.y;

  test("puts the result above the story, with the contents folded between them", async ({
    page,
  }) => {
    await page.goto("/en/work/project-two");
    await interactive(page);
    const main = page.locator("main");
    const fold = main.locator("aside details");
    const order = [
      main.locator(".case-aids"),
      main.locator("app-metrics"),
      fold,
      main.locator("app-picture img").first(),
      main.getByRole("heading", { level: 2, name: "Problem", exact: true }),
    ];
    const tops = await Promise.all(order.map(top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));

    // Folded: the links wait behind "On this page", a 44px row.
    const contents = page.getByRole("navigation", { name: "On this page" });
    await expect(contents.getByRole("link", { name: "Outcomes" })).toBeHidden();
    const summary = fold.locator("summary");
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await summary.tap();
    await expect(contents.getByRole("link", { name: "Outcomes" })).toBeVisible();
  });

  for (const path of ["/de/work/project-one", "/de/writing/shipping-rag-to-production"]) {
    test(`a very long word in ${path}'s title breaks instead of pushing the page sideways`, async ({
      page,
    }) => {
      await page.goto(path);
      await interactive(page);
      await page.locator("main h1").evaluate((h1) => {
        h1.textContent = "Datenbankverbindungsüberwachungswerkzeugkonfiguration";
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    });
  }

  test("a section's ask button shows where nothing hovers, 44px tall", async ({ page }) => {
    await page.goto("/en/work/project-one");
    await interactive(page);
    const ask = page.getByRole("button", { name: "Ask about this section: Problem" });
    await expect(ask).toHaveCSS("opacity", "1");
    expect((await ask.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("code's Copy and Explain show, 44px tall, in the band kept for them", async ({ page }) => {
    await page.goto("/en/work/project-one");
    await interactive(page);
    const frame = page.locator("main .code-frame");
    for (const name of ["Copy", "Explain code block 1"]) {
      const button = frame.getByRole("button", { name });
      await expect(button).toBeVisible();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const tools = (await frame.locator(".code-tools").boundingBox())!;
    expect(tools.y + tools.height).toBeLessThanOrEqual(
      (await frame.locator("code").boundingBox())!.y,
    );
  });

  test("the gallery is a row running to the screen's edge, the next image cut by it", async ({
    page,
  }) => {
    await page.goto("/en/work/project-one");
    await interactive(page);
    const row = page.locator("app-gallery ul");
    await row.scrollIntoViewIfNeeded();
    const box = (await row.boundingBox())!;
    expect(box.x + box.width).toBe(390);
    const images = await row
      .locator("li")
      .evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().toJSON() as DOMRect),
      );
    expect(images[1]!.top).toBe(images[0]!.top);
    expect(images[1]!.left).toBeLessThan(390);
    expect(images[1]!.right).toBeGreaterThan(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
});

test.describe("writing", () => {
  test("a post prints black on white, without its ask and share buttons", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/en/writing/shipping-rag-to-production");
    await interactive(page);
    const main = page.locator("main");
    await expectPaper(page, [
      main.locator("aside"),
      main.getByRole("button", { name: "Ask the assistant about this post" }),
      main.locator("app-share-links"),
    ]);
  });

  test("the index lists this language's posts, newest first, and filters by tag", async ({
    page,
  }) => {
    await page.goto("/en/writing");
    const titles = page.locator("main ol h2");
    await expect(titles).toHaveText(["Shipping RAG to production", "Notes on evals"]);

    await page
      .getByRole("navigation", { name: "Tags" })
      .getByRole("link", { name: "#evals" })
      .click();
    await expect(page).toHaveURL(/\/en\/writing\?tag=evals$/);
    await expect(titles).toHaveText(["Notes on evals"]);
    // A filtered view is the same page: canonical to the unfiltered index.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${SITE}/en/writing`,
    );
  });

  test("the German index lists only the German post", async ({ page }) => {
    await page.goto("/de/writing");
    await expect(page.locator("main ol h2")).toHaveText(["RAG in Produktion bringen"]);
  });

  test("the index: the heading alone, and the tag shown filled in the text colour", async ({
    page,
  }) => {
    await page.goto("/en/writing?tag=rag");
    await interactive(page);
    await expect(page.locator("main header > *")).toHaveText(["Writing", "RSS feed"]);
    const ink = await page.locator("main h1").evaluate((h) => getComputedStyle(h).color);
    const tags = page.getByRole("navigation", { name: "Tags" });
    await expect(tags.locator("[aria-current]")).toHaveText(/^#rag/);
    await expect(tags.locator("[aria-current]")).toHaveCSS("background-color", ink);
  });

  test("a tag with no posts says so in a sentence, with the way back", async ({ page }) => {
    await page.goto("/en/writing?tag=nope");
    await interactive(page);
    const empty = page.locator("main p");
    await expect(empty).toHaveText("No posts with this tag. All posts");
    await empty.getByRole("link", { name: "All posts" }).click();
    await expect(page).toHaveURL(/\/en\/writing$/);
    await expect(page.locator("main ol h2")).toHaveCount(2);
  });

  test("a post ends with share, ask and back, in that order", async ({ page }) => {
    await page.goto("/en/writing/shipping-rag-to-production");
    const end = page.locator("article > footer > *");
    expect(await end.evaluateAll((els) => els.map((el) => el.tagName))).toEqual([
      "APP-SHARE-LINKS",
      "BUTTON",
      "A",
    ]);
    await expect(end.nth(1)).toHaveText("Ask the assistant about this post");
    await expect(end.nth(2)).toHaveText("All posts");
  });

  test("the index declares a Blog and advertises the feed", async ({ page, request }) => {
    await page.goto("/en/writing");
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute(
      "href",
      `${SITE}/en/rss.xml`,
    );
    const { types } = await jsonLd(request, "/en/writing");
    expect(types).toEqual(["Blog", "BreadcrumbList"]);
  });

  for (const locale of ["en", "de"] as const) {
    test(`/${locale}/writing/shipping-rag-to-production is a BlogPosting`, async ({
      page,
      request,
    }) => {
      const res = await page.goto(`/${locale}/writing/shipping-rag-to-production`);
      expect(res?.status()).toBe(200);
      await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
      expect(Object.keys(await hreflangs(page)).sort()).toEqual(["de", "en", "x-default"]);

      const { graph, types } = await jsonLd(
        request,
        `/${locale}/writing/shipping-rag-to-production`,
      );
      expect(types).toEqual(["BlogPosting", "BreadcrumbList"]);
      expect(graph[0]).toMatchObject({
        inLanguage: locale,
        datePublished: "2026-08-12T08:00:00.000Z",
        dateModified: "2026-09-02T08:00:00.000Z",
      });
      expect(graph[1]!["itemListElement"] as unknown[]).toHaveLength(3);
    });
  }

  test("an English-only post: no German alternate, and the switch leads to the German index", async ({
    page,
  }) => {
    await page.goto("/en/writing/notes-on-evals");
    expect(Object.keys(await hreflangs(page)).sort()).toEqual(["en", "x-default"]);
    await expect(page.locator('header a[hreflang="de"]').first()).toHaveAttribute(
      "href",
      "/de/writing",
    );
  });

  for (const path of ["/de/writing/notes-on-evals", "/en/writing/nope"]) {
    test(`${path} is a real, unindexed 404`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(404);
      expect(await res.text()).toMatch(/<meta name="robots" content="noindex/);
    });
  }
});

test.describe("writing on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the filter is one row running to the screen's edge, each tag 44px tall", async ({
    page,
  }) => {
    await page.goto("/en/writing");
    await interactive(page);
    const tags = page.getByRole("navigation", { name: "Tags" }).getByRole("link");
    const boxes = await Promise.all((await tags.all()).map((tag) => tag.boundingBox()));
    expect(new Set(boxes.map((box) => box!.y)).size).toBe(1);
    expect(boxes.every((box) => box!.height >= 44)).toBe(true);

    const row = (await page.locator("main nav ul").boundingBox())!;
    expect(row.x + row.width).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
});

test.describe("feeds and files", () => {
  test("each language has an RSS feed of its own posts", async ({ request }) => {
    const en = await request.get("/en/rss.xml");
    expect(en.status()).toBe(200);
    expect(en.headers()["content-type"]).toContain("application/rss+xml");
    const xml = await en.text();
    expect(xml).toContain(`<atom:link href="${SITE}/en/rss.xml" rel="self"`);
    expect(xml.match(/<item>/g)).toHaveLength(2);

    const de = await (await request.get("/de/rss.xml")).text();
    expect(de.match(/<item>/g)).toHaveLength(1);
    expect(de).toContain("<language>de</language>");

    expect((await request.get("/fr/rss.xml")).status()).toBe(404);
  });

  test("llms.txt indexes the portfolio for language models, in each language", async ({
    request,
  }) => {
    // The convention's root file is the English one.
    for (const path of ["/llms.txt", "/en/llms.txt"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"], path).toContain("text/plain");
      const text = await res.text();
      expect(text, path).toMatch(/^# \S.*\n\n> \S/);
      expect(text, path).toContain(`](${SITE}/en/work/`);
      expect(text, path).toContain(`](${SITE}/en/writing/`);
      // For agents: the read-only MCP endpoint on the API, and the agent card.
      expect(text, path).toMatch(
        /\n- \[MCP\]\(https:\/\/[^)\s]+\/v1\/mcp\): read-only MCP endpoint/,
      );
      // The map, on the same API (visitor plan V21).
      expect(text, path).toMatch(/\n- \[Map\]\(https:\/\/[^)\s]+\/v1\/ask\/map\?locale=en\): /);
      expect(text, path).toContain(`- [Agent card](${SITE}/.well-known/agent-card.json)`);
      expect(text, path).toContain(`- [Deutsche Fassung](${SITE}/de/llms.txt)`);
    }
    const de = await (await request.get("/de/llms.txt")).text();
    expect(de).toContain("## Für Agenten");
    expect(de).toContain(`- [English version](${SITE}/en/llms.txt)`);
    expect((await request.get("/fr/llms.txt")).status()).toBe(404);
  });

  test("the agent card says what the assistant can do, and where its tools are", async ({
    request,
  }) => {
    const res = await request.get("/.well-known/agent-card.json");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const card = (await res.json()) as {
      supportedInterfaces: unknown[];
      provider: { url: string };
      documentationUrl: string;
      description: string;
      skills: { id: string }[];
      capabilities: { extensions: { params: { endpoint: string } }[] };
    };
    expect(card).toMatchObject({
      supportedInterfaces: [],
      provider: { url: SITE },
      documentationUrl: `${SITE}/llms.txt`,
    });
    expect(card.description).toContain("The site's assistant is an AI");
    expect(card.description).toContain("this card lists no A2A interface");
    expect(card.skills.map((s) => s.id)).toEqual([
      "search_portfolio",
      "get_document",
      "list_projects",
      "get_resume",
    ]);
    expect(card.capabilities.extensions[0]!.params.endpoint).toMatch(/^https:\/\/[^/]+\/v1\/mcp$/);
  });

  test("/en/resume.pdf redirects to the uploaded CV", async ({ request }) => {
    const res = await request.get("/en/resume.pdf", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toBe("/media/fixture-cv.pdf");
    expect(res.headers()["content-security-policy"]).toBeUndefined();
  });

  test("the hero offers the CV; the header's one action is getting in touch", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator('#hero a[href="/en/resume.pdf"][download]')).toBeVisible();
    await expect(page.locator('header a[href="/en/resume.pdf"]')).toHaveCount(0);
    await expect(page.locator("header").getByRole("link", { name: "Let’s talk" })).toHaveAttribute(
      "href",
      "/en#contact",
    );
  });

  test("the sitemap lists case studies and posts only where they exist", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const path of [
      "/en/work/project-one",
      "/de/work/project-one",
      "/en/work/project-two",
      "/en/writing",
      "/de/writing",
      "/en/writing/notes-on-evals",
      "/de/writing/shipping-rag-to-production",
    ]) {
      expect(xml).toContain(`<loc>${SITE}${path}</loc>`);
    }
    expect(xml).not.toContain(`<loc>${SITE}/de/work/project-two</loc>`);
    expect(xml).not.toContain(`<loc>${SITE}/de/writing/notes-on-evals</loc>`);
  });
});

test.describe("home: experience", () => {
  test("the timeline groups work, education and certifications", async ({ page }) => {
    await page.goto("/en");
    const section = page.locator("#experience");
    await expect(section.locator("h3")).toHaveText(["Work", "Education", "Certifications"]);
    await expect(section.locator("h4").first()).toHaveText("Senior AI Engineer");
    await expect(section).toContainText("Mar 2024 – Present");
    await expect(section).toContainText("Jan 2021 – Feb 2024");
    await expect(section).toContainText("3 yr 2 mo");
    await expect(section.getByRole("link", { name: /Show credential/ })).toHaveAttribute(
      "href",
      "https://example.com/credential/abc-123",
    );
  });

  test("past three highlights, the rest fold behind “N more”", async ({ page }) => {
    await page.goto("/en");
    const entry = page.locator("#experience article").first();
    const more = entry.locator("details");
    await expect(more.locator("summary")).toHaveText(/2 more/);
    await expect(entry.getByText("Runs the on-call rotation")).toBeHidden();
    await more.locator("summary").click();
    await expect(entry.getByText("Runs the on-call rotation")).toBeVisible();
    // Two highlights and one entry: nothing to fold.
    await expect(page.locator("#experience details")).toHaveCount(1);
  });

  test("hangs from the page's line: a tick per entry, headings above roles, dates in the data face, held from lg", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en");
    const section = page.locator("#experience");
    await expect(section.locator("li > .page-line-node")).toHaveCount(6);
    await expect(section.locator("li > .page-line-node").first()).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const size = (selector: string) =>
      section
        .locator(selector)
        .first()
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(await size("h3")).toBeGreaterThan(await size("h4"));
    const dates = section.locator("time").first();
    await expect(dates).toHaveCSS("font-family", /B612/);
    await expect(dates.locator("..")).toHaveCSS("position", "sticky");
    await expect(section.locator(".chip")).toHaveCount(0);
  });

  test("the header links to it, and to the writing index", async ({ page }) => {
    await page.goto("/de");
    const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link", { name: "Werdegang" })).toHaveAttribute(
      "href",
      "/de#experience",
    );
    await expect(nav.getByRole("link", { name: "Artikel" })).toHaveAttribute("href", "/de/writing");
  });
});

test.describe("home: the line", () => {
  test("runs beside the sections with a node at each heading, unread, and stays off paper", async ({
    page,
  }) => {
    await page.goto("/en");
    const line = page.locator(".page-line");
    const nodes = page.locator("#main h2 .page-line-node");
    await expect(line).toHaveAttribute("aria-hidden", "true");
    await expect(line).toBeVisible();
    // One per rendered section: projects, experience, skills, writing, about, contact.
    await expect(nodes).toHaveCount(6);
    for (const node of await nodes.all()) await expect(node).toHaveAttribute("aria-hidden", "true");

    await page.emulateMedia({ media: "print" });
    await expect(line).toBeHidden();
    await expect(nodes.first()).toBeHidden();
  });
});

test.describe("404", () => {
  test("speaks the site's language and offers a way home and to Ask", async ({ page }) => {
    const res = await page.goto("/de/gibt-es-nicht");
    expect(res?.status()).toBe(404);
    await expect(page.locator("main h1")).toHaveText("Diese Seite gibt es nicht.");
    await expect(page.getByRole("link", { name: /Zur Startseite/ })).toHaveAttribute("href", "/de");
    // "Ask" opens the assistant right here (plan 4 U10).
    await interactive(page);
    await page
      .locator("main")
      .getByRole("button", { name: /Fragen zu meiner Arbeit/ })
      .click();
    await expect(page.getByRole("dialog", { name: "Fragen zu meiner Arbeit" })).toBeVisible();
    // Nothing on the site is near that address, so nothing is suggested.
    await expect(page.locator("main")).not.toContainText("Meinten Sie");
  });

  test("closes on the orange stop and offers what it most likely meant, by name", async ({
    page,
  }) => {
    const res = await page.goto("/en/work/project-on");
    expect(res?.status()).toBe(404);
    const main = page.locator("main");
    await expect(main.locator("h1")).toHaveText("This page isn’t here.");
    await expect(main.locator("h1 span")).toHaveText(".");
    await expect(main).toContainText("Did you mean: Atlas");
    await expect(main.getByRole("link", { name: "Atlas", exact: true })).toHaveAttribute(
      "href",
      "/en/work/project-one",
    );
    // Words, not a shell's.
    await expect(main).not.toContainText("zsh");
    await expect(main).not.toContainText(">_");
    await expect(main).not.toContainText("←");
    await expect(main.locator("h1")).not.toHaveCSS("font-family", /mono/i);
  });

  test("outside the two languages it has one heading and offers both", async ({ page }) => {
    const res = await page.goto("/fr/nope");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page isn’t here.");
    await expect(page.getByRole("link", { name: "Back to the homepage" })).toHaveAttribute(
      "href",
      "/en",
    );
    await expect(page.getByRole("link", { name: "Zur Startseite" })).toHaveAttribute("href", "/de");
  });
});

test("legal and the writing index share the site's one left edge, and legal's headings have anchors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/en/legal/privacy");
  const heading = page.locator("main h1");
  await expect(heading).toHaveClass(/text-h1/);
  await expect(page.locator("main header p")).not.toContainText("//");
  const left = (await heading.boundingBox())?.x;
  // The body's anchors, for a shared `#section` link.
  await expect(page.locator(".prose-body h2").first()).toHaveAttribute("id", "controller");

  await page.goto("/en/writing");
  expect((await page.locator("main h1").boundingBox())?.x).toBe(left);
});
