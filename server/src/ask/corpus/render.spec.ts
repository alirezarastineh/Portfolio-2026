import { describe, expect, it } from "vitest";

import type { CorpusDocument } from "./build.js";
import {
  applyTiers,
  CORE_LIMIT,
  coreView,
  facts,
  FORMAT_SAMPLE,
  incompleteTranslation,
  PROMOTED_CHARS,
  renderCompact,
  renderCore,
} from "./render.js";

const doc = (d: Partial<CorpusDocument> & Pick<CorpusDocument, "id">): CorpusDocument => ({
  kind: "project",
  locale: d.id.endsWith("@de") ? "de" : "en",
  title: d.id,
  url: "/x",
  text: `Text of ${d.id}`,
  ...d,
});

/** Part C's renderer, verbatim: the oracle for layout "both". */
function partC(documents: CorpusDocument[]): { core: string; compact: string } {
  const header = (d: CorpusDocument) =>
    ["---", `id: ${d.id}`, `title: ${d.title}`, `url: ${d.url}`, "---"].join("\n");
  const clip = (text: string, limit: number | undefined, id: string) => {
    if (!limit || text.length <= limit) return text;
    const cut = text.lastIndexOf("\n", limit);
    return `${text.slice(0, cut > limit / 2 ? cut : limit)}\n[… continues: get_document("${id}")]`;
  };
  const parts: string[] = [];
  let total = 0;
  for (const d of documents) {
    const body = d.text.length > 420 ? `${d.text.slice(0, 420)}…` : d.text;
    const part = `[${d.id}] ${d.title} (${d.url})\n${body}`;
    if (total + part.length > 40_000) break;
    parts.push(part);
    total += part.length;
  }
  return {
    core: documents
      .map((d) => `${header(d)}\n${clip(d.text, CORE_LIMIT[d.kind], d.id)}`)
      .join("\n\n"),
    compact: parts.join("\n\n"),
  };
}

const ids = (list: readonly CorpusDocument[]) => list.map((d) => d.id);

const corpus: CorpusDocument[] = [
  doc({ id: "profile@en", kind: "profile", text: "Profile. Contact: a@b.de" }),
  doc({ id: "project:atlas@en", text: "Atlas, 38 % fewer escalations, 120 agents" }),
  doc({ id: "project:only-en@en", text: "Only in English." }),
  doc({ id: "skills@en", kind: "skills", text: "TypeScript, Python" }),
  doc({ id: "profile@de", kind: "profile", text: "Profil. Kontakt: a@b.de" }),
  doc({ id: "project:atlas@de", text: "Atlas, 38 % weniger Eskalationen" }),
  doc({ id: "post:nur-de@de", kind: "post", text: "Nur auf Deutsch." }),
  doc({ id: "skills@de", kind: "skills", text: "TypeScript, Python" }),
  doc({ id: "faq:1@en", kind: "faq", text: "Q: Notice?\nA: One month." }),
  doc({ id: "system-card@en", kind: "system-card", text: "How it works." }),
  doc({ id: "faq:1@de", kind: "faq", text: "Q: Frist?\nA: Ein Monat." }),
  doc({ id: "system-card@de", kind: "system-card", text: "Wie er funktioniert." }),
];

describe("the facts a translation must keep", () => {
  it("are numbers whatever their separators, emails and links", () => {
    expect([...facts("40,000 docs, 1.4 s, 38 %")]).toEqual(["40000", "14", "38"]);
    expect([...facts("40.000 Dokumente, 1,4 s, 38 %")]).toEqual(["40000", "14", "38"]);
    expect(facts("Mail Hello@Example.org, or (a.b+c@x.co.uk).")).toEqual(
      new Set(["hello@example.org", "a.b+c@x.co.uk"]),
    );
    expect(facts("See https://github.com/x/y). And [docs](https://a.de/b?c=x).")).toEqual(
      new Set(["https://github.com/x/y", "https://a.de/b?c=x"]),
    );
    expect(facts("no @handle or e-mail@ here")).toEqual(new Set());
  });

  it("make a short or fact-poor version incomplete, and a full one complete", () => {
    const en = doc({
      id: "project:a@en",
      text: "Atlas: 38 % fewer escalations, used by 120 agents.",
    });
    const fullDe = doc({
      id: "project:a@de",
      text: "Atlas: 38 % weniger Eskalationen, von 120 Agenten.",
    });
    const missing = doc({
      id: "project:a@de",
      text: "Atlas: 38 % weniger Eskalationen, für Agenten.",
    });
    const short = doc({ id: "project:a@de", text: "Atlas: 38, 120." });
    expect(incompleteTranslation(fullDe, en)).toBe(false);
    expect(incompleteTranslation(missing, en)).toBe(true);
    expect(incompleteTranslation(short, en)).toBe(true);
  });
});

describe("the core per reading locale", () => {
  it("holds the reading language's documents and lists complete translations as handles", () => {
    const view = coreView(corpus, "en");
    expect(ids(view.resident)).toEqual([
      "profile@en",
      "project:atlas@en",
      "project:only-en@en",
      "post:nur-de@de",
      "skills@en",
      "faq:1@en",
      "system-card@en",
    ]);
    expect(ids(view.handles)).toEqual([
      "profile@de",
      "project:atlas@de",
      "skills@de",
      "faq:1@de",
      "system-card@de",
    ]);
  });

  it("keeps the other version beside an incomplete translation, and documents in one language only", () => {
    // atlas@de lacks the 120 agents: both versions, side by side, the reading one first.
    const view = coreView(corpus, "de");
    expect(ids(view.resident)).toEqual([
      "profile@de",
      "project:atlas@de",
      "project:atlas@en",
      "project:only-en@en",
      "post:nur-de@de",
      "skills@de",
      "faq:1@de",
      "system-card@de",
    ]);
    expect(ids(view.handles)).toEqual(["profile@en", "skills@en", "faq:1@en", "system-card@en"]);
  });

  it("drops nothing: every document has a header or a handle line", () => {
    for (const reading of ["en", "de"] as const) {
      const core = renderCore(corpus, reading);
      for (const d of corpus) {
        expect(core.includes(`id: ${d.id}\n`)).not.toBe(core.includes(`- ${d.id}: `));
      }
    }
  });

  it("puts the profile first, the handles before the FAQ, the system card last", () => {
    const core = renderCore(corpus, "en");
    expect(core.startsWith("---\nid: profile@en\n")).toBe(true);
    expect(core.indexOf("## Also in German")).toBeGreaterThan(core.indexOf("id: skills@en"));
    expect(core.indexOf("## Also in German")).toBeLessThan(core.indexOf("id: faq:1@en"));
    expect(core.trimEnd().endsWith("How it works.")).toBe(true);
    expect(core).toContain("- project:atlas@de: project:atlas@de (/x)");
    expect(renderCore(corpus, "de")).toContain("## Also in English");
  });

  it("is the same bytes for the same documents, and none without handles to list", () => {
    expect(renderCore(corpus, "de")).toBe(renderCore(structuredClone(corpus), "de"));
    const english = corpus.filter((d) => d.locale === "en");
    expect(renderCore(english, "en")).not.toContain("## Also in");
  });

  it("clips long documents at their kind's limit", () => {
    const long = doc({ id: "project:long@en", text: "line\n".repeat(1_000) });
    const core = renderCore([long], "en");
    expect(core).toContain('[… continues: get_document("project:long@en")]');
    expect(core.length).toBeLessThan(CORE_LIMIT.project! + 200);
  });
});

describe("tiers", () => {
  const long = (id: string) => doc({ id, text: "line of a case study\n".repeat(400) });

  it("hold a promoted document whole at the front, in either language, and cut a demoted one shorter", () => {
    const documents = applyTiers(
      [...corpus, long("project:big@en"), long("project:big@de"), long("project:small@en")],
      { promoted: ["project:big@de", "skills@en", "nothing@en"], demoted: ["project:small@en"] },
    );
    const view = coreView(documents, "en");
    expect(ids(view.resident).slice(0, 3)).toEqual(["profile@en", "skills@en", "project:big@de"]);
    expect(ids(view.handles)).not.toContain("project:big@de");

    const core = renderCore(documents, "en");
    const block = (id: string) => core.slice(core.indexOf(`id: ${id}\n`)).split("\n\n---")[0]!;
    expect(block("project:big@de")).not.toContain("continues: get_document");
    expect(block("project:big@de").length).toBeGreaterThan(8_000);
    expect(block("project:big@en")).toContain("continues: get_document");
    expect(block("project:small@en").length).toBeLessThan(CORE_LIMIT.project! / 2 + 200);
    expect(PROMOTED_CHARS).toBe(12_000);
  });

  it("are marked on the documents and replaced, never added to", () => {
    const once = applyTiers(corpus, { promoted: ["skills@en"], demoted: [] });
    expect(once.find((d) => d.id === "skills@en")?.tier).toBe("promoted");
    const again = applyTiers(once, { promoted: [], demoted: ["skills@en"] });
    expect(again.find((d) => d.id === "skills@en")?.tier).toBe("demoted");
    expect(applyTiers(again, { promoted: [], demoted: [] }).some((d) => "tier" in d)).toBe(false);
  });
});

describe("the compact corpus", () => {
  it("holds the resident documents only, in the core's order", () => {
    const compact = renderCompact(corpus, "en");
    expect(compact.startsWith("[profile@en]")).toBe(true);
    expect(compact).toContain("[post:nur-de@de]");
    expect(compact).not.toContain("[profile@de]");
  });
});

describe("Part C's layout", () => {
  it("is kept byte for byte, for the pairwise gate and older answers", () => {
    const documents = [...corpus, doc({ id: "project:long@en", text: "line\n".repeat(1_000) })];
    for (const reading of ["en", "de"] as const) {
      expect(renderCore(documents, reading, "both")).toBe(partC(documents).core);
      expect(renderCompact(documents, reading, "both")).toBe(partC(documents).compact);
    }
  });

  it("is also what the format sample renders under it", () => {
    expect(renderCore(FORMAT_SAMPLE, "en", "both")).toBe(partC([...FORMAT_SAMPLE]).core);
  });
});

describe("the format sample prompt.ts hashes", () => {
  it("reaches every limit, so a change to any of them changes the hash", () => {
    const core = renderCore(FORMAT_SAMPLE, "en");
    const block = (id: string) => core.slice(core.indexOf(`id: ${id}\n`)).split("\n\n---")[0]!;
    // Promoted: past the kind's limit, cut only at PROMOTED_CHARS.
    expect(block("post:one@en")).toContain('[… continues: get_document("post:one@en")]');
    expect(block("post:one@en").length).toBeGreaterThan(PROMOTED_CHARS - 100);
    expect(block("post:one@en").length).toBeLessThan(PROMOTED_CHARS + 200);
    // Demoted: cut at half the kind's limit; the plain long project at the whole limit.
    expect(block("project:cut@en")).toContain("continues: get_document");
    expect(block("project:cut@en").length).toBeLessThan(CORE_LIMIT.project! / 2 + 200);
    expect(block("project:long@en").length).toBeGreaterThan(CORE_LIMIT.project! - 100);
    // Every placement rule: handles, both versions of an incomplete translation, one language only.
    const german = renderCore(FORMAT_SAMPLE, "de");
    expect(core).toContain("## Also in German\n");
    expect(core).toContain("\n- project:long@de: Lang (/de/work/long, updated 2026-09-20)");
    // Plan phase 19: when it changed and what it relates to, in a core per language only.
    expect(core).toContain(
      "id: profile@en\ntitle: P\nurl: /en\nupdated: 2026-10-01\nrelated: faq:1@en\n---",
    );
    expect(core).toContain("url: /en#experience\nrelated: project:short@en\n---");
    const partC = renderCore(FORMAT_SAMPLE, "en", "both");
    expect(partC).not.toContain("updated:");
    expect(partC).not.toContain("related:");
    expect(german).toContain("---\nid: project:short@de\n");
    expect(german).toContain("---\nid: project:short@en\n");
    expect(core).toContain("---\nid: post:nur-de@de\n");
  });
});
