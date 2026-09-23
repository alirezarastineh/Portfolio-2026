import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db/client.js";
import { contentDocuments } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { resetDb } from "../test/helpers.js";
import { backfillContentV2 } from "./backfill.js";
import { uiSchema } from "./schema.js";

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

async function uiDocument(locale: "en" | "de") {
  const [row] = await getDb()
    .select({ data: contentDocuments.data, updatedAt: contentDocuments.updatedAt })
    .from(contentDocuments)
    .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, locale)));
  return row!;
}

describe("backfillContentV2", () => {
  it("does nothing before the seed", async () => {
    expect(await backfillContentV2()).toEqual({ ui: 0, legal: 0 });
  });

  it("adds the v2 keys without touching anything edited, and only once", async () => {
    await seed(); // runs the backfill itself
    const before = await uiDocument("de");
    const edited = { ...(before.data as Record<string, unknown>) };
    delete edited["writing"];
    edited["nav"] = { ...(edited["nav"] as object), writing: "Mein Blog" };
    await getDb()
      .update(contentDocuments)
      .set({ data: edited })
      .where(and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, "de")));

    expect(await backfillContentV2()).toEqual({ ui: 1, legal: 0 });
    const after = await uiDocument("de");
    const data = after.data as { nav: { writing: string }; writing: { heading: string } };
    expect(data.nav.writing).toBe("Mein Blog");
    expect(data.writing.heading).toBe("Artikel");
    expect(uiSchema.safeParse(after.data).success).toBe(true);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    expect(await backfillContentV2()).toEqual({ ui: 0, legal: 0 });
  });

  it("creates the legal pages once and never overwrites them", async () => {
    await seed();
    await getDb()
      .update(contentDocuments)
      .set({ data: { title: "Impressum", body: "<p>Mein Text</p>" } })
      .where(and(eq(contentDocuments.section, "imprint"), eq(contentDocuments.locale, "de")));

    await backfillContentV2();
    const [imprint] = await getDb()
      .select({ data: contentDocuments.data })
      .from(contentDocuments)
      .where(and(eq(contentDocuments.section, "imprint"), eq(contentDocuments.locale, "de")));
    expect(imprint!.data).toEqual({ title: "Impressum", body: "<p>Mein Text</p>" });
  });
});
