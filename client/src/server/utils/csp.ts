import { randomBytes } from "node:crypto";

/**
 * The site's Content Security Policy, sent by the SSR server rather than by
 * Caddy: Angular's event replay needs an inline script, so an enforced policy
 * needs a nonce that is new on every request, which only the renderer knows.
 *
 * Everything else is an allowlist of origins, read once from the container's
 * environment — the same public values the browser bundle is built with.
 */

export type CspMode = "enforce" | "report-only" | "off";

export interface CspConfig {
  mode: CspMode;
  /** The API: admin requests, contact form, and media the admin shows from it. */
  apiOrigin: string | null;
  /** Umami: the tracker script and its beacon. */
  analyticsOrigin: string | null;
  /** Sentry: the error reporter's ingest host, and its CSP report endpoint. */
  sentry: SentryCspEndpoint | null;
  /** Cloudflare Turnstile on the contact form and the assistant: its script and its frame. */
  turnstile: boolean;
}

/** Where Turnstile's script and challenge frame come from. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export interface SentryCspEndpoint {
  origin: string;
  reportUri: string;
}

/** Name of the endpoint in `Reporting-Endpoints` that `report-to` refers to. */
export const REPORT_GROUP = "csp-endpoint";

const MODES: readonly CspMode[] = ["enforce", "report-only", "off"];

/** Paths that never render a page: the BFF, proxied media, build assets, framework internals. */
const NON_PAGE_PREFIXES = ["/api/", "/media/", "/assets/", "/_"];

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * True when a request may render HTML, so it needs a nonce and the header.
 * Files (robots.txt, sitemap.xml, favicon.ico) and the prefixes above do not.
 */
export function isPagePath(path: string): boolean {
  const pathname = path.split("?")[0] || "/";
  if (pathname === "/api" || NON_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  return !pathname.slice(pathname.lastIndexOf("/") + 1).includes(".");
}

export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { origin, protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Sentry's CSP report endpoint for a public DSN
 * (`https://<key>@<host>/<project>` → `https://<host>/api/<project>/security/?sentry_key=<key>`).
 */
export function sentryCspEndpoint(dsn: string | undefined): SentryCspEndpoint | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const segments = url.pathname.split("/").filter(Boolean);
    const project = segments.pop();
    if (!url.username || !project || !/^\d+$/.test(project)) return null;
    const prefix = segments.map((segment) => `/${segment}`).join("");
    return {
      origin: url.origin,
      reportUri: `${url.origin}${prefix}/api/${project}/security/?sentry_key=${encodeURIComponent(url.username)}`,
    };
  } catch {
    return null;
  }
}

export function parseMode(value: string | undefined): CspMode {
  const mode = value?.trim().toLowerCase();
  if (!mode) return "enforce";
  if ((MODES as readonly string[]).includes(mode)) return mode as CspMode;
  console.warn(`[csp] unknown CSP_MODE "${value}", enforcing`);
  return "enforce";
}

export function cspConfigFromEnv(env: Record<string, string | undefined>): CspConfig {
  return {
    mode: parseMode(env["CSP_MODE"]),
    apiOrigin: originOf(env["VITE_API_BASE_URL"]),
    analyticsOrigin: originOf(env["VITE_UMAMI_SRC"]),
    sentry: sentryCspEndpoint(env["VITE_SENTRY_DSN"]),
    turnstile: Boolean(env["VITE_TURNSTILE_SITE_KEY"]?.trim()),
  };
}

export function cspHeaderName(mode: Exclude<CspMode, "off">): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

export function buildCsp(nonce: string, config: CspConfig): string {
  const sources = (...values: (string | null)[]) =>
    [...new Set(values.filter((value): value is string => Boolean(value)))].join(" ");

  const nonceSource = `'nonce-${nonce}'`;
  const turnstile = config.turnstile ? TURNSTILE_ORIGIN : null;
  const directives = [
    "default-src 'self'",
    `script-src ${sources("'self'", nonceSource, config.analyticsOrigin, turnstile)}`,
    // GSAP and Angular write style attributes; a nonce cannot cover those.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${sources("'self'", "data:", config.apiOrigin)}`,
    "font-src 'self' data:",
    `connect-src ${sources("'self'", config.apiOrigin, config.analyticsOrigin, config.sentry?.origin ?? null)}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (turnstile) directives.push(`frame-src ${turnstile}`);
  if (config.sentry) {
    // report-uri for browsers without the Reporting API (Firefox, Safari).
    directives.push(`report-uri ${config.sentry.reportUri}`, `report-to ${REPORT_GROUP}`);
  }
  return directives.join("; ");
}
