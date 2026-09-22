import { afterEach, describe, expect, it } from "vitest";

import { injectUmami } from "./analytics";

const CONFIG = {
  src: "https://analytics.example.test/script.js",
  websiteId: "0b1d7c3e-0000-4000-8000-000000000000",
  hostname: "example.test",
};

afterEach(() => {
  document.head.innerHTML = "";
});

describe("injectUmami", () => {
  it("adds one deferred tracker tag scoped to the site's hostname", () => {
    injectUmami(document, CONFIG);
    const scripts = document.head.querySelectorAll("script");
    expect(scripts).toHaveLength(1);

    const script = scripts[0]!;
    expect(script.src).toBe(CONFIG.src);
    expect(script.defer).toBe(true);
    expect(script.getAttribute("data-website-id")).toBe(CONFIG.websiteId);
    expect(script.getAttribute("data-domains")).toBe("example.test");
    expect(script.getAttribute("data-do-not-track")).toBe("true");
  });

  /** SSR already rendered it; hydration must not add a second tracker. */
  it("does not add a second tag", () => {
    injectUmami(document, CONFIG);
    injectUmami(document, CONFIG);
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
  });

  it("stays off unless both the script URL and website id are configured", () => {
    injectUmami(document, { ...CONFIG, src: undefined });
    injectUmami(document, { ...CONFIG, websiteId: "" });
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });
});
