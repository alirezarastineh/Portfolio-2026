import type { ActivatedRouteSnapshot, ViewTransitionInfo } from "@angular/router";

import { pageKey } from "../content/locale";

/**
 * The `view-transition-name` a project card's image and its case study's
 * cover share, so the browser morphs one into the other. Slugs are
 * `[a-z0-9-]`, so the name is always a valid CSS identifier.
 */
export function projectTransitionName(slug: string): string {
  return `project-${slug}`;
}

/** The URL path a router state shows, from its segments. */
function pathOf(root: ActivatedRouteSnapshot): string {
  const segments: string[] = [];
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    segments.push(...route.url.map((segment) => segment.path));
  }
  return `/${segments.join("/")}`;
}

/**
 * Animates only a move to another page (`withViewTransitions`' hook). Staying
 * on the same page — a language switch, a `#section` link, a tag filter —
 * swaps content in place with no animation, and so does everything when the
 * visitor asks for reduced motion.
 */
export function animatePageChangesOnly({ transition, from, to }: ViewTransitionInfo): void {
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reduced || pageKey(pathOf(from)) === pageKey(pathOf(to))) {
    transition.skipTransition();
  }
}
