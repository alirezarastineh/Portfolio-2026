import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // On demand: `vitest run --coverage`. CI runs unit and db as separate steps
    // and merges their coverage, so the thresholds sit on the merge, in
    // .woodpecker/server.yaml: a partial run would fail them.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/test/**"],
      reporter: ["text-summary", "html", "json-summary"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.{test,spec}.ts"],
          exclude: ["src/**/*.db.spec.ts"],
        },
      },
      {
        // Route and query tests against a real Postgres 17. The global setup
        // starts a throwaway embedded cluster (no Docker) unless
        // TEST_DATABASE_URL points at one, and refuses anything that does not
        // look like a test database — these suites truncate every table.
        extends: true,
        test: {
          name: "db",
          include: ["src/**/*.db.spec.ts"],
          globalSetup: ["src/test/pg-global-setup.ts"],
          setupFiles: ["src/test/db-env.ts"],
          // One database, so files run one after another and reset it between tests.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
