import { DOCUMENT, isPlatformBrowser, ViewportScroller } from "@angular/common";
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

/** Instant, not smooth: a smooth scroll still in flight would be cut short by a re-aim. */
const JUMP: ScrollOptions = { behavior: "instant" };

/** How long to keep aiming at a section that is still rendering, and when it counts as settled. */
const SETTLE = { maxMs: 3000, stableFrames: 20 };

/** Anything that means the reader has taken over the scrolling. */
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

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
    const doc = inject(DOCUMENT);
    scroller.setOffset([0, HEADER_OFFSET]);

    let lastPage: string | null = null;
    let fromHistory = false;
    let cancelSettle: (() => void) | undefined;

    router.events
      .pipe(filter((event) => event instanceof NavigationStart))
      .subscribe((event) => (fromHistory = event.navigationTrigger === "popstate"));

    router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      const fragment = router.parseUrl(event.urlAfterRedirects).fragment;
      const page = pageKey(event.urlAfterRedirects);
      const firstLoad = lastPage === null;
      const changedPage = !firstLoad && page !== lastPage;
      lastPage = page;
      cancelSettle?.();

      if (fromHistory) return;

      if (fragment && (firstLoad || changedPage)) {
        // Onto a section of a page that is only now rendering — and whose
        // sections may load a moment later still (deferred blocks), pushing
        // the target down as they arrive.
        afterNextRender(
          { read: () => (cancelSettle = settleOnAnchor(doc, scroller, fragment)) },
          { injector },
        );
        return;
      }

      if (changedPage) scroller.scrollToPosition([0, 0], JUMP);
    });
  });
}

/**
 * Scrolls to `#id` once it exists, and again whenever it moves, until it has
 * stayed put for a few frames, the time is up, or the reader scrolls
 * themselves. Returns a cancel.
 */
export function settleOnAnchor(doc: Document, scroller: ViewportScroller, id: string): () => void {
  const view = doc.defaultView;
  if (!view) return () => undefined;

  const started = performance.now();
  let lastTop: number | null = null;
  let stable = 0;
  let frame = 0;

  const stop = () => {
    view.cancelAnimationFrame(frame);
    for (const type of READER_INPUT) view.removeEventListener(type, stop, true);
  };
  for (const type of READER_INPUT)
    view.addEventListener(type, stop, { capture: true, passive: true });

  const tick = () => {
    if (performance.now() - started > SETTLE.maxMs) return stop();
    const target = doc.getElementById(id);
    if (target) {
      const top = target.getBoundingClientRect().top + view.scrollY;
      if (top === lastTop) {
        if (++stable >= SETTLE.stableFrames) return stop();
      } else {
        scroller.scrollToAnchor(id, JUMP);
        lastTop = top;
        stable = 0;
      }
    }
    frame = view.requestAnimationFrame(tick);
  };
  tick();
  return stop;
}
