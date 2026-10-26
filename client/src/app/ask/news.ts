import type { Locale } from "../content/locale";
import { fmt } from "../i18n/interpolate";
import type { AskCopy } from "./ask-copy";
import type { OutLine } from "./commands";
import type { MapPage } from "./portfolio-map";

/**
 * What's new (visitor plan V15), opt-in. Once the visitor says yes, this
 * browser keeps the day of their last visit, and the terminal and the palette
 * say what changed since then. Nothing is stored before that yes (TDDDG § 25:
 * kept at the visitor's request), nothing is sent, and `forget` clears it with
 * the other device keys (`forget.ts`). Loaded by the terminal and the palette.
 */

export const NEWS_STORAGE_KEY = "ask:news";

/**
 * What the browser keeps: the day of the visit before this one (what changed
 * after it is new) and the day of this one. A visit is a day on which the
 * terminal or the palette opened.
 */
interface Kept {
  since: string;
  last: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today, in UTC, as the map dates pages. */
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(storage: Pick<Storage, "getItem"> | null): Kept | null {
  try {
    const raw = storage?.getItem(NEWS_STORAGE_KEY);
    if (!raw) return null;
    const kept = JSON.parse(raw) as Partial<Kept> | null;
    const { since, last } = kept ?? {};
    return typeof since === "string" &&
      DAY.test(since) &&
      typeof last === "string" &&
      DAY.test(last)
      ? { since, last }
      : null;
  } catch {
    return null;
  }
}

function write(storage: Pick<Storage, "setItem"> | null, kept: Kept): void {
  try {
    storage?.setItem(NEWS_STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage may be blocked: what's new then lasts for this page view.
  }
}

/**
 * This visit's starting point, the day after which a change is new; null while
 * what's new is off, and then nothing is written. The first look on a later
 * day moves the visit on: the day kept as the last becomes the start.
 */
export function visitNews(
  day = today(),
  storage: Pick<Storage, "getItem" | "setItem"> | null = localStorageOrNull(),
): string | null {
  const kept = read(storage);
  if (!kept) return null;
  if (kept.last >= day) return kept.since;
  write(storage, { since: kept.last, last: day });
  return kept.last;
}

/** The visitor's yes: from today, this browser keeps the day of their last visit. */
export function turnNewsOn(
  day = today(),
  storage: Pick<Storage, "setItem"> | null = localStorageOrNull(),
): void {
  write(storage, { since: day, last: day });
}

/** `news off`: the day is no longer kept. */
export function turnNewsOff(
  storage: Pick<Storage, "removeItem"> | null = localStorageOrNull(),
): void {
  try {
    storage?.removeItem(NEWS_STORAGE_KEY);
  } catch {
    // Blocked storage kept nothing either.
  }
}

/** A day as the terminal and the palette name it: `Sep 12`, `12. Sept.`. */
export function newsDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** How many updates since when, in the terminal's empty state and beside the palette's "What's new". */
export const NEWS_COUNT: Record<Locale, { one: string; many: string }> = {
  en: { one: "1 update since {date}", many: "{n} updates since {date}" },
  de: { one: "1 Neuerung seit {date}", many: "{n} Neuerungen seit {date}" },
};

export function newsCount(n: number, since: string, locale: Locale): string {
  const words = NEWS_COUNT[locale];
  return fmt(n === 1 ? words.one : words.many, { n, date: newsDay(since, locale) });
}

/** The most updates `news` lists, and names in the question that summarizes them. */
const LISTED = 10;
const SUMMARIZED = 5;

function newsPageKind(page: MapPage): "post" | "case-study" | "project" {
  if (page.kind === "post") return "post";
  if (page.url.includes("/work/")) return "case-study";
  return "project";
}

/**
 * `news`: each page changed since the last visit, newest first, with its day,
 * kind and link; then a line that asks for a summary of them, one question
 * whose answer cites them. No model is called until that line is pressed.
 */
export function newsLines(
  updates: readonly MapPage[],
  since: string,
  copy: AskCopy,
  locale: Locale,
): OutLine[] {
  if (!updates.length) {
    return [{ text: fmt(copy.news.none, { date: newsDay(since, locale) }), tone: "dim" }];
  }
  const titles = updates
    .slice(0, SUMMARIZED)
    .map((p) => (p.title.length > 80 ? `${p.title.slice(0, 79)}…` : p.title));
  return [
    { text: newsCount(updates.length, since, locale), tone: "accent" },
    ...updates.slice(0, LISTED).map((p) => ({
      label: newsDay(p.updated!, locale),
      text: `${p.title} · ${copy.news.kinds[newsPageKind(p)]}`,
      href: p.url,
      internal: true,
    })),
    { text: copy.news.summarize, ask: fmt(copy.news.question, { titles: titles.join(", ") }) },
  ];
}
