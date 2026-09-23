import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { appContentSchema, type AppContent } from "../content/schema";
import { applyHead, serializeJsonLd } from "./head";
import { homeJsonLd, languageAlternates, pageMeta, pageUrl, siteOrigin } from "./seo-meta";

const here = dirname(fileURLToPath(import.meta.url));
const content: AppContent = appContentSchema.parse(
  JSON.parse(readFileSync(resolve(here, "../content/fallback.en.json"), "utf8")),
);

describe("applyHead", () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<title>t</title><link rel="canonical" href="https://old.example/" />';
  });

  it("writes the canonical, every language alternate and the structured data", () => {
    applyHead(document, {
      canonical: "https://site.test/de",
      alternates: languageAlternates("https://site.test", "", "https://site.test/"),
      jsonLd: { "@type": "Thing" },
    });

    const canonicals = document.head.querySelectorAll('link[rel="canonical"]');
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0]!.getAttribute("href")).toBe("https://site.test/de");

    const alternates = Array.from(document.head.querySelectorAll('link[rel="alternate"]')).map(
      (l) => `${l.getAttribute("hreflang")}=${l.getAttribute("href")}`,
    );
    expect(alternates).toEqual([
      "en=https://site.test/en",
      "de=https://site.test/de",
      "x-default=https://site.test/",
    ]);

    const ld = document.head.querySelector('script[type="application/ld+json"]');
    expect(JSON.parse(ld!.textContent!)).toEqual({ "@type": "Thing" });
  });

  /** Client-side navigation must not accumulate tags from earlier pages. */
  it("replaces what the previous page wrote", () => {
    applyHead(document, { canonical: "https://site.test/en", jsonLd: { a: 1 } });
    applyHead(document, { canonical: "https://site.test/en/legal/imprint" });

    expect(document.head.querySelectorAll("[data-seo]")).toHaveLength(1);
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(document.head.querySelector("title")).not.toBeNull();
  });

  it("can clear everything, for a 404", () => {
    applyHead(document, { canonical: "https://site.test/en" });
    applyHead(document, {});
    expect(document.head.querySelectorAll('[data-seo], link[rel="canonical"]')).toHaveLength(0);
  });
});

describe("structured data", () => {
  it("cannot be closed early by content containing </script>", () => {
    const json = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  it("describes the person on a ProfilePage, linking only web profiles", () => {
    const origin = siteOrigin(content);
    const graph = (homeJsonLd(content, "en", origin) as { "@graph": Record<string, unknown>[] })[
      "@graph"
    ];
    const person = graph.find((node) => node["@type"] === "Person")!;
    const page = graph.find((node) => node["@type"] === "ProfilePage")!;

    expect(page["url"]).toBe(pageUrl(origin, "en"));
    expect(page["mainEntity"]).toEqual({ "@id": person["@id"] });
    expect(person["name"]).toBe(content.identity.name);
    for (const href of person["sameAs"] as string[]) expect(href).toMatch(/^https?:\/\//);
  });
});

describe("pageMeta", () => {
  /** Analog updates tags by name but never removes one, so every page must send all of them. */
  it("emits the same tag set for every page", () => {
    const keys = (tags: ReturnType<typeof pageMeta>) =>
      tags.map((t) => ("name" in t ? t.name : "property" in t ? t.property : "")).sort();
    const home = pageMeta(content, "en", {
      title: "a",
      description: "b",
      url: "u",
      robots: "index",
    });
    const legal = pageMeta(content, "de", {
      title: "c",
      description: "d",
      url: "v",
      robots: "noindex",
    });

    expect(keys(home)).toEqual(keys(legal));
    expect(
      legal.find((t) => "property" in t && t.property === "og:locale:alternate"),
    ).toMatchObject({
      content: "en_US",
    });
  });
});
