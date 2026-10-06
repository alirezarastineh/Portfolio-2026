import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../../test/ask-fixtures.js";
import { fixtureAskCorpus } from "../evals/fixture.js";
import type { CorpusDocument, ProjectFacts } from "./build.js";
import { MAX_RELATED, names, relate } from "./related.js";

/** Plan phase 19: the documents an exception may sit in, named in each header. */

const doc = (d: Partial<CorpusDocument> & Pick<CorpusDocument, "id" | "kind">): CorpusDocument => ({
  locale: d.id.endsWith("@de") ? "de" : "en",
  title: d.id,
  url: "/x",
  text: "",
  ...d,
});

const facts = (id: string, stack: string[], tags: string[] = []): ProjectFacts => ({
  id,
  slug: id,
  locale: id.endsWith("@de") ? "de" : "en",
  name: id,
  descriptor: "",
  role: "",
  period: null,
  category: null,
  stack,
  tags,
  metrics: [],
  url: "/x",
  hasCaseStudy: false,
});

const relatedOf = (documents: CorpusDocument[], id: string) =>
  documents.find((d) => d.id === id)?.related;

describe("related documents", () => {
  it("link an employer and the projects that name it, both ways, by its whole name", () => {
    const documents = relate([
      doc({
        id: "experience:nw@en",
        kind: "experience",
        title: "Senior AI Engineer — Northwind Labs",
        text: "Skills: Python",
      }),
      doc({
        id: "project:atlas@en",
        kind: "project",
        title: "Atlas",
        text: "Built at Northwind Labs.",
      }),
      doc({ id: "project:solo@en", kind: "project", title: "Solo", text: "A side project." }),
    ]);
    expect(relatedOf(documents, "experience:nw@en")).toEqual(["project:atlas@en"]);
    expect(relatedOf(documents, "project:atlas@en")).toEqual(["experience:nw@en"]);
    expect(relatedOf(documents, "project:solo@en")).toBeUndefined();
  });

  it("do not link an employer on an ordinary first word of its name", () => {
    const documents = relate([
      doc({ id: "experience:dt@de", kind: "experience", title: "Entwickler — Deutsche Telekom" }),
      doc({ id: "project:mittel@de", kind: "project", text: "Für deutsche Mittelständler." }),
      doc({ id: "experience:os@en", kind: "experience", title: "Engineer — Open Systems" }),
      doc({ id: "project:cli@en", kind: "project", text: "An open-source CLI." }),
    ]);
    expect(documents.every((d) => d.related === undefined)).toBe(true);
  });

  it("show the profile its FAQ entries on its topics first, past the cap of five", () => {
    const faq = Array.from({ length: 6 }, (_, i) =>
      doc({
        id: `faq:${i}@en`,
        kind: "faq",
        text: i === 5 ? "Q: Would he relocate?\nA: Within the EU." : `Q: Question ${i}?\nA: Yes.`,
      }),
    );
    const documents = relate([doc({ id: "profile@en", kind: "profile" }), ...faq]);
    const related = relatedOf(documents, "profile@en")!;
    expect(related).toHaveLength(MAX_RELATED);
    expect(related[0]).toBe("faq:5@en");
  });

  it("link documents that share two stack items, tags or skills, and not one", () => {
    const documents = relate(
      [
        doc({ id: "project:a@en", kind: "project" }),
        doc({ id: "project:b@en", kind: "project" }),
        doc({ id: "project:c@en", kind: "project" }),
        doc({
          id: "experience:x@en",
          kind: "experience",
          title: "Engineer — Contoso",
          text: "Skills: Kafka, Snowflake",
        }),
      ],
      [
        facts("project:a@en", ["Python", "pgvector"], ["rag"]),
        facts("project:b@en", ["python"], ["RAG"]),
        facts("project:c@en", ["Kafka", "Snowflake", "Python"]),
      ],
    );
    // A and B share Python and the rag tag, whatever their case.
    expect(relatedOf(documents, "project:a@en")).toEqual(["project:b@en"]);
    // C shares only Python with either: no link; with the employer, two skills.
    expect(relatedOf(documents, "project:c@en")).toEqual(["experience:x@en"]);
    expect(relatedOf(documents, "experience:x@en")).toEqual(["project:c@en"]);
  });

  it("point a post at the projects it names, as a whole word", () => {
    const documents = relate([
      doc({ id: "project:atlas@en", kind: "project", title: "Atlas" }),
      doc({ id: "project:nova@en", kind: "project", title: "Nova" }),
      doc({ id: "post:one@en", kind: "post", text: "How Atlas cut escalations by 38 %." }),
      doc({ id: "post:two@en", kind: "post", text: "Atlassian and Novatek are other things." }),
    ]);
    expect(relatedOf(documents, "post:one@en")).toEqual(["project:atlas@en"]);
    expect(relatedOf(documents, "post:two@en")).toBeUndefined();
    // From the post only.
    expect(relatedOf(documents, "project:atlas@en")).toBeUndefined();
    expect(names("A word: Atlas.", "Atlas")).toBe(true);
    expect(names("Atlas", "At")).toBe(false);
  });

  it("link the FAQ and the profile, in each language apart", () => {
    const documents = relate([
      doc({ id: "profile@en", kind: "profile" }),
      doc({ id: "profile@de", kind: "profile" }),
      doc({ id: "faq:1@en", kind: "faq" }),
      doc({ id: "faq:1@de", kind: "faq" }),
      doc({ id: "faq:2@en", kind: "faq" }),
    ]);
    expect(relatedOf(documents, "profile@en")).toEqual(["faq:1@en", "faq:2@en"]);
    expect(relatedOf(documents, "profile@de")).toEqual(["faq:1@de"]);
    expect(relatedOf(documents, "faq:2@en")).toEqual(["profile@en"]);
  });

  it("keep the strongest links first, at most five, and leave the rest as they were", () => {
    const projects = Array.from({ length: 7 }, (_, i) =>
      doc({ id: `project:p${i}@en`, kind: "project", text: i === 6 ? "At Northwind." : "" }),
    );
    const input = [
      doc({
        id: "experience:nw@en",
        kind: "experience",
        title: "Engineer — Northwind",
        text: "Skills: Go, Rust",
      }),
      ...projects,
      doc({ id: "skills@en", kind: "skills" }),
    ];
    const documents = relate(
      input,
      projects.map((p) => facts(p.id, ["Go", "Rust"])),
    );
    const employer = relatedOf(documents, "experience:nw@en")!;
    expect(employer).toHaveLength(MAX_RELATED);
    // The project that names the employer outranks those that share skills.
    expect(employer[0]).toBe("project:p6@en");
    expect(documents.at(-1)).toBe(input.at(-1));
  });

  it("give the eval fixture the links its cases lean on", () => {
    const corpus = fixtureAskCorpus(fixtureConfig());
    const related = (id: string) => corpus.byId.get(id)?.related ?? [];
    expect(related("profile@en")).toEqual(
      expect.arrayContaining(["faq:b5d6e7f8@en", "faq:a1c2e3f4@en"]),
    );
    expect(related("faq:b5d6e7f8@en")).toEqual(["profile@en"]);
    // The header carries them, with the date the FAQ entry was saved.
    expect(corpus.core.en).toContain(
      "id: faq:b5d6e7f8@en\ntitle: Would he relocate?\nurl: /en#about\nupdated: 2026-09-01\nrelated: profile@en\n---",
    );
    // So does a search hit, and one without links has none.
    const hits = corpus.search.search("Would he relocate?", { locale: "en" });
    expect(hits.find((h) => h.id === "faq:b5d6e7f8@en")?.related).toEqual(["profile@en"]);
    const plain = corpus.search.search("evals first", { locale: "en" });
    expect(plain.find((h) => h.id === "post:evals-first@en")).not.toHaveProperty("related");
  });
});
