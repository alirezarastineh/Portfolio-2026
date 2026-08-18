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
    define: { "process.env": publicEnv },
    plugins: [analog(), tailwindcss()],
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
