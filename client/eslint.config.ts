import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import css from "@eslint/css";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Build output and caches: linting these produced ~11k findings against
  // generated code nobody edits.
  globalIgnores(["dist/", "out-tsc/", "coverage/", ".angular/", "node_modules/"]),
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  tseslint.configs.recommended,
  { files: ["**/*.json"], plugins: { json }, language: "json/json", extends: ["json/recommended"] },
  {
    // TypeScript and VS Code read these as JSON-with-comments.
    files: ["**/*.jsonc", "**/tsconfig*.json", ".vscode/*.json"],
    plugins: { json },
    language: "json/jsonc",
    extends: ["json/recommended"],
  },
  {
    files: ["**/*.json5"],
    plugins: { json },
    language: "json/json5",
    extends: ["json/recommended"],
  },
  {
    files: ["**/*.md"],
    plugins: { markdown },
    language: "markdown/gfm",
    extends: ["markdown/recommended"],
  },
  {
    files: ["**/*.css"],
    plugins: { css },
    language: "css/css",
    extends: ["css/recommended"],
    rules: {
      // Tailwind v4 directives (@theme, @apply) are not standard CSS at-rules.
      "css/no-invalid-at-rules": "off",
      // Font stacks live in custom properties that already end in a generic family.
      "css/font-family-fallbacks": "off",
    },
  },
]);
