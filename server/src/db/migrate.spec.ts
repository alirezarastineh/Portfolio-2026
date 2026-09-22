import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getPool: vi.fn(() => {
    throw new Error("must not connect");
  }),
  getDb: vi.fn(),
}));
vi.mock("./client.js", () => client);

const { runMigrations } = await import("./migrate.js");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const TUNNEL_URL = "postgresql://portfolio:secret@127.0.0.1:55433/portfolio";

describe("runMigrations production-tunnel guard", () => {
  it("skips without connecting when dev points at the production tunnel", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", TUNNEL_URL);
    vi.stubEnv("ALLOW_REMOTE_MIGRATIONS", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runMigrations();
    expect(client.getPool).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("production tunnel"));
  });

  /** The owner connection is the one that changes the schema, so it is guarded too. */
  it("also guards a MIGRATION_DATABASE_URL that points at the tunnel", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://app@127.0.0.1:5433/portfolio");
    vi.stubEnv("MIGRATION_DATABASE_URL", TUNNEL_URL);
    vi.stubEnv("ALLOW_REMOTE_MIGRATIONS", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await runMigrations();
    expect(client.getPool).not.toHaveBeenCalled();
  });

  it("proceeds through the tunnel when explicitly allowed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", TUNNEL_URL);
    vi.stubEnv("ALLOW_REMOTE_MIGRATIONS", "1");

    await expect(runMigrations()).rejects.toThrow("must not connect");
    expect(client.getPool).toHaveBeenCalled();
  });

  /** In the container the database is `db:5432`; production must always migrate. */
  it("never applies the guard in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", TUNNEL_URL);
    vi.stubEnv("ALLOW_REMOTE_MIGRATIONS", "");

    await expect(runMigrations()).rejects.toThrow("must not connect");
  });

  it("migrates any other development database normally", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1:5433/portfolio");

    await expect(runMigrations()).rejects.toThrow("must not connect");
  });
});
