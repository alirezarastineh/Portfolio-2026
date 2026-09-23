/**
 * What a page contributes to `<head>` beyond `<title>` and `<meta>` (which
 * Analog's `routeMeta` handles): the canonical URL, its language alternates,
 * and structured data.
 */
export interface HeadSpec {
  canonical?: string | null;
  /** `hreflang` → URL, including `x-default`. */
  alternates?: Record<string, string>;
  /** One JSON-LD object (use `@graph` for several). */
  jsonLd?: object | null;
}

/**
 * Serialised for a `<script>` body: `<` is escaped, so a string in the data
 * containing `</script>` cannot close the element early.
 */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replaceAll("<", String.raw`\u003c`);
}

/**
 * Replaces everything a previous page wrote, so client-side navigation never
 * leaves a stale canonical or hreflang behind. Runs in resolvers, so the head
 * is right in the server render and not only after hydration.
 */
export function applyHead(document: Document, spec: HeadSpec): void {
  const head = document.head;
  if (!head) return;

  // Also the static canonical `index.html` used to ship.
  for (const node of Array.from(head.querySelectorAll('[data-seo], link[rel="canonical"]'))) {
    node.remove();
  }

  const add = (element: HTMLElement) => {
    // Not `element.dataset`: the server renders with Domino, which has no
    // `dataset`, so it throws there and every page loses its head tags.
    element.setAttribute("data-seo", ""); // NOSONAR
    head.appendChild(element);
  };

  if (spec.canonical) {
    const link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    link.setAttribute("href", spec.canonical);
    add(link);
  }

  for (const [hreflang, href] of Object.entries(spec.alternates ?? {})) {
    const link = document.createElement("link");
    link.setAttribute("rel", "alternate");
    link.setAttribute("hreflang", hreflang);
    link.setAttribute("href", href);
    add(link);
  }

  if (spec.jsonLd) {
    const script = document.createElement("script");
    script.setAttribute("type", "application/ld+json");
    script.textContent = serializeJsonLd(spec.jsonLd);
    add(script);
  }
}
