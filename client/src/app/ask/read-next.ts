import { isPlatformBrowser } from "@angular/common";
import { afterEveryRender, DestroyRef, inject, PLATFORM_ID } from "@angular/core";
import { Router } from "@angular/router";

import { LanguageService } from "../services/language.service";
import { AskLauncherService } from "./ask-launcher.service";

/** The reader page as read next needs it: its article, its document's id and its title. */
export interface ReadNextPage {
  article: Element;
  /** The corpus's id of the page's document: `project:atlas@en`, `post:evals-first@en`. */
  id: string;
  title: string;
}

/** How far below the screen the article's end may be when the map is fetched. */
const AHEAD = "0px 0px 600px 0px";

/**
 * Read next (visitor plan V15) at the end of a case study or a post: the
 * pages most related to it, each with "How do they connect?". Added in the
 * browser only, once the article's end nears the screen, so the server's HTML
 * stays as it was and a reader who never gets there fetches nothing; the
 * block's own code loads then too. Call it from the page's constructor.
 */
export function injectReadNext(page: () => ReadNextPage | null): void {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
  const launcher = inject(AskLauncherService);
  const router = inject(Router);
  const lang = inject(LanguageService);

  let observer: IntersectionObserver | null = null;
  /** The page whose block is on its way or shown; another page starts afresh. */
  let current: string | null = null;

  // After every render: the router reuses the page for another case study or language.
  afterEveryRender(() => {
    const now = page();
    const key = now ? `${now.id}|${lang.lang()}` : null;
    if (key === current) return;
    current = key;
    observer?.disconnect();
    observer = null;
    if (!now) return;
    now.article.querySelector(":scope > .read-next")?.remove();
    const end = now.article.querySelector(":scope > footer") ?? now.article;
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        observer = null;
        void import("./read-next-block").then(({ showReadNext }) =>
          showReadNext(now, {
            locale: lang.lang(),
            still: () => current === key && now.article.isConnected,
            open: (url) => void router.navigateByUrl(url),
            ask: (question) => launcher.ask(question, "read-next"),
          }),
        );
      },
      { rootMargin: AHEAD },
    );
    observer.observe(end);
  });

  inject(DestroyRef).onDestroy(() => observer?.disconnect());
}
