import { afterEach, describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db/client.js", () => ({ getPool: () => pool, getDb: vi.fn(), closeDb: vi.fn() }));

const { createApp } = await import("./app.js");
const app = createApp();

afterEach(() => {
  vi.useRealTimers();
  pool.query.mockReset();
});

describe("GET /health", () => {
  it("reports ok when the database answers", async () => {
    pool.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("reports degraded when the database is unreachable", async () => {
    pool.query.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "unreachable" });
  });

  /** A hung connection must not hang the healthcheck with it. */
  it("gives up on a database that never answers", async () => {
    vi.useFakeTimers();
    pool.query.mockReturnValue(new Promise(() => {}));
    const pending = app.request("/health");
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).status).toBe(503);
  });
});
