import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { closeDb, getDb } from "../db/client.js";
import { adminUsers } from "../db/schema.js";
import { loadEnvFiles } from "../lib/env.js";
import { hashPassword } from "../lib/password.js";

/**
 * The only way an admin account comes into existence. There is deliberately no
 * signup endpoint — a public portfolio has exactly one operator.
 *
 *   docker compose --env-file .env -f deploy/hetzner/docker-compose.yml \
 *     run --rm api node dist/src/scripts/create-admin.js --email you@example.com
 *
 * Reads the password from ADMIN_BOOTSTRAP_PASSWORD, or generates and prints one.
 * Writes nothing to disk, so `read_only: true` on the api service is irrelevant.
 */
loadEnvFiles();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const email = flag("email")?.trim().toLowerCase();
const force = process.argv.includes("--force");

if (!email?.includes("@")) {
  console.error("usage: create-admin --email <address> [--force]");
  process.exit(1);
}

try {
  const db = getDb();

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(adminUsers);

  if (count > 0 && !force) {
    console.error(
      `[create-admin] ${count} admin account(s) already exist. Re-run with --force to add another.`,
    );
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1);

  if (existing) {
    console.error(`[create-admin] ${email} already exists.`);
    process.exit(1);
  }

  const generated = !process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? randomBytes(18).toString("base64url");

  if (password.length < 12) {
    console.error("[create-admin] ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }

  const [created] = await db
    .insert(adminUsers)
    .values({ email, passwordHash: await hashPassword(password) })
    .returning({ id: adminUsers.id, email: adminUsers.email });

  console.log(`[create-admin] created ${created!.email} (${created!.id})`);
  if (generated) {
    console.log(`[create-admin] generated password: ${password}`);
    console.log("[create-admin] store it now — it is not recoverable.");
  }
  console.log("[create-admin] enrol TOTP from the admin account page on first login.");
} catch (error) {
  console.error("[create-admin] failed", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
