import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentStore } from "./content.store";

const here = dirname(fileURLToPath(import.meta.url));
const payload = (locale: string) =>
  JSON.parse(readFileSync(resolve(here, `fallback.${locale}.json`), "utf8")) as object;

describe("ContentStore", () => {
  let store: ContentStore;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(ContentStore);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it("starts empty: nothing is bundled for the browser", () => {
    expect(store.content("en")()).toBeNull();
  });

  it("fetches a locale once, however many callers ask at the same time", async () => {
    const a = store.ensure("de");
    const b = store.ensure("de");
    backend.expectOne("/api/v2/content/de").flush(payload("de"));

    const [first, second] = await Promise.all([a, b]);
    expect(first).toBe(second);
    expect(store.content("de")()).toBe(first);

    // Already loaded: answered without a request (verify() would flag one).
    await expect(store.ensure("de")).resolves.toBe(first);
  });

  it("refuses a payload that does not match the schema, and can retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = store.ensure("en");
    backend.expectOne("/api/v2/content/en").flush({ version: 1, nonsense: true });
    await expect(failing).rejects.toThrow(/invalid content payload/);
    expect(store.content("en")()).toBeNull();

    const retry = store.ensure("en");
    backend.expectOne("/api/v2/content/en").flush(payload("en"));
    await expect(retry).resolves.toMatchObject({ locale: "en" });
  });
});
