import type { Locale } from "./locale";

/** `DE` → `Germany` / `Deutschland`; the code itself if the runtime cannot name it. */
export function regionName(code: string, locale: Locale): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return code;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * A short name for an IANA time zone right now: `CEST`, `MESZ`, else an
 * offset like `GMT-4`. British English names European zones (US English gives
 * `GMT+2` for Berlin), so English uses it. Empty for an unknown zone.
 */
export function timeZoneLabel(timeZone: string, locale: Locale, at = new Date()): string {
  if (!timeZone) return "";
  try {
    const parts = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(at);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
