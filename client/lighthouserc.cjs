// Lighthouse CI against the production build (`pnpm build`, then `pnpm lhci`),
// served by e2e/serve.mjs with the fixture content and the CSP enforced.
// Mobile emulation (Lighthouse's default), three runs per page.
//
// Hard gates: accessibility, best practices and SEO stay at 100, no layout
// shift, no third-party requests, and byte budgets on scripts and styles.
// Performance only warns: the local server does not compress (Caddy does in
// production), so its score here understates the live site. Phase 6 targets
// ≥ 95 and tightens the byte budgets as the bundle shrinks.
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
        // Uncompressed bytes (see above). Measured 2026-09-23: scripts ~782 KB on
        // home, ~510-535 KB on subpages; styles ~192,600 bytes transferred (file
        // plus headers; admin CSS included — Phase 6 splits it out). CI measured
        // a few dozen bytes more than local builds.
        "resource-summary:script:size": ["error", { maxNumericValue: 800 * KB }],
        "resource-summary:stylesheet:size": ["error", { maxNumericValue: 190 * KB }],
        "resource-summary:third-party:count": ["error", { maxNumericValue: 0 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci/reports",
    },
  },
};
