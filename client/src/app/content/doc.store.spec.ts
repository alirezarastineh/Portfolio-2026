import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocStore } from "./doc.store";

const here = dirname(fileURLToPath(import.meta.url));
const docs = JSON.parse(readFileSync(resolve(here, "fallback-docs.en.json"), "utf8")) as Record<
  string,
  object
>;

describe("DocStore", () => {
  let store: DocStore;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(DocStore);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it("fetches a doc once, however many callers ask, and keeps it", async () => {
    const a = store.ensure("en", "legal", "imprint");
    const b = store.ensure("en", "legal", "imprint");
    backend.expectOne("/api/v2/content/en/legal/imprint").flush(docs["legal:imprint"]);

    const [first, second] = await Promise.all([a, b]);
    expect(first).toBe(second);
    expect(first).toMatchObject({ kind: "legal", doc: "imprint" });

    // Served from memory now: no second request.
    expect(await store.ensure("en", "legal", "imprint")).toBe(first);
  });

  it("answers null for a doc that does not exist", async () => {
    const missing = store.ensure("de", "posts", "nope");
    backend
      .expectOne("/api/v2/content/de/posts/nope")
      .flush({ error: "not_found" }, { status: 404, statusText: "Not Found" });
    expect(await missing).toBeNull();
  });

  it("refuses a doc that does not match the schema", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = store.ensure("en", "legal", "privacy");
    backend.expectOne("/api/v2/content/en/legal/privacy").flush({ kind: "legal", title: 42 });
    await expect(bad).rejects.toThrow(/invalid doc/);
  });

  it("rejects on a real failure rather than pretending the doc is missing", async () => {
    const failing = store.ensure("en", "legal", "imprint");
    backend
      .expectOne("/api/v2/content/en/legal/imprint")
      .flush(null, { status: 503, statusText: "Service Unavailable" });
    await expect(failing).rejects.toBeTruthy();
  });
});
