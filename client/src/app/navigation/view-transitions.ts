import { inject } from "@angular/core";
import type { ActivatedRouteSnapshot, ViewTransitionInfo } from "@angular/router";

import { pageKey } from "../content/locale";
import { LanguageService } from "../services/language.service";

/**
 * The `view-transition-name` a project card's image and its case study's
 * cover share, so the browser morphs one into the other. Slugs are
 * `[a-z0-9-]`, so the name is always a valid CSS identifier.
 */
export function projectTransitionName(slug: string): string {
  return `project-${slug}`;
}

/** The name a project card's title and its case study's `<h1>` share. */
export function projectTitleTransitionName(slug: string): string {
  return `project-title-${slug}`;
}

/** Which way a move between two case studies goes, as a view-transition type. */
export type StudyDirection = "forward" | "back";

/** The URL path a router state shows, from its segments. */
function pathOf(root: ActivatedRouteSnapshot): string {
  const segments: string[] = [];
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    segments.push(...route.url.map((segment) => segment.path));
  }
  return `/${segments.join("/")}`;
}

/** `/en/work/atlas` → `atlas`; null for any page that is not a case study. */
function studySlug(path: string): string | null {
  return /^\/work\/([^/]+)$/.exec(pageKey(path))?.[1] ?? null;
}

/**
 * From one case study to another: `forward` when the second comes later in
 * `order` (the home page's), `back` when it comes earlier. Null for any other
 * move, or a study that is not in `order`.
 */
export function studyDirection(
  from: string,
  to: string,
  order: readonly string[],
): StudyDirection | null {
  const a = studySlug(from);
  const b = studySlug(to);
  if (!a || !b) return null;
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i === -1 || j === -1 || i === j) return null;
  return j > i ? "forward" : "back";
}

/**
 * Animates only a move to another page (`withViewTransitions`' hook, run in an
 * injection context). Staying on the same page — a language switch, a
 * `#section` link, a tag filter — swaps content in place with no animation,
 * and so does everything when the visitor asks for reduced motion. Between two
 * case studies the transition gets a direction, which styles.css turns into a
 * slide; browsers without view-transition types keep the plain fade.
 */
export function animatePageChangesOnly({ transition, from, to }: ViewTransitionInfo): void {
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const fromPath = pathOf(from);
  const toPath = pathOf(to);
  if (reduced || pageKey(fromPath) === pageKey(toPath)) {
    transition.skipTransition();
    return;
  }
  if (!("types" in transition)) return;
  // Only a move between two case studies has a direction, and only then is
  // the site's content sure to be loaded: the admin has none (reading it
  // there throws, which broke the move from the admin's login to its dashboard).
  if (!studySlug(fromPath) || !studySlug(toPath)) return;

  const order = inject(LanguageService)
    .content()
    .projects.filter((p) => p.hasCaseStudy)
    .map((p) => p.slug);
  const direction = studyDirection(fromPath, toPath, order);
  if (direction) transition.types.add(direction);
}
