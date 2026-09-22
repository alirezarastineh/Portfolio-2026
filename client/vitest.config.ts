/// <reference types="vitest" />

import angular from "@analogjs/vite-plugin-angular";
import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Without the Angular plugin, components are compiled by the JIT fallback,
  // which does not produce metadata for signal-based `input.required()`. Any
  // spec rendering such a component failed with NG0950 even when the input was
  // set via `setInput`.
  plugins: [angular(), tailwindcss()],
  // The spartan components are consumed through `@spartan-ng/helm/*` tsconfig
  // path aliases. The app build resolves them already (vite.config.ts sets the
  // same flag); without it here, any spec rendering a component that uses them
  // fails at import resolution.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
  },
});
