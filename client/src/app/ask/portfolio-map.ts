import type { Locale } from "../content/locale";
import { apiBaseUrl } from "../services/api-base";

/**
 * The portfolio's map (visitor plan V15), as `GET /v1/ask/map` serves it: one
 * language's published pages, dated and related (server/src/ask/map.ts). Read
 * next and what's new are worked out from it here, with no model.
 */

export type MapKind = "profile" | "experience" | "project" | "post" | "skills";

export interface MapPage {
  /** The corpus's id: `project:atlas@en`. */
  id: string;
  kind: MapKind;
  title: string;
  /** The page's path: a case study, a post, or a section of home. */
  url: string;
  /** `YYYY-MM-DD`, where the server dates it. */
  updated?: string;
  /** Related pages, strongest first. */
  related: string[];
}

const KINDS: ReadonlySet<string> = new Set(["profile", "experience", "project", "post", "skills"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Raw = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** A page as the response lists it, or null when anything about it is off. */
function pageOf(raw: unknown): MapPage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Raw;
  const id = str(r["id"]);
  const kind = str(r["kind"]);
  const title = str(r["title"]);
  const url = str(r["url"]);
  // Only the site's own paths: a link built from this goes nowhere else.
  if (!id || !KINDS.has(kind) || !title || !url.startsWith("/") || url.startsWith("//")) {
    return null;
  }
  const updated = str(r["updated"]);
  const related = Array.isArray(r["related"])
    ? (r["related"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return {
    id,
    kind: kind as MapKind,
    title,
    url,
    ...(DAY.test(updated) ? { updated } : {}),
    related,
  };
}

/** The pages a response lists, each one checked: what is malformed is left out. */
export function mapPages(raw: unknown): MapPage[] {
  const pages = raw && typeof raw === "object" ? (raw as Raw)["pages"] : null;
  return Array.isArray(pages) ? pages.flatMap((p) => pageOf(p) ?? []) : [];
}

/** Each language's map, fetched once per page view; the browser's cache revalidates it. */
const fetched = new Map<Locale, Promise<MapPage[] | null>>();

export function fetchMap(
  locale: Locale,
  get: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<MapPage[] | null> {
  let pending = fetched.get(locale);
  if (!pending) {
    const request = get(`${apiBaseUrl()}/v1/ask/map?locale=${locale}`)
      .then(async (res) => (res.ok ? mapPages(await res.json()) : null))
      .catch(() => null);
    // A failure is not kept: the next block or terminal tries again.
    void request.then((pages) => {
      if (!pages && fetched.get(locale) === request) fetched.delete(locale);
    });
    fetched.set(locale, request);
    pending = request;
  }
  return pending;
}

/** For tests: the next read fetches afresh. */
export function resetMapCache(): void {
  fetched.clear();
}

/**
 * What to read after the page `id`: its own related pages, strongest first,
 * then the pages that list it among theirs (a post about this case study);
 * each once, never the page itself, at most `n`.
 */
export function readNext(pages: readonly MapPage[], id: string, n = 3): MapPage[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const own = byId.get(id)?.related ?? [];
  const back = pages.filter((p) => p.related.includes(id)).map((p) => p.id);
  return [...new Set([...own, ...back])]
    .filter((other) => other !== id)
    .flatMap((other) => byId.get(other) ?? [])
    .slice(0, n);
}

/** What's new reports pages with dates of their own: a publish dates the profile and the rest. */
const NEWS_KINDS: ReadonlySet<MapKind> = new Set<MapKind>(["project", "post"]);

/** Projects and posts changed after the day `since`, newest first. */
export function updatesSince(pages: readonly MapPage[], since: string): MapPage[] {
  return pages
    .filter((p) => NEWS_KINDS.has(p.kind) && p.updated !== undefined && p.updated > since)
    .sort((a, b) => b.updated!.localeCompare(a.updated!));
}
