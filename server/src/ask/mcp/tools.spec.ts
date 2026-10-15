import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../../test/ask-fixtures.js";
import type { AskCorpus } from "../corpus/index.js";
import { fixtureAskCorpus } from "../evals/fixture.js";
import { callTool, DOCUMENT_CHARS } from "./tools.js";

/** Plan phase 32: what `get_document` hands an agent, whatever the document's length. */

const fixture = fixtureAskCorpus(fixtureConfig());

/** The fixture with the English profile's text replaced. */
function withProfile(text: string, siteUrl?: string): AskCorpus {
  const profile = { ...fixture.byId.get("profile@en")!, text };
  return {
    ...fixture,
    ...(siteUrl ? { siteUrl } : {}),
    byId: new Map(fixture.byId).set(profile.id, profile),
  };
}

describe("get_document", () => {
  it("cuts a document past 40,000 characters, and says so", () => {
    const long = `${"a".repeat(DOCUMENT_CHARS)}the part past the cut`;
    const read = callTool(withProfile(long), "get_document", { id: "profile@en" });
    expect(read?.isError).toBeUndefined();
    const doc = read!.structuredContent as { text: string; truncated?: boolean };
    expect(doc.truncated).toBe(true);
    expect(doc.text).toHaveLength(DOCUMENT_CHARS + 1);
    expect(doc.text.endsWith("a…")).toBe(true);
    expect(doc.text).not.toContain("the part past the cut");
  });

  it("hands a document of exactly the limit whole", () => {
    const read = callTool(withProfile("b".repeat(DOCUMENT_CHARS)), "get_document", {
      id: "profile",
    });
    const doc = read!.structuredContent as { text: string; truncated?: boolean };
    expect(doc.truncated).toBeUndefined();
    expect(doc.text).toHaveLength(DOCUMENT_CHARS);
  });

  it("makes the url absolute with the site's origin, and leaves it as it is without one", () => {
    const url = (corpus: AskCorpus) =>
      (callTool(corpus, "get_document", { id: "profile@en" })!.structuredContent as { url: string })
        .url;
    const path = fixture.byId.get("profile@en")!.url;
    expect(url(withProfile("short"))).toBe(path);
    expect(url(withProfile("short", "https://example.test"))).toBe(`https://example.test${path}`);
  });
});
