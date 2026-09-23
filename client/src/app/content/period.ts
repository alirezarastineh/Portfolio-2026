import { fmt } from "../i18n/interpolate";
import type { Locale, Period } from "./schema";

/**
 * Dates as the CMS publishes them (`2024-03-01`, ISO timestamps), formatted
 * for display. Always in UTC, so the server render and the hydrated page print
 * the same day whatever the visitor's time zone.
 */

export type DatePrecision = "month" | "year";

function utcDay(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** `Mar 2024` (month precision) or `2024` (year precision). */
export function formatMonth(
  iso: string,
  locale: Locale,
  precision: DatePrecision = "month",
): string {
  return new Intl.DateTimeFormat(locale, {
    ...(precision === "month" ? { month: "short" } : {}),
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDay(iso));
}

/** `23 September 2026` / `23. September 2026`, for a post's dates. */
export function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(iso),
  );
}

/** `Mar 2024 – Present`, `2019 – 2021`, or a single date when both ends show the same. */
export function formatPeriod(
  period: Period,
  locale: Locale,
  present: string,
  precision: DatePrecision = "month",
): string {
  const start = formatMonth(period.start, locale, precision);
  const end = period.end ? formatMonth(period.end, locale, precision) : present;
  return start === end ? start : `${start} – ${end}`;
}

/**
 * Whole months from start to end, both ends counted — January to March is
 * three months, the way a CV reads. An ongoing period runs to `now`.
 */
export function monthsBetween(period: Period, now: Date): number {
  const start = utcDay(period.start);
  const end = period.end ? utcDay(period.end) : now;
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1;
  return Math.max(1, months);
}

/**
 * `2 yr 3 mo` in the CMS's units (`{n} yr`, `{n} mo`). A year-precision period
 * only knows its years, so it never claims months.
 */
export function formatDuration(
  period: Period,
  units: { years: string; months: string },
  now: Date,
  precision: DatePrecision = "month",
): string {
  if (precision === "year") {
    const end = period.end ? utcDay(period.end).getUTCFullYear() : now.getUTCFullYear();
    const years = Math.max(1, end - utcDay(period.start).getUTCFullYear());
    return fmt(units.years, { n: years });
  }

  const total = monthsBetween(period, now);
  const years = Math.floor(total / 12);
  const months = total % 12;
  return [
    years > 0 ? fmt(units.years, { n: years }) : "",
    months > 0 ? fmt(units.months, { n: months }) : "",
  ]
    .filter(Boolean)
    .join(" ");
}
