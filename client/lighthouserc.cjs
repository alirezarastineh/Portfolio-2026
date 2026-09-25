// Lighthouse CI against the production build (`pnpm build`, then `pnpm lhci`),
// served by e2e/serve.mjs with the fixture content and the CSP enforced.
// Mobile emulation (Lighthouse's default), three runs per page.
//
// The server compresses like production does: Nitro serves the build's
// pre-compressed scripts and styles, and serve.mjs gzips pages as Caddy
// does. So byte budgets below are transferred (compressed) bytes, and the
// performance score is close to what visitors get.
//
// Hard gates: accessibility, best practices and SEO stay at 100, no layout
// shift, no third-party requests, and byte budgets on scripts and styles.
// Performance only warns: measured 2026-09-24, with the app starting after
// the first paint (vite-plugins/boot-after-paint.ts), 0.94-0.97 home,
// 0.99-1 case study, 1 legal page. Home's total blocking time varies from
// run to run (~190-270 ms): its hydration is the most work.
const PORT = process.env.LHCI_PORT || "4174";
const BASE = `http://127.0.0.1:${PORT}`;
const KB = 1024;

module.exports = {
  ci: {
    collect: {
      startServerCommand: `node e2e/serve.mjs --port ${PORT}`,
      startServerReadyPattern: "Listening on",
      url: [`${BASE}/en`, `${BASE}/en/work/project-one`, `${BASE}/de/legal/privacy`],
      numberOfRuns: 3,
      settings: {
        chromeFlags: "--headless=new --no-sandbox",
      },
    },
    assert: {
      assertions: {
        "categories:accessibility": ["error", { minScore: 1 }],
        "categories:best-practices": ["error", { minScore: 1 }],
        "categories:seo": ["error", { minScore: 1 }],
        "categories:performance": ["warn", { minScore: 0.95 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        // Transferred bytes. Measured 2026-09-25: scripts ~204 KB on home
        // (sections below the hero hydrate, and load, as they scroll into
        // view; the assistant's terminal loads on demand), ~163-172 KB on
        // subpages; styles ~9.9 KB (admin CSS lives in the admin's chunk);
        // fonts 51.8 KB on every page (the Latin Geist and Geist Mono files).
        // The font budget is that plus 15%: a new family or subset fails it.
        "resource-summary:script:size": ["error", { maxNumericValue: 240 * KB }],
        "resource-summary:stylesheet:size": ["error", { maxNumericValue: 16 * KB }],
        "resource-summary:font:size": ["error", { maxNumericValue: 60 * KB }],
        "resource-summary:third-party:count": ["error", { maxNumericValue: 0 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci/reports",
    },
  },
};
