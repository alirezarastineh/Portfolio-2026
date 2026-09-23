import { DOCUMENT } from "@angular/common";
import { inject } from "@angular/core";
import { Meta } from "@angular/platform-browser";
import type { ResolveFn } from "@angular/router";
import { injectResponse } from "@analogjs/router/tokens";

import { applyHead } from "./head";

/**
 * Makes the server answer 404 for the page being rendered, and keeps it out
 * of search results. Without this, a "not found" page is a soft 404: status
 * 200, indexable, and counted as a real page. In the browser it only updates
 * the robots tag.
 */
export function markNotFound(): void {
  injectMarkNotFound()();
}

/**
 * `markNotFound` for async resolvers: injects now, marks later — after an
 * `await` the injection context is gone.
 */
export function injectMarkNotFound(): () => void {
  const response = injectResponse();
  const meta = inject(Meta);
  const document = inject(DOCUMENT);
  return () => {
    if (response && !response.headersSent) response.statusCode = 404;
    meta.updateTag({ name: "robots", content: "noindex" });
    applyHead(document, {});
  };
}

export const notFoundResolver: ResolveFn<true> = () => {
  markNotFound();
  return true;
};
