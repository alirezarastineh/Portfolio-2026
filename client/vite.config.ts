import { createRequire } from "node:module";

import { defineConfig, loadEnv } from "vite";
import analog from "@analogjs/platform";
import tailwindcss from "@tailwindcss/vite";

// With its extension: Vite's native config loader (Node type stripping) needs it.
import { localeRedirect } from "./src/app/content/locale.ts";
import { bootAfterPaint } from "./vite-plugins/boot-after-paint.ts";

/**
 * Satori shapes text with HarfBuzz, compiled to WebAssembly: `hb.js` reads
 * `hb.wasm` from its own folder at runtime, by a computed path the server
 * build's dependency tracing cannot follow. Named here so it is copied into
 * the server output; without it every social card fell back to /og.png.
 * Resolved from satori, whose dependency it is.
 */
const HARFBUZZ_WASM = createRequire(createRequire(import.meta.url).resolve("satori")).resolve(
  "harfbuzzjs/hb.wasm",
);

const PUBLIC_PAGE_CACHE = {
  "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
};
const NO_STORE = { "cache-control": "no-store" };

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devApiTarget = env["VITE_DEV_API_URL"] ?? "http://localhost:3000";
  const publicEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.startsWith("VITE_")),
  );

  return {
    build: {
      target: ["es2020"],
      rollupOptions: {
        output: {
          codeSplitting: {
            groups: [
              // The compiler's own helpers (class fields down-levelled for
              // es2020: `defineProperty`, private-field helpers) in a small
              // chunk of their own. Sentry 11 uses class fields, and without
              // this Rolldown placed the helpers in Sentry's chunk — which then
              // every page imported statically (~118 KB transferred).
              { name: "helpers", test: /@oxc-project\+runtime@[^/]+\/helpers\// },
              // The Sentry SDK in a chunk of its own, loaded only when an
              // error is reported (monitoring/reporting-error-handler.ts).
              // Without it, Rolldown put its module-namespace helper — which
              // every lazily loaded page imports — into Sentry's chunk, so
              // every page downloaded all ~450 KB of Sentry for a three-line
              // function. Isolated, the helper gets a chunk of its own.
              { name: "sentry", test: /[\\/]@sentry(-internal)?[\\/]/ },
            ],
          },
        },
      },
    },
    resolve: {
      mainFields: ["module"],
      tsconfigPaths: true,
    },
    optimizeDeps: {
      include: [
        "@angular/cdk/a11y",
        "@angular/cdk/bidi",
        "@angular/cdk/clipboard",
        "@angular/cdk/coercion",
        "@angular/cdk/collections",
        "@angular/cdk/dialog",
        "@angular/cdk/drag-drop",
        "@angular/cdk/keycodes",
        "@angular/cdk/layout",
        "@angular/cdk/listbox",
        "@angular/cdk/menu",
        "@angular/cdk/observers",
        "@angular/cdk/overlay",
        "@angular/cdk/platform",
        "@angular/cdk/portal",
        "@angular/cdk/scrolling",
        "@angular/cdk/stepper",
        "@angular/cdk/table",
        "@angular/cdk/text-field",
        "@angular/cdk/tree",
        "@spartan-ng/brain/accordion",
        "@spartan-ng/brain/alert-dialog",
        "@spartan-ng/brain/autocomplete",
        "@spartan-ng/brain/avatar",
        "@spartan-ng/brain/button",
        "@spartan-ng/brain/calendar",
        "@spartan-ng/brain/checkbox",
        "@spartan-ng/brain/collapsible",
        "@spartan-ng/brain/combobox",
        "@spartan-ng/brain/command",
        "@spartan-ng/brain/core",
        "@spartan-ng/brain/date-picker",
        "@spartan-ng/brain/date-time",
        "@spartan-ng/brain/dialog",
        "@spartan-ng/brain/drawer",
        "@spartan-ng/brain/field",
        "@spartan-ng/brain/forms",
        "@spartan-ng/brain/hover-card",
        "@spartan-ng/brain/input",
        "@spartan-ng/brain/input-otp",
        "@spartan-ng/brain/label",
        "@spartan-ng/brain/navigation-menu",
        "@spartan-ng/brain/overlay",
        "@spartan-ng/brain/popover",
        "@spartan-ng/brain/progress",
        "@spartan-ng/brain/radio-group",
        "@spartan-ng/brain/resizable",
        "@spartan-ng/brain/select",
        "@spartan-ng/brain/separator",
        "@spartan-ng/brain/sheet",
        "@spartan-ng/brain/slider",
        "@spartan-ng/brain/sonner",
        "@spartan-ng/brain/switch",
        "@spartan-ng/brain/tabs",
        "@spartan-ng/brain/textarea",
        "@spartan-ng/brain/toggle",
        "@spartan-ng/brain/toggle-group",
        "@spartan-ng/brain/tooltip",
        "@ng-icons/core",
        "@ng-icons/lucide",
        "@tiptap/core",
        "@tiptap/extension-image",
        "@tiptap/starter-kit",
        "embla-carousel-angular",
      ],
    },
    define: { "process.env": publicEnv },
    plugins: [
      bootAfterPaint(),
      {
        // Production runs src/server/middleware/locale.ts through Nitro. In
        // dev, Analog finds that file by globbing a path that still has
        // Windows backslashes, which matches nothing — so on Windows `/` would
        // not redirect locally. Same function, dev server only.
        name: "locale-redirect-dev",
        apply: "serve",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const accept = req.headers["accept-language"];
            const redirect = localeRedirect(
              req.url ?? "/",
              req.headers.cookie,
              Array.isArray(accept) ? accept.join(",") : accept,
            );
            if (!redirect) return next();

            res.statusCode = redirect.status;
            res.setHeader("Location", redirect.location);
            if (redirect.negotiated) {
              res.setHeader("Vary", "Cookie, Accept-Language");
              res.setHeader("Cache-Control", "private, no-store");
            }
            res.end();
          });
        },
      },
      {
        name: "ignore-chrome-devtools",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url?.includes(".well-known/appspecific/com.chrome.devtools.json")) {
              res.setHeader("Content-Type", "application/json");
              res.end("{}");
              return;
            }
            next();
          });
        },
      },
      // An empty `routes` array disables prerendering entirely. Without this,
      // Nitro defaults to prerendering `/` at build time and bakes the content
      // into dist/analog/public/index.html — every CMS edit would then be
      // invisible in production until the next rebuild.
      analog({
        prerender: { routes: [] },
        nitro: {
          // Brotli and gzip copies of the build's scripts and styles, written
          // once at build time and served by content negotiation. Smaller than
          // what Caddy compresses on the fly (which it then skips), and what
          // Lighthouse measures locally is what visitors download.
          compressPublicAssets: { brotli: true, gzip: true },
          externals: { traceInclude: [HARFBUZZ_WASM] },
          routeRules: {
            // A page's HTML now depends only on its URL (no cookie picks the
            // language), so a shared cache may keep it briefly.
            ...Object.fromEntries(
              ["/en", "/en/**", "/de", "/de/**"].map((path) => [
                path,
                { headers: PUBLIC_PAGE_CACHE },
              ]),
            ),
            "/admin": { headers: NO_STORE },
            "/admin/**": { headers: NO_STORE },
          },
        },
      }),
      tailwindcss(),
    ],
    server: {
      proxy: {
        "/contact": {
          target: devApiTarget,
          changeOrigin: true,
        },
        // Published content uses relative /media/... paths; in production
        // Caddy proxies them to the API, here Vite does.
        "/media": {
          target: devApiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
