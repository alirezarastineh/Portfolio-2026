import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

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

    const card = await request.get("/en/og/work/project-one.png");
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    expect((await card.body()).subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));

    const post = await request.get("/de/og/writing/shipping-rag-to-production.png");
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

  test("a table-of-contents link scrolls to its section without leaving the page", async ({
    page,
  }) => {
    await page.goto("/en/work/project-one");
    await expect(page.locator("#main")).toBeVisible();
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
    await expect(page.locator("#main")).toBeVisible();

    await page.getByRole("link", { name: /^Open image 1 of 2/ }).click();
    const dialog = page.getByRole("dialog", { name: "Gallery" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("1 / 2");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(dialog).toContainText("2 / 2");
    await expect(dialog).toContainText("Latency before and after caching");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(problems.pageErrors).toEqual([]);
  });

  test("links to the next case study, which exists in English only", async ({ page }) => {
    await page.goto("/en/work/project-one");
    await expect(page.locator("#main")).toBeVisible();
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

  test("the home page's card opens its case study client-side", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("#main")).toBeVisible();
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

test.describe("writing", () => {
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

  test("/en/resume.pdf redirects to the uploaded CV", async ({ request }) => {
    const res = await request.get("/en/resume.pdf", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toBe("/media/fixture-cv.pdf");
    expect(res.headers()["content-security-policy"]).toBeUndefined();
  });

  test("the hero and the header offer the CV", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator('#hero a[href="/en/resume.pdf"][download]')).toBeVisible();
    await expect(page.locator('header a[href="/en/resume.pdf"][download]')).toBeVisible();
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

test.describe("404", () => {
  test("speaks the site's language and offers a way home and to Ask", async ({ page }) => {
    const res = await page.goto("/de/gibt-es-nicht");
    expect(res?.status()).toBe(404);
    await expect(page.locator("main h1")).toHaveText("> 404: Seite nicht gefunden");
    await expect(page.getByRole("link", { name: /Zur Startseite/ })).toHaveAttribute("href", "/de");
    await expect(page.getByRole("link", { name: /frag mein Portfolio/ })).toHaveAttribute(
      "href",
      "/de#about",
    );
  });
});
