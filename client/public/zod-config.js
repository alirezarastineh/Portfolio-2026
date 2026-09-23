// zod compiles fast object parsers with `new Function`, which the site's CSP
// forbids (no 'unsafe-eval'); even its feature probe raises a violation report
// on every page. Object schemas take that decision when they are constructed,
// at module load inside the bundle, so no import in main.ts can come first:
// the bundle's shared chunks always run before the entry's own code.
//
// This file is therefore served as-is from public/ and loaded by index.html as
// a deferred classic script ahead of the app's module script — both kinds run
// in document order. zod reads its config from this global.
// Jitless parsing is plenty fast for the payloads validated in the browser.
globalThis.__zod_globalConfig = Object.assign(globalThis.__zod_globalConfig || {}, {
  jitless: true,
});
