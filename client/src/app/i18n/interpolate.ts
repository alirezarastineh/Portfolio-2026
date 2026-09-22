/**
 * Fills `{token}` placeholders in a content string.
 *
 * Copy used to be authored as TypeScript functions (`(n) => \`At least ${n}\``),
 * which cannot survive a round trip through the database. They are plain
 * strings with `{n}` / `{i}` placeholders now, and this resolves them.
 *
 * An unknown placeholder is left intact rather than blanked, so a typo in the
 * admin shows up as a visible `{nn}` instead of silently vanishing.
 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}
