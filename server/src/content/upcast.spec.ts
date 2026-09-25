import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { appContentSchema, type AppContent } from "./schema.js";
import * as v1 from "./schema-v1.js";
import { UI_V2_ADDITIONS, fillMissing, withUiDefaults } from "./ui-defaults.js";
import { payloadVersion, upcast, upcastDocs } from "./upcast.js";

/** A real v1 payload: the seed as it was published before v2. */
function v1Payload(): v1.AppContent {
  const seed = JSON.parse(
    readFileSync(resolve(process.cwd(), "src/db/seed/seed.json"), "utf8"),
  ) as {
    identity: v1.AppContent["identity"];
    socials: v1.AppContent["socials"];
    skills: (v1.Skill & {
      translations: Record<string, { title: string; caption: string; narrative: string }>;
    })[];
    documents: {
      ui: Record<string, v1.AppContent["ui"]>;
      seo: Record<string, v1.AppContent["seo"]>;
    };
  };
  return v1.appContentSchema.parse({
    version: 1,
    locale: "en",
    ui: seed.documents.ui["en"],
    identity: seed.identity,
    socials: seed.socials.map(({ label, href, icon }) => ({ label, href, icon })),
    skills: seed.skills.map(({ id, icon, span, items, translations }) => ({
      id,
      icon,
      span,
      items,
      ...translations["en"],
    })),
    projects: [
      {
        slug: "atlas",
        name: "Atlas",
        descriptor: "",
        hook: "",
        problem: "",
        aiArchitecture: "",
        fullStackInfra: "",
        outcomes: [],
        stack: [],
        image: "https://api.alirezarastineh.me/media/abc.webp",
        links: { live: "", repo: "", caseStudy: "" },
      },
    ],
    seo: seed.documents.seo["en"],
  });
}

describe("upcast", () => {
  it("turns a v1 payload into valid v2, keeping every v1 value", () => {
    const old = v1Payload();
    const result = upcast(old, "2026-01-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const content = result.content satisfies AppContent;
    expect(result.from).toBe(1);
    expect(appContentSchema.safeParse(content).success).toBe(true);
    expect(content.ui.profile).toEqual(old.ui.profile);
    expect(content.ui.writing).toEqual(UI_V2_ADDITIONS.en.writing);
    expect(content.identity.siteUrl).toBe(new URL(old.seo.canonical).origin);
    expect(content.projects[0]).toMatchObject({
      cover: { src: "/media/abc.webp", srcset: "", alt: "Atlas" },
      hasCaseStudy: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(content.legal.map((l) => l.doc)).toEqual(["imprint", "privacy"]);
  });

  it("passes v2 through and reports what does not validate", () => {
    const v2 = (upcast(v1Payload(), "2026-01-01T00:00:00.000Z") as { content: AppContent }).content;
    expect(upcast(v2, "x")).toMatchObject({ ok: true, from: 2 });
    expect(upcast({ version: 1, nonsense: true }, "x").ok).toBe(false);
    expect(upcast({ version: 2 }, "x").ok).toBe(false);
    expect(payloadVersion({ version: 1 })).toBe(1);
    expect(payloadVersion(null)).toBeNull();
  });

  it("gives a v1 version the bundled legal pages as docs", async () => {
    const docs = await upcastDocs(1, "de", []);
    expect([...docs.keys()]).toEqual(["legal:imprint", "legal:privacy"]);
    expect(docs.get("legal:imprint")).toMatchObject({ kind: "legal", title: "Impressum" });
  });
});

describe("fillMissing", () => {
  it("fills only missing keys, at any depth, and never overwrites", () => {
    expect(
      fillMissing({ a: 1, b: { c: "kept" } }, { a: 2, b: { c: "x", d: "new" }, e: "added" }),
    ).toEqual({
      a: 1,
      b: { c: "kept", d: "new" },
      e: "added",
    });
  });

  it("adds every v2 ui key to a v1 ui tree", () => {
    const ui = withUiDefaults(v1Payload().ui, "en") as Record<string, Record<string, string>>;
    expect(ui["nav"]!["writing"]).toBe("Writing");
    expect(ui["nav"]!["skills"]).toBe(v1Payload().ui.nav.skills);
    expect(ui["ask"]).toEqual(UI_V2_ADDITIONS.en.ask);
  });
});
