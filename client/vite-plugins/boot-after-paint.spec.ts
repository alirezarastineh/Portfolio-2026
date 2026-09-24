import { describe, expect, it } from "vitest";

import { APP_BOOT_SCRIPT_ID as NONCED_ID } from "../src/app/security/csp-nonce";
import { APP_BOOT_SCRIPT_ID, bootAfterPaint, loaderSource } from "./boot-after-paint";

const BUILT = [
  "<head>",
  '<script id="theme-init">x</script>',
  '<script type="module" crossorigin src="/assets/index-A.js"></script>',
  '<link rel="modulepreload" crossorigin href="/assets/a.js">',
  '<link rel="modulepreload" crossorigin href="/assets/b.js">',
  '<link rel="stylesheet" crossorigin href="/assets/index.css">',
  "</head><body><app-root></app-root></body>",
].join("\n");

function transform(html: string): string {
  const hook = bootAfterPaint().transformIndexHtml as { handler: (html: string) => string };
  return hook.handler(html);
}

describe("bootAfterPaint", () => {
  it("replaces the entry script and its preloads with one loader", () => {
    const out = transform(BUILT);
    expect(out).not.toContain('type="module"');
    expect(out).not.toContain('rel="modulepreload"');
    expect(out).toContain('<link rel="stylesheet" crossorigin href="/assets/index.css">');
    expect(out).toContain(`<script id="${APP_BOOT_SCRIPT_ID}">`);
    expect(out).toContain('"/assets/index-A.js"');
    expect(out).toContain('["/assets/a.js","/assets/b.js"]');
  });

  it("leaves a page without an entry script alone", () => {
    expect(transform("<head></head>")).toBe("<head></head>");
  });

  it("uses the id the CSP middleware nonces", () => {
    expect(APP_BOOT_SCRIPT_ID).toBe(NONCED_ID);
  });

  it("boots once, after the first contentful paint, preloading every chunk", () => {
    const run = runLoader("<h1>Alireza</h1>");

    // Only the background-tab fallback is armed; nothing loads before the paint.
    expect(run.timers.map((t) => t.ms)).toEqual([2500]);
    expect(run.frames).toHaveLength(0);

    run.paint();
    run.frames.shift()!();
    // The frame's task boots; the fallback timer then finds it started.
    for (const timer of [...run.timers].reverse()) timer.f();
    expect(run.appended).toEqual(["/a.js", "/b.js"]);
    expect(run.imported).toEqual(["/e.js"]);
  });

  it("boots at once when the server rendered no text to paint", () => {
    const run = runLoader("  \n ");
    expect(run.timers).toHaveLength(0);
    expect(run.appended).toEqual(["/a.js", "/b.js"]);
    expect(run.imported).toEqual(["/e.js"]);
  });
});

/** Runs the loader against stand-ins for the browser, with no paint yet. */
function runLoader(rootText: string) {
  const appended: string[] = [];
  const imported: string[] = [];
  const frames: (() => void)[] = [];
  const timers: { f: () => void; ms: number }[] = [];
  let onPaint: ((list: { getEntriesByName: (n: string) => unknown[] }) => void) | undefined;

  const document = {
    readyState: "complete",
    querySelector: (selector: string) =>
      selector === "app-root" ? { textContent: rootText } : null,
    createElement: () => ({}) as Record<string, string>,
    head: { appendChild: (l: { href: string }) => appended.push(l.href) },
    addEventListener: () => undefined,
  };
  const performance = { getEntriesByName: () => [] };
  class PerformanceObserver {
    constructor(callback: typeof onPaint) {
      onPaint = callback;
    }
    observe() {}
    disconnect() {}
  }
  const source = loaderSource("/e.js", ["/a.js", "/b.js"]).replace(
    "import(entry)",
    "__import(entry)",
  );
  new Function(
    "document",
    "requestAnimationFrame",
    "setTimeout",
    "performance",
    "PerformanceObserver",
    "__import",
    source,
  )(
    document,
    (f: () => void) => frames.push(f),
    (f: () => void, ms: number) => timers.push({ f, ms }),
    performance,
    PerformanceObserver,
    (url: string) => {
      imported.push(url);
      return Promise.resolve();
    },
  );

  return {
    appended,
    imported,
    frames,
    timers,
    paint: () =>
      onPaint!({ getEntriesByName: (name) => (name === "first-contentful-paint" ? [{}] : []) }),
  };
}
