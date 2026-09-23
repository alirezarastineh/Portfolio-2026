import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "./migrate.js";

const ROLE_SCRIPT = resolve(process.cwd(), "..", "deploy/hetzner/create-app-role.sql");
const APP_PASSWORD = "test-app-role-password";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** psql-only syntax (\set, :'var') replaced so the script runs through the driver. */
function roleScriptSql(): string {
  return readFileSync(ROLE_SCRIPT, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("\\"))
    .join("\n")
    .replace(":'app_password'", `'${APP_PASSWORD}'`);
}

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

describe("migrations", () => {
  it("are idempotent through a dedicated owner connection", async () => {
    vi.stubEnv("MIGRATION_DATABASE_URL", process.env.DATABASE_URL!);
    // True: they ran (nothing left to apply is still a run).
    await expect(runMigrations()).resolves.toBe(true);
  });
});

describe("create-app-role.sql", () => {
  it("gives the app role row access but no schema changes", async () => {
    const ownerUrl = process.env.DATABASE_URL!;
    await withClient(ownerUrl, (owner) => owner.query(roleScriptSql()));

    const appUrl = new URL(ownerUrl);
    appUrl.username = "portfolio_app";
    appUrl.password = APP_PASSWORD;

    await withClient(appUrl.toString(), async (app) => {
      await app.query("insert into auth_attempts (bucket, outcome) values ('role-test', 'fail')");
      const { rowCount } = await app.query("delete from auth_attempts where bucket = 'role-test'");
      expect(rowCount).toBe(1);

      // 42501 insufficient_privilege
      await expect(app.query("create table intruder (x int)")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(app.query("drop table admin_users")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("alter table projects add column x int")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("can be re-run safely", async () => {
    const ownerUrl = process.env.DATABASE_URL!;
    await withClient(ownerUrl, (owner) => owner.query(roleScriptSql()));
    await expect(
      withClient(ownerUrl, (owner) => owner.query(roleScriptSql())),
    ).resolves.toBeDefined();
  });
});

describe("create-umami-db.sql", () => {
  const UMAMI_SCRIPT = resolve(process.cwd(), "..", "deploy/hetzner/create-umami-db.sql");
  const UMAMI_PASSWORD = "test-umami-role-password";

  /**
   * Runs the script the way psql would: the role block directly, then the
   * `\gexec` query, executing whatever statement it returns.
   */
  async function runUmamiScript(ownerUrl: string): Promise<void> {
    const script = readFileSync(UMAMI_SCRIPT, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("\\"))
      .join("\n")
      .replace(":'umami_password'", `'${UMAMI_PASSWORD}'`);
    const gexecAt = script.indexOf("SELECT 'CREATE DATABASE");
    const setup = script.slice(0, gexecAt);
    const generator = script.slice(gexecAt).replace("\\gexec", "");

    await withClient(ownerUrl, async (owner) => {
      await owner.query(setup);
      const { rows } = await owner.query<{ "?column?": string }>(generator);
      for (const row of rows) await owner.query(row["?column?"]);
    });
  }

  it("creates a separate database the umami role owns, walled off from the portfolio", async () => {
    const ownerUrl = process.env.DATABASE_URL!;
    await runUmamiScript(ownerUrl);
    await runUmamiScript(ownerUrl); // idempotent

    const umamiUrl = new URL(ownerUrl);
    umamiUrl.username = "umami";
    umamiUrl.password = UMAMI_PASSWORD;

    // Umami migrates its own database, so it must be able to create tables there.
    umamiUrl.pathname = "/umami";
    await withClient(umamiUrl.toString(), async (umami) => {
      await umami.query("create table if not exists probe (x int)");
      await umami.query("drop table probe");
    });

    // …but can read nothing of the portfolio's.
    umamiUrl.pathname = new URL(ownerUrl).pathname;
    await withClient(umamiUrl.toString(), async (umami) => {
      await expect(umami.query("select * from admin_users")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });
});
