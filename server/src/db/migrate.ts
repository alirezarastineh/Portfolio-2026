import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { getDb, getPool } from "./client.js";
import * as schema from "./schema.js";

/**
 * Arbitrary but fixed. Two API containers booting at once must pick the same
 * number for the lock to actually serialize them.
 */
const MIGRATION_LOCK_ID = 8_741_203;

/** Local end of the SSH tunnel to the Hetzner database (open-dev-db-tunnel.ps1). */
const PROD_TUNNEL_PORT = "55433";

function targetsProdTunnel(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname, port } = new URL(url);
    return port === PROD_TUNNEL_PORT && (hostname === "127.0.0.1" || hostname === "localhost");
  } catch {
    return false;
  }
}

/**
 * Migrations run in-process at boot rather than through `drizzle-kit migrate`.
 *
 * drizzle-kit needs its config plus the `.sql` folder present in the image and
 * writes scratch files; the API container is `read_only: true`. This path only
 * reads the bundled `.sql` files and writes to Postgres, so the hardening stays
 * exactly as it is.
 *
 * With MIGRATION_DATABASE_URL set, migrations connect as that (owner) role
 * while the app's own pool can use a role limited to reading and writing rows
 * — see deploy/hetzner/create-app-role.sql. Unset, both use DATABASE_URL.
 */
export async function runMigrations(): Promise<boolean> {
  if (process.env.RUN_MIGRATIONS === "false") {
    console.log("[db] RUN_MIGRATIONS=false — skipping migrations");
    return false;
  }

  const migrationUrl = process.env.MIGRATION_DATABASE_URL?.trim() || undefined;

  // `pnpm dev` migrates at boot, so a laptop pointed at the tunnel would ship
  // unreleased migrations to production. Applying them there stays possible,
  // but only as a deliberate act.
  if (
    process.env.NODE_ENV !== "production" &&
    targetsProdTunnel(migrationUrl ?? process.env.DATABASE_URL) &&
    process.env.ALLOW_REMOTE_MIGRATIONS !== "1"
  ) {
    console.warn(
      "[db] DATABASE_URL points at the production tunnel — skipping migrations. " +
        "Set ALLOW_REMOTE_MIGRATIONS=1 and run `pnpm db:migrate` to apply them on purpose.",
    );
    return false;
  }

  // A dedicated pool for the owner role, closed afterwards so no privileged
  // connection outlives the migration. Two connections: one holds the lock
  // while migrate() runs on the other.
  const ownerPool = migrationUrl
    ? new pg.Pool({ connectionString: migrationUrl, max: 2 })
    : undefined;
  const pool = ownerPool ?? getPool();
  const db = ownerPool ? drizzle(ownerPool, { schema }) : getDb();

  const migrationsFolder = resolve(process.cwd(), "drizzle");
  const lockClient = await pool.connect();

  try {
    // Serializes concurrent boots; the second waits, then finds nothing to do.
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    // citext backs the case-insensitive unique on admin_users.email.
    await lockClient.query("CREATE EXTENSION IF NOT EXISTS citext");
    await migrate(db, { migrationsFolder });
    console.log("[db] migrations applied");
    return true;
  } finally {
    // Session-level lock: released on the same connection that took it.
    await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    lockClient.release();
    await ownerPool?.end();
  }
}
