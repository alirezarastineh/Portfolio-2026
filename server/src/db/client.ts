import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.js";

let pool: pg.Pool | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

/**
 * Lazily created so importing this module never opens a socket — the mailer in
 * `lib/mailer.ts` follows the same memoized pattern.
 */
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: connectionString(),
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Stops a runaway query from pinning a connection for the container's lifetime.
    statement_timeout: 15_000,
  });
  return pool;
}

export function getDb() {
  database ??= drizzle(getPool(), { schema });
  return database;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    database = undefined;
  }
}

export type Database = ReturnType<typeof getDb>;
