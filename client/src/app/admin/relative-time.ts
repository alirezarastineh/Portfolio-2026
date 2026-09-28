const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const FORMAT = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * "5 minutes ago", "yesterday", "last week": a time to scan in a list. Pair it
 * with the exact time (`absoluteTime`) in a `title` or `datetime`.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return FORMAT.format(Math.round(seconds / size), unit);
  }
  return FORMAT.format(Math.round(seconds / 60), "minute");
}

/** The same moment in full, in the browser's own locale and time zone. */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
