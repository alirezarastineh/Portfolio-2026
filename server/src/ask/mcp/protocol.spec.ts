import { describe, expect, it } from "vitest";

import {
  checkLegacy,
  checkMeta,
  decodeHeaderValue,
  eraOf,
  ERRORS,
  failure,
  negotiate,
  parseMessage,
  shaped,
  SUPPORTED_VERSIONS,
} from "./protocol.js";

const headers =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name.toLowerCase()];

/** A request's params the 2026-07-28 way: its version and capabilities in `_meta`. */
const meta = (version = "2026-07-28", extra: Record<string, unknown> = {}) => ({
  ...extra,
  _meta: {
    "io.modelcontextprotocol/protocolVersion": version,
    "io.modelcontextprotocol/clientCapabilities": {},
  },
});

describe("the MCP endpoint's protocol (plan phase 32)", () => {
  it("reads one request or notification, and refuses batches, responses and malformed messages", () => {
    expect(parseMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toEqual({
      kind: "request",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(parseMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual({
      kind: "notification",
      method: "notifications/initialized",
      params: {},
    });
    for (const [body, id] of [
      [[{ jsonrpc: "2.0", id: 1, method: "ping" }], null],
      [{ jsonrpc: "2.0", id: 7, result: {} }, 7],
      [{ jsonrpc: "1.0", id: 1, method: "ping" }, null],
      [{ jsonrpc: "2.0", id: "a", method: "ping", params: [1] }, "a"],
      [{ jsonrpc: "2.0", id: null, method: "ping" }, null],
      [{ jsonrpc: "2.0", id: 1.5, method: "ping" }, null],
      ["ping", null],
    ] as const) {
      expect(parseMessage(body), JSON.stringify(body)).toMatchObject({ kind: "invalid", id });
    }
  });

  it("tells the handshake, a request with its version in _meta, and a legacy request apart", () => {
    expect(eraOf({ protocolVersion: "2025-06-18" }, "initialize")).toBe("handshake");
    expect(eraOf(meta(), "tools/list")).toBe("meta");
    expect(eraOf({}, "tools/list")).toBe("legacy");
    expect(eraOf({ _meta: { progressToken: 1 } }, "tools/list")).toBe("legacy");
  });

  it("checks a 2026-07-28 request's mirrored headers against its body", () => {
    const ok = headers({ "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" });
    expect(checkMeta("tools/list", meta(), ok)).toEqual({
      ok: true,
      version: "2026-07-28",
      modern: true,
    });

    const refused = (
      method: string,
      params: Record<string, unknown>,
      sent: Record<string, string>,
    ) => {
      const checked = checkMeta(method, params, headers(sent));
      return checked.ok ? null : checked.refusal;
    };
    // Each header missing or different: a header mismatch, 400.
    expect(refused("tools/list", meta(), { "mcp-method": "tools/list" })).toMatchObject({
      status: 400,
      code: ERRORS.headerMismatch,
      message: "Header mismatch: MCP-Protocol-Version is missing",
    });
    expect(
      refused("tools/list", meta(), {
        "mcp-protocol-version": "2025-11-25",
        "mcp-method": "tools/list",
      }),
    ).toMatchObject({ code: ERRORS.headerMismatch, reason: "header_mismatch" });
    expect(
      refused("tools/list", meta(), { "mcp-protocol-version": "2026-07-28", "mcp-method": "ping" }),
    ).toMatchObject({
      code: ERRORS.headerMismatch,
      message: "Header mismatch: Mcp-Method 'ping' does not match the body's 'tools/list'",
    });
    const call = meta("2026-07-28", { name: "get_document" });
    const callHeaders = { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call" };
    expect(refused("tools/call", call, callHeaders)).toMatchObject({
      message: "Header mismatch: Mcp-Name is missing",
    });
    expect(
      refused("tools/call", call, { ...callHeaders, "mcp-name": "list_projects" }),
    ).toMatchObject({
      message: "Header mismatch: Mcp-Name does not match the body's name",
    });
    expect(refused("tools/call", call, { ...callHeaders, "mcp-name": "get_document" })).toBeNull();
    // A name sent Base64-encoded is compared decoded.
    const encoded = `=?base64?${Buffer.from("get_document").toString("base64")}?=`;
    expect(refused("tools/call", call, { ...callHeaders, "mcp-name": encoded })).toBeNull();

    // Its capabilities are required; an unknown version is refused with the ones spoken here.
    const bare = { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } };
    expect(refused("tools/list", bare, {})).toMatchObject({
      code: ERRORS.invalidParams,
      reason: "invalid",
    });
    expect(refused("tools/list", meta("1900-01-01"), {})).toMatchObject({
      status: 400,
      code: ERRORS.unsupportedVersion,
      reason: "unsupported_version",
      data: { supported: SUPPORTED_VERSIONS, requested: "1900-01-01" },
    });
    // A legacy version sent the modern way is served as that version.
    expect(checkMeta("tools/list", meta("2025-06-18"), headers({}))).toEqual({
      ok: true,
      version: "2025-06-18",
      modern: false,
    });
    expect(
      refused("tools/list", meta("2025-06-18"), { "mcp-protocol-version": "2025-11-25" }),
    ).toMatchObject({ code: ERRORS.headerMismatch });
  });

  it("serves a legacy request by its version header, 2025-03-26 without one", () => {
    expect(checkLegacy(headers({}))).toEqual({ ok: true, version: "2025-03-26", modern: false });
    expect(checkLegacy(headers({ "mcp-protocol-version": "2025-11-25" }))).toEqual({
      ok: true,
      version: "2025-11-25",
      modern: false,
    });
    // The modern version names a request that left its _meta out; an unknown one is unsupported.
    expect(checkLegacy(headers({ "mcp-protocol-version": "2026-07-28" }))).toMatchObject({
      ok: false,
      refusal: { code: ERRORS.invalidParams },
    });
    expect(checkLegacy(headers({ "mcp-protocol-version": "2024-11-05" }))).toMatchObject({
      ok: false,
      refusal: { code: ERRORS.unsupportedVersion, data: { requested: "2024-11-05" } },
    });
  });

  it("answers the handshake with the version asked for when it can, else the newest legacy one", () => {
    expect(negotiate("2025-06-18")).toBe("2025-06-18");
    expect(negotiate("2024-11-05")).toBe("2025-11-25");
    expect(negotiate("2026-07-28")).toBe("2025-11-25");
    expect(negotiate(undefined)).toBe("2025-11-25");
  });

  it("decodes a header value: plain ASCII, or the Base64 sentinel; anything else is invalid", () => {
    expect(decodeHeaderValue("search_portfolio")).toBe("search_portfolio");
    expect(decodeHeaderValue("=?base64?SGVsbG8sIOS4lueVjA==?=")).toBe("Hello, 世界");
    expect(decodeHeaderValue(" padded")).toBeNull();
    expect(decodeHeaderValue("line\none")).toBeNull();
    expect(decodeHeaderValue("café")).toBeNull();
    // Not UTF-8 once decoded.
    expect(
      decodeHeaderValue(`=?base64?${Buffer.from([0xff, 0xfe]).toString("base64")}?=`),
    ).toBeNull();
  });

  it("shapes a result as its era expects, and an error with or without its id", () => {
    const info = { name: "n", title: "t", version: "1" };
    expect(shaped(true, { tools: [] }, info)).toEqual({
      resultType: "complete",
      tools: [],
      _meta: { "io.modelcontextprotocol/serverInfo": info },
    });
    expect(shaped(false, { tools: [] }, info)).toEqual({ tools: [] });
    expect(failure(3, ERRORS.methodNotFound, "Method not found: x")).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32601, message: "Method not found: x" },
    });
    expect(failure(null, ERRORS.parse, "Parse error", { at: 1 })).toEqual({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error", data: { at: 1 } },
    });
  });
});
