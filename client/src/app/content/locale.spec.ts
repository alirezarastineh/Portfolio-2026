import { describe, expect, it } from "vitest";

import {
  localeOfPath,
  localeRedirect,
  negotiateLocale,
  pageKey,
  parseAcceptLanguage,
  parseLocaleCookie,
  swapLocale,
  switchTargets,
} from "./locale";

describe("negotiateLocale", () => {
  it("prefers an explicit choice over the browser's languages", () => {
    expect(negotiateLocale("portfolio-lang=en", "de-DE,de;q=0.9")).toBe("en");
  });

  it("falls back to the browser's best supported language", () => {
    expect(negotiateLocale(null, "fr-FR,fr;q=0.9,de;q=0.8,en;q=0.5")).toBe("de");
  });

  it("defaults to English", () => {
    expect(negotiateLocale(undefined, "fr,es")).toBe("en");
    expect(negotiateLocale("", "")).toBe("en");
  });

  it("ignores unsupported and malformed cookie values", () => {
    expect(parseLocaleCookie("portfolio-lang=fr")).toBeNull();
    expect(parseLocaleCookie("portfolio-lang=%E0%A4%A")).toBeNull();
    expect(parseLocaleCookie("other=1; portfolio-lang=de")).toBe("de");
  });

  it("ignores languages the browser rejects with q=0", () => {
    expect(parseAcceptLanguage("de;q=0, en;q=0.5")).toBe("en");
  });
});

describe("path helpers", () => {
  it("reads the locale prefix", () => {
    expect(localeOfPath("/de")).toBe("de");
    expect(localeOfPath("/en/legal/imprint")).toBe("en");
    expect(localeOfPath("/end")).toBeNull();
    expect(localeOfPath("/admin")).toBeNull();
  });

  it("swaps the language, keeping the page, query and fragment", () => {
    expect(swapLocale("/en/legal/imprint?x=1#top", "de")).toBe("/de/legal/imprint?x=1#top");
    expect(swapLocale("/en#projects", "de")).toBe("/de#projects");
    expect(swapLocale("/de", "en")).toBe("/en");
    expect(swapLocale("/somewhere", "de")).toBe("/de");
  });

  it("names the page independently of its language", () => {
    expect(pageKey("/en")).toBe("/");
    expect(pageKey("/de#projects")).toBe("/");
    expect(pageKey("/de/legal/imprint?x=1")).toBe("/legal/imprint");
    expect(pageKey("/en/legal/imprint")).toBe(pageKey("/de/legal/imprint"));
  });
});

describe("localeRedirect", () => {
  it("sends / to the visitor's language, keeping the query", () => {
    expect(localeRedirect("/?utm=x", null, "de-DE")).toEqual({
      status: 302,
      location: "/de?utm=x",
      negotiated: true,
    });
  });

  it("canonicalises case and trailing slashes permanently", () => {
    expect(localeRedirect("/EN", null, null)).toMatchObject({ status: 301, location: "/en" });
    expect(localeRedirect("/de/", null, null)).toMatchObject({ status: 301, location: "/de" });
    expect(localeRedirect("/De/legal/imprint/?a=1", null, null)).toMatchObject({
      status: 301,
      location: "/de/legal/imprint?a=1",
    });
  });

  it("retires routes that no longer exist", () => {
    expect(localeRedirect("/sandbox", null, null)).toMatchObject({ status: 301, location: "/" });
  });

  it("leaves canonical and unrelated paths alone", () => {
    for (const path of [
      "/en",
      "/de/legal/privacy",
      "/admin",
      "/admin/",
      "/api/v1/content/en",
      "/media/x.png",
      "/fr",
    ]) {
      expect(localeRedirect(path, null, "de")).toBeNull();
    }
  });
});

describe("switchTargets", () => {
  it("keeps a page's own versions and sends a missing language to the fallback", () => {
    expect(
      switchTargets({ en: "/en/writing/notes", de: null }, (locale) => `/${locale}/writing`),
    ).toEqual({ en: "/en/writing/notes", de: "/de/writing" });
  });
});
