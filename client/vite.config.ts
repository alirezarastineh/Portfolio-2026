import { defineConfig, loadEnv } from "vite";
import analog from "@analogjs/platform";
import tailwindcss from "@tailwindcss/vite";

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
        "@tiptap/starter-kit",
        "embla-carousel-angular",
      ],
    },
    define: { "process.env": publicEnv },
    plugins: [
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
      analog({ prerender: { routes: [] } }),
      tailwindcss(),
    ],
    server: {
      proxy: {
        "/contact": {
          target: devApiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
