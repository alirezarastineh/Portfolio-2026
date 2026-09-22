import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { appContentSchema, LOCALES, type AppContent } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));

function loadFallback(locale: string): unknown {
  return JSON.parse(readFileSync(resolve(here, `fallback.${locale}.json`), "utf8"));
}

describe("appContentSchema", () => {
  /**
   * The fallbacks are what the site renders when the API is unreachable, so a
   * schema change that invalidates them must fail here rather than in
   * production during an outage. Regenerate with `pnpm seed:export`.
   */
  for (const locale of LOCALES) {
    it(`accepts the bundled ${locale} fallback`, () => {
      const result = appContentSchema.safeParse(loadFallback(locale));
      expect(result.error?.issues ?? []).toEqual([]);
      expect(result.success).toBe(true);
    });
  }

  it("keeps the interpolation tokens that the templates depend on", () => {
    for (const locale of LOCALES) {
      const content = appContentSchema.parse(loadFallback(locale)) satisfies AppContent;
      expect(content.ui.contact.errorMinlength).toContain("{n}");
      expect(content.ui.contact.errorMaxlength).toContain("{n}");
      expect(content.ui.projectCard.caseLabel).toContain("{i}");
    }
  });

  it("rejects copy that drops an interpolation token", () => {
    const content = appContentSchema.parse(loadFallback("en"));
    const broken = {
      ...content,
      ui: {
        ...content.ui,
        contact: { ...content.ui.contact, errorMinlength: "Too short." },
      },
    };

    expect(appContentSchema.safeParse(broken).success).toBe(false);
  });

  it("keys skills by a stable id rather than array position", () => {
    const content = appContentSchema.parse(loadFallback("en"));
    const ids = content.skills.map((s) => s.id);

    expect(ids).toEqual(["core-architecture", "ai-ml-stack", "devops", "data-pipelines"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("describes the same entities in both locales", () => {
    const en = appContentSchema.parse(loadFallback("en"));
    const de = appContentSchema.parse(loadFallback("de"));

    expect(de.skills.map((s) => s.id)).toEqual(en.skills.map((s) => s.id));
    expect(de.projects.map((p) => p.slug)).toEqual(en.projects.map((p) => p.slug));
    expect(de.identity).toEqual(en.identity);
  });
});
