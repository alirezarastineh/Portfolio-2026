import type { Locale } from "../content/schema";
import { SESSION_LOST } from "./admin-api.interceptor";
import { editorLinkFor } from "./editor-links";
import type { DiffKind } from "./json-diff";
import { navItemFor, PAGES } from "./nav";
import { ITEM, type ChangeRow } from "./publish-summary";
import { ROWS } from "./word-rows";
import { WORD_HEADINGS, type WordGroup } from "./words";

export const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

/** Where a change is made: a page, and the query that lands on the field. */
export interface Place {
  path: string;
  query?: Record<string, string>;
}

/** A path in words (plan 5, U16): the page that edits it, the item and field, and Open. */
export interface WordedChange {
  /** The rail's name of the page where it is changed, or "Other". */
  page: string;
  /** "Atlas › Hook", "Contact › Send button"; the path itself when nothing names it. */
  what: string;
  named: boolean;
  open: Place | null;
}

export interface ListedChange extends WordedChange {
  locale: Locale;
  kind: DiffKind;
  /** The new text, plain, for two lines; none for a picture, an order or a whole item. */
  excerpt: string | null;
  row: ChangeRow;
}

export interface ChangeGroup {
  page: string;
  changes: ListedChange[];
}

/** One language compared: what is there now and what would replace it (item names come from these). */
export interface Side {
  locale: Locale;
  before: unknown;
  after: unknown;
}

/**
 * Each field as its editor labels it, by its path with the item's key left out (`projects[].hook`).
 * Words' own groups are named by Words' rows (`word-rows.ts`). A path missing here shows as itself.
 */
const FIELDS: Record<string, string> = {
  "identity.name": "Name",
  "identity.handle": "Handle",
  "identity.contactEmail": "Contact email",
  "identity.siteUrl": "Site address",
  "identity.availability": "Availability",
  "identity.timezone": "Time zone",
  "identity.location.city": "City",
  "identity.location.country": "Country code",
  "identity.primaryCtaHref": "Button link",
  "identity.secondaryCtaHref": "Second button link",
  "identity.avatar": "Photo",
  "identity.resume": "CV",
  socials: "Links",
  "ui.profile.role": "Role",
  "ui.profile.location": "Fallback place",
  "ui.profile.heroHeadline": "Headline",
  "ui.profile.heroSubheadline": "Subheadline",
  "ui.profile.primaryCta": "Button label",
  "ui.profile.secondaryCta": "Second button label",
  "ui.about.heading": "Section heading",
  "ui.about.subtitle": "Section subtitle",
  "ui.about.bio": "Bio",
  "ui.about.philosophy": "Philosophy",
  "ui.about.terminalTitle": "Terminal window title",
  "ui.about.terminalPrompt": "Terminal prompt",
  "ui.about.terminalOutputWhoami": "Output — whoami",
  "ui.about.terminalOutputLs": "Output — ls skills/",
  "ui.about.terminalOutputContact": "Tour: closing line",
  "projects (order)": "Order",
  "projects[].slug": "Slug",
  "projects[].name": "Name",
  "projects[].descriptor": "Descriptor",
  "projects[].hook": "Hook",
  "projects[].role": "Your role",
  "projects[].problem": "Problem",
  "projects[].aiArchitecture": "AI architecture",
  "projects[].fullStackInfra": "Full-stack & infrastructure",
  "projects[].outcomes": "Outcomes",
  "projects[].stack": "Tech stack",
  "projects[].tags": "Tags",
  "projects[].links.live": "Live URL",
  "projects[].links.repo": "Repository URL",
  "projects[].links.caseStudy": "External case study URL",
  "projects[].cover": "Cover image",
  "projects[].featured": "Featured",
  "projects[].period": "Dates",
  "projects[].period.start": "Started",
  "projects[].period.end": "Ended",
  "projects[].category": "Category",
  "projects[].category.key": "Category key",
  "projects[].category.label": "Category label",
  "projects[].metrics": "Results",
  "projects[].hasCaseStudy": "Case study",
  "projects[].updatedAt": "Last updated",
  "experiences (order)": "Order",
  "experiences[].kind": "Kind",
  "experiences[].employmentType": "Employment",
  "experiences[].title": "Title",
  "experiences[].summary": "Summary",
  "experiences[].highlights": "Highlights",
  "experiences[].location": "Location",
  "experiences[].skills": "Skills",
  "experiences[].org.name": "Organisation",
  "experiences[].org.url": "Organisation URL",
  "experiences[].org.logo": "Organisation logo",
  "experiences[].period.start": "Started",
  "experiences[].period.end": "Ended",
  "experiences[].period.precision": "Show dates as",
  "experiences[].credential": "Credential",
  "experiences[].credential.id": "Credential ID",
  "experiences[].credential.url": "Credential URL",
  "skills (order)": "Order",
  "skills[].title": "Title",
  "skills[].items": "Skills",
  "skills[].narrative": "Summary",
  "posts (order)": "Order",
  "posts[].title": "Title",
  "posts[].excerpt": "Excerpt",
  "posts[].tags": "Tags",
  "posts[].cover": "Cover image",
  "posts[].publishedAt": "Publish date",
  "posts[].updatedAt": "Last updated",
  "posts[].readingMinutes": "Reading time",
  "posts[].alternates": "Other language",
  legal: "Titles and dates",
  "seo.title": "Page title",
  "seo.description": "Meta description",
  "seo.author": "Author",
  "seo.siteName": "Site name",
  "seo.canonical": "Canonical URL",
  "seo.ogTitle": "OG title",
  "seo.ogDescription": "OG description",
  "seo.ogImage": "OG image URL",
  "seo.ogUrl": "OG URL",
  "seo.ogLocale": "Locale",
  "seo.twitterCard": "Twitter card type",
  "seo.twitterTitle": "Twitter title",
  "seo.twitterDescription": "Twitter description",
  "seo.twitterImage": "Twitter image URL",
};

/** An item's own page, named under the item. */
const DOC_FIELDS: Record<string, string> = { project: "Case study page", post: "Post page" };
const DOC_LISTS: Record<string, string> = { project: "projects", post: "posts" };

type Item = Record<string, unknown> | undefined;

function find(content: unknown, root: string, key: string): Item {
  const list = (content as Record<string, unknown> | null)?.[root];
  return Array.isArray(list)
    ? (list as Record<string, unknown>[]).find((item) => (item?.["slug"] ?? item?.["id"]) === key)
    : undefined;
}

/** As its list shows it: a project's name, a post's or an entry's title; else its key. */
function itemName(side: Side, root: string, key: string): string {
  const item = find(side.after, root, key) ?? find(side.before, root, key);
  const name = item?.["name"] ?? item?.["title"];
  return typeof name === "string" && name ? name : key;
}

/** The editor's label for a field; a part it does not name belongs to the field above it. */
function fieldWords(generic: string): string | null {
  const label = FIELDS[generic];
  if (label) {
    return label;
  }
  if (generic.endsWith(".alt")) {
    const image = FIELDS[generic.slice(0, -".alt".length)];
    return image ? `${image}, alt text` : null;
  }
  const dot = generic.lastIndexOf(".");
  return dot > 0 ? fieldWords(generic.slice(0, dot)) : null;
}

function uiWords(group: string, key: string): string | null {
  if (group === "about" || group === "profile") {
    return FIELDS[`ui.${group}.${key}`] ?? null;
  }
  const row = ROWS.find((r) => r.group === group && r.key === key);
  return row ? `${WORD_HEADINGS[group as WordGroup]} › ${row.label}` : null;
}

function placed(path: string | null, query?: Record<string, string>): Place | null {
  if (!path) {
    return null;
  }
  return query ? { path, query } : { path };
}

function worded(open: Place | null, words: string | null, path: string): WordedChange {
  const label = open ? (navItemFor(open.path)?.label ?? "") : "";
  const page = label === "" ? "Other" : label;
  return { page, what: words ?? path, named: words !== null, open };
}

function docChange(kind: string, key: string, path: string, side: Side): WordedChange {
  const link = editorLinkFor({ path: ["docs", path] });
  if (kind === "legal") {
    const legal = (side.after ?? side.before) as {
      legal?: { doc: string; title: string }[];
    } | null;
    const title = legal?.legal?.find((item) => item.doc === key)?.title ?? null;
    return worded(placed(link, key === "privacy" ? { doc: key } : undefined), title, path);
  }
  const list = DOC_LISTS[kind];
  const field = DOC_FIELDS[kind];
  const words = list && field ? `${itemName(side, list, key)} › ${field}` : null;
  return worded(placed(link), words, path);
}

function splitRoot(path: string): { root: string; rest: string } {
  const boundary = path.search(/[^a-zA-Z]/);
  return boundary > 0
    ? { root: path.slice(0, boundary), rest: path.slice(boundary) }
    : { root: path, rest: "" };
}

function itemWords(path: string, whole: string, list: string, name: string): string | null {
  if (path === whole) {
    return name;
  }
  const field = fieldWords(`${list}[]${path.slice(whole.length)}`);
  return field ? `${name} › ${field}` : null;
}

function itemChange(path: string, item: RegExpExecArray, side: Side, alt: boolean): WordedChange {
  const [whole = "", list = "", key = ""] = item;
  const name = itemName(side, list, key);
  const words = itemWords(path, whole, list, name);
  const kept = find(side.after, list, key) !== undefined;
  const link = kept
    ? editorLinkFor({ path: [list], label: path })
    : editorLinkFor({ path: [list], label: list });
  const query = list === "experiences" && kept ? { edit: key } : undefined;
  return worded(placed(alt ? "/admin/media" : link, alt ? undefined : query), words, path);
}

/** A path of the review (or a problem's label) in words, with where to change it. */
export function nameChange(path: string, side: Side): WordedChange {
  const doc = /^(project|post|legal):(.+)$/.exec(path);
  if (doc) {
    return docChange(doc[1], doc[2], path, side);
  }

  const { root, rest } = splitRoot(path);
  // Alt text is written in Media, whichever page shows the picture.
  const alt = path.endsWith(".alt");
  if (root === "ui") {
    const [group = "", key = ""] = rest.slice(1).split(".");
    const words = uiWords(group, key);
    const link = editorLinkFor({ path: ["ui", group] });
    const row = link === "/admin/words" && words ? { row: `${group}.${key}` } : undefined;
    return worded(placed(link, row), words, path);
  }

  const item = ITEM.exec(path);
  if (!item) {
    const link = editorLinkFor({ path: [root], label: root });
    return worded(placed(alt ? "/admin/media" : link), fieldWords(path), path);
  }

  return itemChange(path, item, side, alt);
}

/** The new text, plain and short: no tags, one space between words; a list's items; yes or no. */
function plain(value: unknown): string | null {
  if (typeof value !== "string" || value === "null") {
    return null;
  }
  if (value === "true" || value === "false") {
    return value === "true" ? "Yes" : "No";
  }
  if (value.startsWith("[")) {
    try {
      const list: unknown = JSON.parse(value);
      if (Array.isArray(list)) {
        return list.join(", ") || null;
      }
    } catch {
      // Prose that starts with a bracket: shown as it is.
    }
  }
  const text = value.includes("<")
    ? (new DOMParser().parseFromString(value.replaceAll(/<[^<>]{0,1000}>/g, " "), "text/html")
        .documentElement.textContent ?? "")
    : value;
  return text.replaceAll(/\s+/g, " ").trim().slice(0, 300) || null;
}

/** What a row's two lines show: the new value of a field, a page's new body; nothing where none reads. */
export function excerptOf(row: ChangeRow): string | null {
  if (row.kind === "removed" || row.path.endsWith("(order)")) {
    return null;
  }
  if (row.doc) {
    return plain((row.doc.draft as { body?: unknown } | null)?.body);
  }
  return plain(row.entries.find((entry) => entry.path === row.path)?.after);
}

const RAIL_ORDER = new Map(PAGES.map((item, i) => [item.label, i]));

/** The item a row belongs to, so an item's changes sit together (its page last of them). */
function itemOf(path: string): string {
  const doc = /^(project|post):(.+)$/.exec(path);
  if (doc) {
    return `${DOC_LISTS[doc[1]]}[${doc[2]}]`;
  }
  return ITEM.exec(path)?.[0] ?? path;
}

function firstSeen(keys: string[]): (key: string) => number {
  const seen = new Map<string, number>();
  keys.forEach((key, i) => {
    if (!seen.has(key)) {
      seen.set(key, i);
    }
  });
  return (key: string) => seen.get(key) ?? 0;
}

function compareLocaleOrder(a: Locale, b: Locale): number {
  if (a === b) {
    return 0;
  }
  return a === "en" ? -1 : 1;
}

/**
 * Every row of every language in words, grouped by the page that changes it in the rail's order
 * ("Other" last); inside a page an item's rows together, both languages of a field side by side.
 */
export function wordChanges(
  sides: readonly (Side & { rows: readonly ChangeRow[] })[],
): ChangeGroup[] {
  const listed: ListedChange[] = sides.flatMap((side) =>
    side.rows.map((row) => ({
      ...nameChange(row.path, side),
      locale: side.locale,
      kind: row.kind,
      excerpt: excerptOf(row),
      row,
    })),
  );
  const item = firstSeen(listed.map((c) => itemOf(c.row.path)));
  const what = firstSeen(listed.map((c) => c.what));
  const page = (c: ListedChange) => RAIL_ORDER.get(c.page) ?? PAGES.length;
  const sorted = [...listed].sort(
    (a, b) =>
      page(a) - page(b) ||
      item(itemOf(a.row.path)) - item(itemOf(b.row.path)) ||
      what(a.what) - what(b.what) ||
      compareLocaleOrder(a.locale, b.locale),
  );
  const groups: ChangeGroup[] = [];
  for (const change of sorted) {
    const last = groups.at(-1);
    if (last?.page === change.page) {
      last.changes.push(change);
    } else {
      groups.push({ page: change.page, changes: [change] });
    }
  }
  return groups;
}

/** Why the server would not reach or take it, in words; an unknown code as itself. */
function serverWords(code: string): string {
  if (SESSION_LOST.has(code)) {
    return "You were signed out. Sign in, then try again.";
  }
  if (code === "request_failed" || /^http_5\d\d$/.test(code)) {
    return "The server did not answer. Try again.";
  }
  return `The server refused it (${code}).`;
}

/** A refused publish, in one sentence: what happened and what to do. */
export function publishRefusal(code: string): string {
  if (code === "invalid_draft") {
    return "Not published: the draft has problems. Fix them, then publish again.";
  }
  if (code === "publish_failed") {
    return "Not published: the server could not build the site, so nothing went live. Try again.";
  }
  if (SESSION_LOST.has(code)) {
    return "Not published: you were signed out. Sign in, then publish again.";
  }
  if (code === "request_failed" || /^http_5\d\d$/.test(code)) {
    return "Not published: the server did not answer, so nothing went live. Try again.";
  }
  return `Not published: the server refused it (${code}).`;
}

/** A refused roll back or restore, in words. */
export function publicationProblem(code: string): string {
  switch (code) {
    case "media_missing":
      return "A file this publication shows has since been deleted from the media library.";
    case "invalid_payload":
      return "This publication no longer matches the current content format.";
    case "incomplete_publication":
      return "This older publication holds only one language, so it cannot be restored into the draft.";
    case "not_found":
      return "That publication no longer exists.";
    default:
      return serverWords(code);
  }
}
