import type { ApplicationRef } from "@angular/core";

/** Set on `<html>` once the page is interactive (see `markWhenInteractive`). */
export const INTERACTIVE_ATTRIBUTE = "data-hydrated";

/** Resolves in the browser's next idle period, like Angular's own idle triggers. */
export function nextIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve());
    else setTimeout(resolve);
  });
}

/**
 * Marks `<html>` once the page is interactive: the app has booted, the first
 * route has loaded and hydrated, and so have the `@defer (hydrate on idle)`
 * blocks — the home page's work, writing and contact sections.
 *
 * Those blocks ask for their idle callback while the page hydrates, before
 * the first stability; one asked for after it runs after theirs, by which
 * time their hydration has started and counts toward the next stability.
 * Blocks that hydrate on viewport are not waited for: they wait for the
 * reader to scroll.
 *
 * The end-to-end tests wait for it (`interactive()` in e2e/fixtures.ts): the
 * network going quiet was the only sign before, and under load it could come
 * before the app had even started (vite-plugins/boot-after-paint.ts).
 */
export async function markWhenInteractive(
  appRef: Pick<ApplicationRef, "whenStable">,
  doc: Document,
  idle: () => Promise<void> = nextIdle,
): Promise<void> {
  await appRef.whenStable();
  await idle();
  await appRef.whenStable();
  doc.documentElement.setAttribute(INTERACTIVE_ATTRIBUTE, "");
}
