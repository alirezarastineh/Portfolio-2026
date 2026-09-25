import { describe, expect, it, vi } from "vitest";

import {
  buildCsp,
  cspConfigFromEnv,
  cspHeaderName,
  isPagePath,
  newNonce,
  originOf,
  parseMode,
  sentryCspEndpoint,
  type CspConfig,
} from "./csp";

const PROD_ENV = {
  CSP_MODE: "enforce",
  VITE_API_BASE_URL: "https://api.alirezarastineh.me",
  VITE_UMAMI_SRC: "https://analytics.alirezarastineh.me/script.js",
  VITE_SENTRY_DSN: "https://abc123@o4501.ingest.de.sentry.io/4502",
};

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values];
    }),
  );
}

describe("newNonce", () => {
  it("is 128 random bits in base64, different every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("isPagePath", () => {
  it("accepts rendered pages, including 404s and the admin", () => {
    for (const path of ["/", "/en", "/de/legal/privacy", "/en/nope?x=1", "/fr", "/admin/login"]) {
      expect(isPagePath(path), path).toBe(true);
    }
  });

  it("skips the BFF, media, build assets, internals and files", () => {
    for (const path of [
      "/api",
      "/api/v1/content/en",
      "/media/a.webp",
      "/assets/index-abc.js",
      "/_analog/x",
      "/robots.txt",
      "/sitemap.xml",
      "/favicon.ico",
      "/.well-known/security.txt",
    ]) {
      expect(isPagePath(path), path).toBe(false);
    }
  });
});

describe("originOf", () => {
  it("keeps only the origin of http(s) URLs", () => {
    expect(originOf("https://analytics.example.com/script.js")).toBe(
      "https://analytics.example.com",
    );
    expect(originOf("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  });

  it("drops empty, malformed and non-web URLs", () => {
    expect(originOf(undefined)).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("javascript:alert(1)")).toBeNull();
  });
});

describe("sentryCspEndpoint", () => {
  it("derives the security endpoint from a public DSN", () => {
    expect(sentryCspEndpoint(PROD_ENV.VITE_SENTRY_DSN)).toEqual({
      origin: "https://o4501.ingest.de.sentry.io",
      reportUri: "https://o4501.ingest.de.sentry.io/api/4502/security/?sentry_key=abc123",
    });
  });

  it("keeps a DSN's path prefix", () => {
    expect(sentryCspEndpoint("https://k@sentry.example.com/prefix/7")?.reportUri).toBe(
      "https://sentry.example.com/prefix/api/7/security/?sentry_key=k",
    );
  });

  it("ignores missing or malformed DSNs", () => {
    expect(sentryCspEndpoint(undefined)).toBeNull();
    expect(sentryCspEndpoint("https://o1.ingest.sentry.io/1")).toBeNull();
    expect(sentryCspEndpoint("https://k@o1.ingest.sentry.io/")).toBeNull();
    expect(sentryCspEndpoint("nonsense")).toBeNull();
  });
});

describe("parseMode", () => {
  it("enforces by default", () => {
    expect(parseMode(undefined)).toBe("enforce");
    expect(parseMode(" ")).toBe("enforce");
  });

  it("accepts the three modes, case-insensitively", () => {
    expect(parseMode("Report-Only")).toBe("report-only");
    expect(parseMode("off")).toBe("off");
    expect(parseMode("enforce")).toBe("enforce");
  });

  it("enforces (and warns) on a typo rather than switching the policy off", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseMode("reportonly")).toBe("enforce");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("cspHeaderName", () => {
  it("maps the mode to the header", () => {
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
  });
});

describe("buildCsp", () => {
  it("allows the nonce and exactly the configured origins", () => {
    const policy = directives(buildCsp("n0nce", cspConfigFromEnv(PROD_ENV)));

    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("script-src")).toEqual([
      "'self'",
      "'nonce-n0nce'",
      "https://analytics.alirezarastineh.me",
    ]);
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "https://api.alirezarastineh.me"]);
    expect(policy.get("connect-src")).toEqual([
      "'self'",
      "https://api.alirezarastineh.me",
      "https://analytics.alirezarastineh.me",
      "https://o4501.ingest.de.sentry.io",
    ]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("report-uri")).toEqual([
      "https://o4501.ingest.de.sentry.io/api/4502/security/?sentry_key=abc123",
    ]);
    expect(policy.get("report-to")).toEqual(["csp-endpoint"]);
  });

  it("never allows inline or eval'd script without the nonce", () => {
    const script = directives(buildCsp("n", cspConfigFromEnv(PROD_ENV))).get("script-src") ?? [];
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("stays tight when the optional services are off", () => {
    const config: CspConfig = {
      mode: "enforce",
      apiOrigin: null,
      analyticsOrigin: null,
      sentry: null,
      turnstile: false,
    };
    const policy = directives(buildCsp("n", config));

    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-n'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:"]);
    expect(policy.has("frame-src")).toBe(false);
    expect(policy.has("report-uri")).toBe(false);
    expect(policy.has("report-to")).toBe(false);
  });

  it("opens Turnstile's script and frame only when a site key is set", () => {
    const off = directives(buildCsp("n", cspConfigFromEnv({ VITE_TURNSTILE_SITE_KEY: " " })));
    expect(off.has("frame-src")).toBe(false);

    const on = directives(buildCsp("n", cspConfigFromEnv({ VITE_TURNSTILE_SITE_KEY: "0x4AAA" })));
    expect(on.get("script-src")).toContain("https://challenges.cloudflare.com");
    expect(on.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(on.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("lists an origin once when two services share it", () => {
    const config: CspConfig = {
      mode: "enforce",
      apiOrigin: "https://x.example",
      analyticsOrigin: "https://x.example",
      sentry: null,
      turnstile: false,
    };
    expect(directives(buildCsp("n", config)).get("connect-src")).toEqual([
      "'self'",
      "https://x.example",
    ]);
  });
});
