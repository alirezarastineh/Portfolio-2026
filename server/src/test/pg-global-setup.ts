import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
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
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")),
      );
    });
  });
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
    const dir = mkdtempSync(join(tmpdir(), "portfolio-pg-"));
    const port = await freePort();
    const cluster = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
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
