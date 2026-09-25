import { localeOfPath } from "../../content/locale";

export const PREVIEW_PREFIX = "/admin/preview";

export type PreviewTarget =
  /** A public page: show its draft instead, inside the preview. */
  | { navigate: string }
  /** Another site, or a file the site serves (a feed, the CV): a new tab. */
  | { newTab: string }
  /** Leave the click alone (`mailto:`, admin links). */
  | null;

/**
 * Where a click on a link of a public page should go while previewing the
 * draft. The pages link to `/en/work/atlas`; followed as they are, they would
 * leave the preview for the live site.
 */
export function previewTarget(url: URL, origin: string): PreviewTarget {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== origin) return { newTab: url.href };

  const path = url.pathname;
  if (path === PREVIEW_PREFIX || path.startsWith(`${PREVIEW_PREFIX}/`)) return null;
  if (path.startsWith("/admin")) return null;
  // Files and feeds are served by the server, not the router.
  if (/\.[a-z0-9]+$/i.test(path) || path.startsWith("/media/") || path.startsWith("/api/")) {
    return { newTab: url.href };
  }
  if (localeOfPath(path)) return { navigate: `${PREVIEW_PREFIX}${path}${url.search}${url.hash}` };
  return { newTab: url.href };
}

/** `/admin/preview/de/work/atlas` → `/de/work/atlas`: the public page it previews. */
export function previewedPath(url: string): string {
  const path = url.startsWith(PREVIEW_PREFIX) ? url.slice(PREVIEW_PREFIX.length) : url;
  return path || "/";
}
