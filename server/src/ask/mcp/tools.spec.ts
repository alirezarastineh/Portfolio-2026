import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../../test/ask-fixtures.js";
import type { AskCorpus } from "../corpus/index.js";
import { fixtureAskCorpus } from "../evals/fixture.js";
import { callTool, DOCUMENT_CHARS } from "./tools.js";

/** Plan phase 32: what `get_document` hands an agent, whatever the document's length. */

const fixture = fixtureAskCorpus(fixtureConfig());

function docById(corpus: AskCorpus, id: string) {
  const doc = corpus.byId.get(id);
  if (!doc) {
    throw new Error(`Missing fixture document: ${id}`);
  }
  return doc;
}

function callToolResult(corpus: AskCorpus, name: string, args: Record<string, unknown>) {
  const result = callTool(corpus, name, args);
  if (!result) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return result;
}

const urlOf = (corpus: AskCorpus) =>
  (
    callToolResult(corpus, "get_document", { id: "profile@en" }).structuredContent as {
      url: string;
    }
  ).url;

const structured = (name: string, args: Record<string, unknown>, corpus = fixture) =>
  callToolResult(corpus, name, args).structuredContent;

/** The fixture with the English profile's text replaced. */
function withProfile(text: string, siteUrl?: string): AskCorpus {
  const profile = { ...docById(fixture, "profile@en"), text };
  return {
    ...fixture,
    ...(siteUrl ? { siteUrl } : {}),
    byId: new Map(fixture.byId).set(profile.id, profile),
  };
}

describe("get_document", () => {
  it("cuts a document past 40,000 characters, and says so", () => {
    const long = `${"a".repeat(DOCUMENT_CHARS)}the part past the cut`;
    const read = callToolResult(withProfile(long), "get_document", { id: "profile@en" });
    expect(read.isError).toBeUndefined();
    const doc = read.structuredContent as { text: string; truncated?: boolean };
    expect(doc.truncated).toBe(true);
    expect(doc.text).toHaveLength(DOCUMENT_CHARS + 1);
    expect(doc.text.endsWith("a…")).toBe(true);
    expect(doc.text).not.toContain("the part past the cut");
  });

  it("hands a document of exactly the limit whole", () => {
    const read = callToolResult(withProfile("b".repeat(DOCUMENT_CHARS)), "get_document", {
      id: "profile",
    });
    const doc = read.structuredContent as { text: string; truncated?: boolean };
    expect(doc.truncated).toBeUndefined();
    expect(doc.text).toHaveLength(DOCUMENT_CHARS);
  });

  it("makes the url absolute with the site's origin, and leaves it as it is without one", () => {
    const path = docById(fixture, "profile@en").url;
    expect(urlOf(withProfile("short"))).toBe(path);
    expect(urlOf(withProfile("short", "https://example.test"))).toBe(`https://example.test${path}`);
  });
});

describe("the day a document last changed, and its related documents (visitor plan V21)", () => {
  const FAQ = "faq:a1c2e3f4@en";

  it("get_document gives both, before the text", () => {
    const doc = structured("get_document", { id: FAQ });
    expect(doc).toMatchObject({ id: FAQ, updated: "2026-09-01", related: ["profile@en"] });
    const keys = Object.keys(doc);
    expect(keys.indexOf("related")).toBeLessThan(keys.indexOf("text"));
  });

  it("get_document leaves out what a document does not have", () => {
    const bare = { ...docById(fixture, FAQ) };
    delete bare.updated;
    delete bare.related;
    const corpus = { ...fixture, byId: new Map(fixture.byId).set(FAQ, bare) };
    const doc = structured("get_document", { id: FAQ }, corpus);
    expect(doc).not.toHaveProperty("updated");
    expect(doc).not.toHaveProperty("related");
  });

  it("search_portfolio's hits give their document's day, where it has one", () => {
    const { results } = structured("search_portfolio", { query: "notice period" }) as {
      results: { id: string; updated?: string }[];
    };
    expect(results).toContainEqual(expect.objectContaining({ id: FAQ, updated: "2026-09-01" }));
    for (const hit of results) {
      const day = docById(fixture, hit.id).updated;
      if (day) {
        expect(hit.updated).toBe(day);
      } else {
        expect(hit).not.toHaveProperty("updated");
      }
    }
  });
});
