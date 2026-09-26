export interface UmamiConfig {
  /** Tracker script URL, e.g. https://cloud.umami.is/script.js */
  src: string | undefined;
  websiteId: string | undefined;
  /** Only this hostname is counted, so local dev and previews never are. */
  hostname: string;
}

const SCRIPT_ID = "umami-tracker";

/**
 * Adds the Umami tracker to <head>, once. Run during SSR the tag is part of the
 * served HTML, so it loads as early as any other script; on hydration the
 * existing tag is found and nothing is added twice.
 *
 * Umami sets no cookies, and `data-do-not-track` makes it skip visitors whose
 * browser asks not to be tracked. Off unless both env values are set.
 */
export function injectUmami(doc: Document, config: UmamiConfig): void {
  if (!config.src || !config.websiteId) return;
  if (doc.getElementById(SCRIPT_ID)) return;

  const script = doc.createElement("script");
  script.id = SCRIPT_ID;
  script.defer = true;
  script.src = config.src;
  // Not `script.dataset`: runs during SSR where server DOM (e.g. Domino) lacks `dataset`.
  script.setAttribute("data-website-id", config.websiteId); // NOSONAR
  script.setAttribute("data-domains", config.hostname); // NOSONAR
  script.setAttribute("data-do-not-track", "true"); // NOSONAR
  doc.head.appendChild(script);
}
