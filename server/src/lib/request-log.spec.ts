import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestLog } from "./request-log.js";

const app = new Hono();
app.use("*", requestLog);
app.get("/health", (c) => c.text("ok"));
app.get("/things/:id", (c) => c.json({ id: c.req.param("id") }));
app.get("/boom", (c) => c.json({ error: "x" }, 500));

afterEach(() => {
  vi.restoreAllMocks();
});

function captureLines() {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(JSON.parse(line)));
  return lines;
}

describe("requestLog", () => {
  it("writes one JSON line with method, path, status and duration", async () => {
    const lines = captureLines();
    await app.request("/things/42");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: "request", method: "GET", path: "/things/42", status: 200, level: "info" });
    expect(typeof lines[0]!.ms).toBe("number");
  });

  /** Tokens and search terms travel in query strings; they must not reach the log. */
  it("leaves the query string out", async () => {
    const lines = captureLines();
    await app.request("/things/1?token=secret-value");
    expect(JSON.stringify(lines)).not.toContain("secret-value");
  });

  it("marks server errors as error level", async () => {
    const lines = captureLines();
    await app.request("/boom");
    expect(lines[0]).toMatchObject({ status: 500, level: "error" });
  });

  it("skips the healthcheck", async () => {
    const lines = captureLines();
    await app.request("/health");
    expect(lines).toHaveLength(0);
  });
});
