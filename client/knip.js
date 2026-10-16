// knip (plan Phase 9, advisory in CI): unused files, exports and dependencies.
// Beside src/main.ts, a default entry: the build loads the two stylesheets,
// Analog the pages and the Nitro handlers, by their paths, and tools run the
// scripts and e2e helpers by name. The spartan/helm kit in libs/ stays out of
// `project`: it's generated whole, and the app imports what it uses.
export default {
  entry: [
    "src/main.server.ts",
    "src/{styles,admin}.css",
    "src/app/pages/**/*.page.ts",
    "src/server/{routes,middleware}/**/*.ts",
    "scripts/*.{mjs,ts}",
    "e2e/*.mjs",
    "vite-plugins/*.ts",
    "lighthouserc.cjs",
  ],
  project: ["src/**/*.{ts,css}", "scripts/*", "e2e/*", "vite-plugins/*.ts"],
  ignore: [
    // Mirrored verbatim from the server (content:sync): the server uses their exports.
    "src/app/content/schema.ts",
    "src/app/admin/admin-schema.ts",
  ],
  ignoreDependencies: [
    // fonts.css loads their files by url().
    "@fontsource-variable/geist",
    "@fontsource-variable/geist-mono",
    // scripts/lhci.mjs finds it with require.resolve.
    "@lhci/cli",
    // Commands: the helm generator, and CI's format step.
    "@spartan-ng/cli",
    "prettier",
  ],
};
