import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";

import { onApiError, pgErrorCode } from "./http-errors.js";

function appThrowing(error: unknown): Hono {
  const app = new Hono();
  app.onError(onApiError);
  app.get("/boom", () => {
    throw error;
  });
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pgErrorCode", () => {
  it("reads the SQLSTATE from a driver error", () => {
    expect(pgErrorCode({ code: "22P02" })).toBe("22P02");
  });

  it("looks through Drizzle's wrapper to the driver error", () => {
    expect(pgErrorCode({ message: "Failed query", cause: { code: "23505" } })).toBe("23505");
  });

  /** Node system errors also carry `code` ("ECONNREFUSED"); those are not SQLSTATEs. */
  it("ignores codes that are not SQLSTATEs", () => {
    expect(pgErrorCode({ code: "ECONNREFUSED" })).toBeUndefined();
    expect(pgErrorCode(new Error("plain"))).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
  });

  it("stops on a self-referencing cause instead of looping", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(pgErrorCode(loop)).toBeUndefined();
  });
});

describe("onApiError", () => {
  it("turns a malformed id reaching Postgres into a 400", async () => {
    // The shape Drizzle throws: its own Error wrapping the pg driver error.
    const driverError = Object.assign(new Error("invalid input syntax for type uuid"), {
      code: "22P02",
    });
    const res = await appThrowing(new Error("Failed query", { cause: driverError })).request(
      "/boom",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_id" });
  });

  it("answers anything else with a JSON 500 and logs the detail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await appThrowing(new Error("secret detail")).request("/boom");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "internal_error" });
    expect(body).not.toContain("secret detail");
    expect(log).toHaveBeenCalled();
  });

  it("passes HTTPExceptions through with their own status", async () => {
    const res = await appThrowing(new HTTPException(413, { message: "too big" })).request("/boom");
    expect(res.status).toBe(413);
  });
});
