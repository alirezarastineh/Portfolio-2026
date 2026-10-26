import type { Locale } from "../content/locale";
import { formatMonth } from "../content/period";
import { fmt } from "../i18n/interpolate";
import { fetchMap, readNext, type MapPage } from "./portfolio-map";
import type { ReadNextPage } from "./read-next";
import { track } from "./track";

/**
 * The read-next block (visitor plan V15), built in the browser at the end of
 * a case study or a post (`read-next.ts` loads this when the article's end
 * nears the screen). Its words live here, so only that moment loads them.
 */

type Kind = "case-study" | "project" | "post" | "experience" | "profile" | "skills";

export interface ReadNextCopy {
  title: string;
  kinds: Record<Kind, string>;
  /** `{date}`: the month the page last changed. */
  updated: string;
  connect: string;
  /** What "How do they connect?" asks, on this page (V8): `{this}` and `{that}`, their titles. */
  question: string;
}

export const READ_NEXT_COPY: Record<Locale, ReadNextCopy> = {
  en: {
    title: "Read next",
    kinds: {
      "case-study": "case study",
      project: "project",
      post: "post",
      experience: "experience",
      profile: "about",
      skills: "skills",
    },
    updated: "updated {date}",
    connect: "How do they connect?",
    question: "How do {this} and {that} connect?",
  },
  de: {
    title: "Weiterlesen",
    kinds: {
      "case-study": "Fallstudie",
      project: "Projekt",
      post: "Artikel",
      experience: "Werdegang",
      profile: "Profil",
      skills: "Fähigkeiten",
    },
    updated: "aktualisiert {date}",
    connect: "Wie hängt das zusammen?",
    question: "Wie hängen {this} und {that} zusammen?",
  },
};

export interface ReadNextDeps {
  locale: Locale;
  /** Whether the page is still the one the block was fetched for. */
  still: () => boolean;
  /** Opens one of the site's pages through the router. */
  open: (url: string) => void;
  /** Puts a question to the assistant, asked on this page. */
  ask: (question: string) => void;
}

/** How the block names a page's kind: a project with a case study is one. */
export function kindOf(page: Pick<MapPage, "kind" | "url">): Kind {
  if (page.kind === "project") return page.url.includes("/work/") ? "case-study" : "project";
  return page.kind;
}

/** A plain left click, which the router takes; any other opens the link as the browser would. */
function plainClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * The block: a heading, then each page with its kind (and, for a case study or
 * a post, the month it changed), its link, and "How do they connect?".
 */
export function readNextBlock(
  doc: Document,
  pages: readonly MapPage[],
  from: Pick<ReadNextPage, "id" | "title">,
  locale: Locale,
  deps: Pick<ReadNextDeps, "open" | "ask">,
): HTMLElement {
  const copy = READ_NEXT_COPY[locale];
  const nav = doc.createElement("nav");
  nav.className = "read-next";
  nav.dataset["page"] = from.id;
  nav.setAttribute("aria-labelledby", "read-next-title");
  const heading = doc.createElement("h2");
  heading.id = "read-next-title";
  heading.className = "read-next-title";
  heading.textContent = copy.title;
  const list = doc.createElement("ul");
  list.className = "read-next-list";
  list.setAttribute("role", "list");

  pages.forEach((page, i) => {
    const item = doc.createElement("li");
    item.className = "read-next-item";
    const link = doc.createElement("a");
    link.className = "read-next-link";
    link.href = page.url;
    const kind = kindOf(page);
    const meta = doc.createElement("span");
    meta.className = "read-next-kind";
    const dated = page.updated && (kind === "case-study" || kind === "post");
    meta.textContent = [
      copy.kinds[kind],
      dated ? fmt(copy.updated, { date: formatMonth(page.updated!, locale) }) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const name = doc.createElement("span");
    name.className = "read-next-name";
    name.id = `read-next-${i}`;
    name.textContent = page.title;
    // The title first, so the link is named by it; CSS shows the kind above it.
    link.append(name, meta);
    link.addEventListener("click", (event) => {
      track("map_read_next", { action: "open" });
      if (!plainClick(event)) return;
      event.preventDefault();
      deps.open(page.url);
    });

    const ask = doc.createElement("button");
    ask.type = "button";
    ask.className = "read-next-ask";
    ask.textContent = copy.connect;
    // Its name is what it shows; the page it is about describes it.
    ask.setAttribute("aria-describedby", name.id);
    const question = fmt(copy.question, { this: from.title, that: page.title });
    ask.addEventListener("click", () => {
      track("map_read_next", { action: "connect" });
      deps.ask(question);
    });

    item.append(link, ask);
    list.append(item);
  });
  nav.append(heading, list);
  return nav;
}

/** Fetches the map and puts the block before the article's footer; nothing when no page relates. */
export async function showReadNext(page: ReadNextPage, deps: ReadNextDeps): Promise<void> {
  const pages = await fetchMap(deps.locale);
  if (!pages || !deps.still()) return;
  const next = readNext(pages, page.id);
  if (!next.length) return;
  page.article.querySelector(":scope > .read-next")?.remove();
  page.article.insertBefore(
    readNextBlock(page.article.ownerDocument, next, page, deps.locale, deps),
    page.article.querySelector(":scope > footer"),
  );
}
