/** A page the site has, as the 404 offers it: its path and what it is called. */
export interface PageSuggestion {
  path: string;
  label: string;
}

/** Levenshtein distance: the fewest single-character edits from `a` to `b`. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitute = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitute));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** `/EN/Work/Atlas/?x#y` → `/en/work/atlas`. */
function normalize(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? "";
  return bare.toLowerCase().replace(/\/$/, "") || "/";
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The known pages a mistyped or truncated address most likely meant, nearest
 * first: a typo anywhere in the path (`/en/wrting`), the right slug under the
 * wrong section (`/en/atlas` for `/en/work/atlas`), or a link cut short. Only
 * pages within a third of the path's length in edits (at least two) count,
 * so an address like nothing on the site suggests nothing.
 */
export function suggestPages(
  path: string,
  pages: readonly PageSuggestion[],
  limit = 3,
): PageSuggestion[] {
  const typed = normalize(path);
  const typedSlug = lastSegment(typed);

  return pages
    .map((page) => {
      const candidate = normalize(page.path);
      const whole = editDistance(typed, candidate);
      // The slug alone costs one more than the same distance over the whole path.
      const slug = editDistance(typedSlug, lastSegment(candidate)) + 1;
      const truncated = typed.length >= 8 && candidate.startsWith(typed) ? 1 : Infinity;
      const score = Math.min(whole, slug, truncated);
      const allowed = Math.max(2, Math.floor(Math.max(typed.length, candidate.length) / 3));
      return { page, score, allowed };
    })
    .filter(({ score, allowed }) => score > 0 && score <= allowed)
    .sort((a, b) => a.score - b.score || a.page.path.localeCompare(b.page.path))
    .slice(0, limit)
    .map(({ page }) => page);
}
