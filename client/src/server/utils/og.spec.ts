import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { appContentSchema, type AppContent, type Locale } from "../../app/content/schema";
import { OG_SIZE, ogCardFor, ogCardKey, renderOgPng, type OgFonts } from "./og";

const here = dirname(fileURLToPath(import.meta.url));

function fallback(locale: Locale): AppContent {
  const raw = readFileSync(resolve(here, `../../app/content/fallback.${locale}.json`), "utf8");
  return appContentSchema.parse(JSON.parse(raw));
}

/** English content with one case study and one post. */
function content(): AppContent {
  const base = fallback("en");
  const [first, ...rest] = base.projects;
  return {
    ...base,
    projects: [
      {
        ...first!,
        hasCaseStudy: true,
        metrics: [
          { value: "−42%", label: "p95 latency" },
          { value: "3.1×", label: "throughput" },
          { value: "99.95%", label: "uptime" },
          { value: "4", label: "a fourth, not on the card" },
        ],
      },
      ...rest,
    ],
    posts: [
      {
        slug: "shipping-rag",
        title: "Shipping RAG to production",
        excerpt: "What changed between the demo and the first thousand users.",
        publishedAt: "2026-08-12T08:00:00.000Z",
        updatedAt: "2026-09-02T08:00:00.000Z",
        tags: ["rag", "evals"],
        cover: null,
        readingMinutes: 7,
        alternates: { en: "/en/writing/shipping-rag", de: null },
      },
    ],
  };
}

function fonts(): OgFonts {
  const font = (file: string) => readFileSync(resolve(here, `../assets/og/${file}`));
  return {
    regular: font("geist-latin-400-normal.woff"),
    semibold: font("geist-latin-600-normal.woff"),
    mono: font("geist-mono-latin-500-normal.woff"),
  };
}

describe("ogCardFor", () => {
  it("draws a case study from its project: name, hook and the first three metrics", () => {
    const c = content();
    const card = ogCardFor(c, "en", "work", c.projects[0]!.slug);
    expect(card).toMatchObject({
      title: c.projects[0]!.name,
      summary: c.projects[0]!.hook,
      author: "Alireza Rastineh",
      site: "alirezarastineh.me",
    });
    expect(card?.metrics.map((m) => m.value)).toEqual(["−42%", "3.1×", "99.95%"]);
  });

  it("draws a post with its date, reading time and tags", () => {
    const card = ogCardFor(content(), "en", "writing", "shipping-rag");
    expect(card?.title).toBe("Shipping RAG to production");
    expect(card?.meta).toBe("August 12, 2026 · 7 min read · #rag · #evals");
    expect(card?.metrics).toEqual([]);
  });

  it("has no card for an unknown slug or a project without a case study", () => {
    const c = content();
    expect(ogCardFor(c, "en", "writing", "nope")).toBeNull();
    expect(ogCardFor(c, "en", "work", c.projects[1]!.slug)).toBeNull();
  });

  it("keys a card by what it shows", () => {
    const c = content();
    const card = ogCardFor(c, "en", "work", c.projects[0]!.slug)!;
    expect(ogCardKey(card)).toBe(ogCardKey({ ...card }));
    expect(ogCardKey(card)).not.toBe(ogCardKey({ ...card, title: "Renamed" }));
  });
});

describe("renderOgPng", () => {
  it("renders a 1200×630 PNG", async () => {
    const card = ogCardFor(content(), "en", "writing", "shipping-rag")!;
    const png = await renderOgPng(card, fonts());

    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    // IHDR: width and height, big-endian, right after the chunk's length and type.
    expect(png.readUInt32BE(16)).toBe(OG_SIZE.width);
    expect(png.readUInt32BE(20)).toBe(OG_SIZE.height);
  }, 20_000);
});
