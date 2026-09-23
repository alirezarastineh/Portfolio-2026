import { expect, test } from "./fixtures";

const SITE = "https://alirezarastineh.me";

test.describe("locale routing", () => {
  test("/ sends a German browser to /de, privately", async ({ request }) => {
    const res = await request.get("/", {
      headers: { "accept-language": "de-DE,de;q=0.9,en;q=0.5" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toBe("/de");
    expect(res.headers()["vary"]).toMatch(/cookie/i);
    expect(res.headers()["vary"]).toMatch(/accept-language/i);
    expect(res.headers()["cache-control"]).toContain("no-store");
  });

  test("/ honours an explicit choice over the browser's languages", async ({ request }) => {
    const res = await request.get("/", {
      headers: { "accept-language": "de", cookie: "portfolio-lang=en" },
      maxRedirects: 0,
    });
    expect(res.headers()["location"]).toBe("/en");
  });

  for (const [from, to] of [
    ["/EN", "/en"],
    ["/de/", "/de"],
    ["/De/legal/privacy/", "/de/legal/privacy"],
    ["/sandbox", "/"],
  ] as const) {
    test(`${from} → 301 ${to}`, async ({ request }) => {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status()).toBe(301);
      expect(res.headers()["location"]).toBe(to);
    });
  }

  // `/fr` must fall through the locale route's canMatch to the root 404, not
  // render an empty page or redirect.
  for (const path of ["/fr", "/fr/legal/privacy", "/en/does-not-exist", "/en/legal/nope"]) {
    test(`${path} is a real, unindexed 404`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(404);
      expect(await res.text()).toMatch(/<meta name="robots" content="noindex/);
    });
  }
});

test.describe("head", () => {
  for (const locale of ["en", "de"] as const) {
    test(`/${locale} declares its language, canonical and alternates`, async ({ page }) => {
      const res = await page.goto(`/${locale}`);
      expect(res?.status()).toBe(200);

      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `${SITE}/${locale}`,
      );
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
        "href",
        `${SITE}/en`,
      );
      await expect(page.locator('link[rel="alternate"][hreflang="de"]')).toHaveAttribute(
        "href",
        `${SITE}/de`,
      );
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
        "href",
        `${SITE}/`,
      );
      await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
        "content",
        locale === "de" ? "de_DE" : "en_US",
      );
    });

    test(`/${locale} ships one valid JSON-LD graph describing the person`, async ({ request }) => {
      const html = await (await request.get(`/${locale}`)).text();
      const blocks = [
        ...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
      ];
      expect(blocks).toHaveLength(1);

      const graph = JSON.stringify(JSON.parse(blocks[0]?.[1] ?? "null"));
      for (const type of ['"ProfilePage"', '"Person"', '"WebSite"']) expect(graph).toContain(type);
      expect(graph).toContain(`"inLanguage":"${locale}"`);
    });
  }

  test("a legal page is canonical to itself in its own language", async ({ page }) => {
    await page.goto("/de/legal/imprint");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${SITE}/de/legal/imprint`,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      "href",
      `${SITE}/en/legal/imprint`,
    );
  });
});

test.describe("content BFF (v2)", () => {
  test("serves the v2 core, and each doc on its own URL", async ({ request }) => {
    const core = await request.get("/api/v2/content/en");
    expect(core.status()).toBe(200);
    expect(await core.json()).toMatchObject({ version: 2, locale: "en" });

    const imprint = await request.get("/api/v2/content/de/legal/imprint");
    expect(imprint.status()).toBe(200);
    expect(await imprint.json()).toMatchObject({
      kind: "legal",
      doc: "imprint",
      title: "Impressum",
    });
  });

  test("answers 404 for a doc that does not exist, and for the retired v1 route", async ({
    request,
  }) => {
    expect((await request.get("/api/v2/content/en/posts/nope")).status()).toBe(404);
    expect((await request.get("/api/v2/content/en/secrets/x")).status()).toBe(404);
    expect((await request.get("/api/v2/content/fr")).status()).toBe(400);
    expect((await request.get("/api/v1/content/en")).status()).toBe(404);
  });

  test("renders a legal page from its CMS doc, server-side", async ({ request }) => {
    const html = await (await request.get("/en/legal/privacy")).text();
    expect(html).toContain('<div class="prose-body">');
    expect(html).toMatch(/<h2[^>]*>Hosting and server logs<\/h2>/);
    expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}T/);
  });
});

test.describe("crawler surface", () => {
  test("sitemap lists every page in both languages with alternates", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const path of ["/en", "/de", "/en/legal/imprint", "/de/legal/privacy"]) {
      expect(xml).toContain(`<loc>${SITE}${path}</loc>`);
    }
    expect(xml).toContain('hreflang="x-default"');
  });

  test("robots.txt keeps crawlers out of the admin and the BFF", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Disallow: /api/");
  });
});
