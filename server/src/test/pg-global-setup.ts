import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

import { assertTestDatabase } from "./guard.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const TEST_DB = "portfolio_test";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

/**
 * embedded-postgres registers `async-exit-hook` as it loads, and that hook
 * answers `beforeExit` with `process.exit(0)`: a run whose tests failed exited
 * 0 whenever a db spec ran, so `pnpm test` (and CI) passed it. Its `exit`
 * listener, left alone, calls the shutdown without its callback, which throws
 * once the run ends. The teardown below stops the cluster itself, so both
 * listeners its import adds are taken off again; the hook's signal handlers
 * stay (an interrupted run still stops the cluster).
 */
async function loadEmbeddedPostgres() {
  const events = ["beforeExit", "exit"] as const;
  const before = new Map(events.map((event) => [event, new Set(process.listeners(event))]));
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  for (const event of events) {
    for (const listener of process.listeners(event)) {
      if (!before.get(event)!.has(listener)) process.removeListener(event, listener);
    }
  }
  return EmbeddedPostgres;
}

/**
 * Runs once per `vitest` invocation: provides a migrated, empty Postgres 17 to
 * every db test file. An embedded cluster is started in a temp directory
 * unless TEST_DATABASE_URL is given, so no Docker and no shared database is
 * ever involved.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let url = process.env.TEST_DATABASE_URL;
  let teardown = async () => {};

  if (!url) {
    const EmbeddedPostgres = await loadEmbeddedPostgres();
    const dir = mkdtempSync(join(tmpdir(), "portfolio-pg-"));
    const port = await freePort();
    const cluster = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      // UTF-8 like production (the postgres image's default). Left to initdb,
      // Windows picks WIN1252, which cannot store characters such as "−".
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
    });

    await cluster.initialise();
    await cluster.start();
    await cluster.createDatabase(TEST_DB);
    url = `postgresql://postgres:postgres@127.0.0.1:${port}/${TEST_DB}`;

    teardown = async () => {
      await cluster.stop().catch(() => {});
      // Windows can hold the data files for a moment after the server exits.
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    };
  }

  assertTestDatabase(url);

  // Migrated once here through the real boot path, so the suites also prove
  // the migrations apply cleanly to an empty database.
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = "test";
  const { runMigrations } = await import("../db/migrate.js");
  const { closeDb } = await import("../db/client.js");
  try {
    await runMigrations();
  } finally {
    await closeDb();
  }

  project.provide("databaseUrl", url);
  return teardown;
}
