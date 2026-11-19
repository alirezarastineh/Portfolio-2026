import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiRateEvents, aiSettings } from "../db/schema.js";
import { fixtureConfig } from "../test/ask-fixtures.js";
import { resetDb } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import { SYSTEM_CARD_UPDATED } from "./corpus/assistant-docs.js";
import type { AskCorpus } from "./corpus/index.js";
import { fixtureAskCorpus } from "./evals/fixture.js";
import { hashWithSalt, MAP_RATE } from "./guard.js";
import { mapEtag, type PortfolioMap } from "./map.js";
import { invalidateAssistantCache } from "./settings.js";

/**
 * The portfolio's map (visitor plan V15): one language's published pages,
 * dated and related as the corpus holds them, cached by the corpus key, in a
 * bucket of its own, with no model and the assistant off.
 */

let config: AskConfig;
let corpus: (config: AskConfig) => AskCorpus;

/** The eval fixture, with a post dated: the corpus dates what it can (plan phase 19). */
function datedFixture(cfg: AskConfig): AskCorpus {
  const base = fixtureAskCorpus(cfg);
  return {
    ...base,
    documents: base.documents.map((d) =>
      d.id === "post:evals-first@en" ? { ...d, updated: "2026-10-01" } : d,
    ),
  };
}

const app = createApp({
  ask: {
    config: () => config,
    // The map calls no model: a chain asked for fails the test.
    chain: () => {
      throw new Error("the map asked for a model");
    },
    corpus: (c) => Promise.resolve(corpus(c)),
  },
});

const faqDoc = (id: string, title: string) => ({ id, kind: "faq", title, updated: "2026-09-01" });
const cardDoc = (locale: string, title: string) => ({
  id: `system-card@${locale}`,
  kind: "system-card",
  title,
  updated: SYSTEM_CARD_UPDATED,
});

async function map(
  locale = "en",
  headers: Record<string, string> = {},
): Promise<{ status: number; body: PortfolioMap; res: Response }> {
  const res = await app.request(`/v1/ask/map?locale=${locale}`, {
    headers: { "x-forwarded-for": "203.0.113.7", ...headers },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as PortfolioMap, res };
}

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  config = fixtureConfig();
  corpus = datedFixture;
});

describe("GET /v1/ask/map (visitor plan V15)", () => {
  it("lists one language's published pages, dated, with related pages strongest first", async () => {
    const { status, body } = await map("en");
    expect(status).toBe(200);
    expect(body.v).toBe(1);
    expect(body.locale).toBe("en");
    // Pages only: the FAQ, the system card and the CV are the assistant's, not the site's.
    expect(body.pages.map((p) => p.id)).toEqual([
      "profile@en",
      "experience:northwind@en",
      "experience:contoso@en",
      "experience:tum@en",
      "project:atlas@en",
      "project:borealis@en",
      "post:evals-first@en",
      "post:llm-in-production@en",
      "skills@en",
    ]);
    const page = (id: string) => {
      const found = body.pages.find((p) => p.id === id);
      if (!found) {
        throw new Error(`missing page ${id}`);
      }
      return found;
    };
    expect(page("project:atlas@en")).toMatchObject({
      kind: "project",
      title: "Atlas",
      url: "/en/work/atlas",
      related: ["experience:northwind@en"],
    });
    // Strongest first, then in the corpus's order.
    expect(page("experience:northwind@en").related).toEqual([
      "project:atlas@en",
      "project:borealis@en",
    ]);
    // The profile's own links go to the FAQ, which is no page: none are left.
    expect(page("profile@en").related).toEqual([]);
    expect(page("post:evals-first@en").updated).toBe("2026-10-01");
    expect(page("post:llm-in-production@en")).not.toHaveProperty("updated");
    // Every related id names a page of the map, never the page itself.
    const ids = new Set(body.pages.map((p) => p.id));
    const fields = new Set(["id", "kind", "title", "url", "updated", "related"]);
    for (const p of body.pages) {
      expect(p.related.every((id) => ids.has(id) && id !== p.id)).toBe(true);
      // Nothing but the listed fields.
      expect(Object.keys(p).filter((k) => !fields.has(k))).toEqual([]);
    }
  });

  it("lists the assistant's own documents apart, dated, for llms.txt (V21)", async () => {
    const en = await map("en");
    expect(en.body.assistant).toEqual([
      faqDoc("faq:a1c2e3f4@en", "What is his notice period?"),
      faqDoc("faq:b5d6e7f8@en", "Would he relocate?"),
      faqDoc("faq:c9d0e1f2@en", "What are his rates?"),
      cardDoc("en", "How this assistant works"),
    ]);
    // A language's own words only: the second entry has no German ones.
    const de = await map("de");
    expect(de.body.assistant).toEqual([
      faqDoc("faq:a1c2e3f4@de", "Wie lang ist seine Kündigungsfrist?"),
      faqDoc("faq:c9d0e1f2@de", "Wie hoch sind seine Sätze?"),
      cardDoc("de", "Wie dieser Assistent funktioniert"),
    ]);
  });

  it("keeps each language to its own pages", async () => {
    const { body } = await map("de");
    expect(body.locale).toBe("de");
    expect(body.pages.map((p) => p.id)).toEqual([
      "project:atlas@de",
      "profile@de",
      "skills@de",
      "post:kosten-im-griff@de",
    ]);
    expect(body.pages.every((p) => p.url.startsWith("/de"))).toBe(true);
  });

  it("answers a language it does not know with 400", async () => {
    const unknownLocale = await map("fr");
    expect(unknownLocale.status).toBe(400);
    const missingLocale = await app.request("/v1/ask/map");
    expect(missingLocale.status).toBe(400);
  });

  it("is cached by the corpus key: an ETag, a 304 for it, and a new one after a publish", async () => {
    const first = await map("en");
    const etag = first.res.headers.get("etag");
    if (!etag) {
      throw new Error("missing etag header");
    }
    expect(etag).toBe(mapEtag(fixtureAskCorpus(config).key, "en"));
    expect(etag).toMatch(/^W\/"map-en-[0-9a-f]{16}"$/);
    expect(first.res.headers.get("cache-control")).toBe("public, max-age=300");

    const again = await map("en", { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.body).toBeNull();
    // A list of validators, as a browser may send, matches too; the other language's does not.
    const listMatch = await map("en", { "if-none-match": `W/"other", ${etag}` });
    expect(listMatch.status).toBe(304);
    const otherLang = await map("de", { "if-none-match": etag });
    expect(otherLang.status).toBe(200);

    // A publish is a new corpus key: the old validator no longer matches.
    corpus = (c) => ({ ...datedFixture(c), key: "eval-fixture-4|published-again" });
    const after = await map("en", { "if-none-match": etag });
    expect(after.status).toBe(200);
    expect(after.res.headers.get("etag")).not.toBe(etag);
  });

  it("works with the assistant off, calling no model", async () => {
    config = fixtureConfig({ enabled: false });
    await getDb().insert(aiSettings).values({ id: 1, enabled: false });
    invalidateAssistantCache();
    const { status, body } = await map("en");
    expect(status).toBe(200);
    expect(body.pages.length).toBeGreaterThan(0);
  });

  it("limits each address in a bucket of its own", async () => {
    const bucket = `map:${hashWithSalt("ip", "203.0.113.9")}`;
    await getDb()
      .insert(aiRateEvents)
      .values(Array.from({ length: MAP_RATE.perHour }, () => ({ bucket })));
    const res = await app.request("/v1/ask/map?locale=en", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another address, and the visitors' own buckets, are untouched.
    const other = await map("en");
    expect(other.status).toBe(200);
    const visitors = await getDb()
      .select()
      .from(aiRateEvents)
      .where(sql`${aiRateEvents.bucket} like 'ip:%'`);
    expect(visitors).toEqual([]);
  });
});
