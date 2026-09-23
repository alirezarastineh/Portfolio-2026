import { isPlatformBrowser, ViewportScroller } from "@angular/common";
import {
  afterNextRender,
  inject,
  Injector,
  PLATFORM_ID,
  provideAppInitializer,
  type EnvironmentProviders,
} from "@angular/core";
import { NavigationEnd, NavigationStart, Router } from "@angular/router";
import { filter } from "rxjs";

import { pageKey } from "../content/locale";

/** The fixed header's height; matches `scroll-padding-top: 5rem` in styles.css. */
const HEADER_OFFSET = 80;

/**
 * Instant, not smooth (`html { scroll-behavior: smooth }` would otherwise
 * animate these): the projects section calls `ScrollTrigger.refresh()` a frame
 * after it renders, and a refresh cancels a smooth scroll still in flight —
 * which left a shared `/de#contact` link a few pixels below the top.
 */
const JUMP: ScrollOptions = { behavior: "instant" };

/**
 * Scroll behaviour for navigations the router's own scroller cannot express:
 *
 * - a new page starts at the top;
 * - switching language keeps the reader where they are — it is the same page;
 * - a link or a fresh load onto another page's section lands on that section;
 * - back/forward is left to the browser's own restoration.
 *
 * Fragments within the current page (`/en#projects` from `/en`) are scrolled
 * to smoothly by `withInMemoryScrolling`, with the header offset set here so
 * the heading is not hidden under it.
 */
export function providePageScroll(): EnvironmentProviders {
  return provideAppInitializer(() => {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;

    const router = inject(Router);
    const scroller = inject(ViewportScroller);
    const injector = inject(Injector);
    scroller.setOffset([0, HEADER_OFFSET]);

    let lastPage: string | null = null;
    let fromHistory = false;

    router.events
      .pipe(filter((event) => event instanceof NavigationStart))
      .subscribe((event) => (fromHistory = event.navigationTrigger === "popstate"));

    router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      const fragment = router.parseUrl(event.urlAfterRedirects).fragment;
      const page = pageKey(event.urlAfterRedirects);
      const firstLoad = lastPage === null;
      const changedPage = !firstLoad && page !== lastPage;
      lastPage = page;

      if (fromHistory) return;

      if (fragment && (firstLoad || changedPage)) {
        // Onto a section of a page that is only now rendering. The router's
        // own anchor scroll fires on a timer, before this (zoneless) app has
        // rendered the new page, so the target does not exist yet; after the
        // next render it does.
        afterNextRender({ read: () => scroller.scrollToAnchor(fragment, JUMP) }, { injector });
        return;
      }

      if (changedPage) scroller.scrollToPosition([0, 0], JUMP);
    });
  });
}
