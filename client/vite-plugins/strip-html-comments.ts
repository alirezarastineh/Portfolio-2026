import type { Plugin } from "vite";

/**
 * Drops index.html's comments from the build. They explain the template to
 * whoever edits it, and the server renders every page from the built file, so
 * each visitor downloaded them with every page (~0.4 KB compressed, in the
 * first round trip). Angular's own comments (hydration markers) are written
 * later, by the server render, and are untouched.
 *
 * Build only: the dev server keeps them.
 */
export function stripHtmlComments(): Plugin {
  return {
    name: "strip-html-comments",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => withoutComments(html),
    },
  };
}

/** The HTML without its comments, and without the blank lines they leave behind. */
export function withoutComments(html: string): string {
  return html
    .replaceAll(/^[ \t]*<!--.*?-->[ \t]*(?:\r?\n)?/gms, "")
    .replaceAll(/<!--.*?-->/gs, "");
}
