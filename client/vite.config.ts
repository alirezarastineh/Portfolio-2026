/// <reference types="vitest" />

import { defineConfig, loadEnv } from "vite";
import analog from "@analogjs/platform";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    build: {
      target: ["es2020"],
    },
    resolve: {
      mainFields: ["module"],
    },
    define: {
      "process.env": env,
    },
    plugins: [analog(), tailwindcss()],
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["src/test-setup.ts"],
      include: ["**/*.spec.ts"],
      reporters: ["default"],
    },
  };
});
