/**
 * The Model Context Protocol, as far as this read-only server speaks it (plan
 * phase 32): JSON-RPC 2.0 over Streamable HTTP, answered with JSON only (no
 * SSE, no sessions). One endpoint serves both eras, as a dual-era server may:
 *   - the 2026-07-28 revision: every request carries its protocol version and
 *     the client's capabilities in `_meta`, mirrored into HTTP headers the
 *     server checks against the body; `server/discover` replaces the handshake;
 *   - the handshake revisions 2025-03-26 to 2025-11-25: `initialize` opens,
 *     later requests carry the negotiated version in a header (from 2025-06-18).
 * Pure: the route (route.ts) reads the request and writes the reply.
 */

export const MODERN_VERSIONS = ["2026-07-28"] as const;
/** Newest first: `initialize` answers the newest when it cannot answer the one asked for. */
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
/** A legacy request without a version header: the header came with 2025-06-18. */
export const UNVERSIONED_LEGACY = "2025-03-26";

export const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
} as const;

export const ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
  /** The application's own, outside JSON-RPC's reserved range (-32768 to -32000). */
  rateLimited: -31429,
} as const;

export type Id = string | number;

export type Message =
  | { kind: "request"; id: Id; method: string; params: Record<string, unknown> }
  | { kind: "notification"; method: string; params: Record<string, unknown> }
  | { kind: "invalid"; id: Id | null; reason: string };

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is Id =>
  typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));

/** One JSON-RPC message from a parsed body; a batch, a response or anything else is invalid. */
export function parseMessage(body: unknown): Message {
  if (Array.isArray(body)) {
    return {
      kind: "invalid",
      id: null,
      reason: "Batches are not supported: one message a request",
    };
  }
  if (!isObject(body) || body["jsonrpc"] !== "2.0") {
    return { kind: "invalid", id: null, reason: "Not a JSON-RPC 2.0 message" };
  }
  const rawId = body["id"];
  const id = isId(rawId) ? rawId : null;
  const method = body["method"];
  if (typeof method !== "string" || !method) {
    // A response (a result or an error), or nothing at all: clients send requests only.
    return { kind: "invalid", id, reason: "The server takes requests and notifications only" };
  }
  const params = body["params"];
  if (params !== undefined && !isObject(params)) {
    return { kind: "invalid", id, reason: "params must be an object" };
  }
  if (rawId === undefined) return { kind: "notification", method, params: params ?? {} };
  if (id === null)
    return { kind: "invalid", id: null, reason: "The id must be a string or an integer" };
  return { kind: "request", id, method, params: params ?? {} };
}

/**
 * Which era a request opens: `initialize` is the handshake; a version in
 * `_meta` is modern (or a legacy version sent the modern way); anything else
 * is a legacy request after its handshake.
 */
export function eraOf(
  params: Record<string, unknown>,
  method: string,
): "handshake" | "meta" | "legacy" {
  if (method === "initialize") return "handshake";
  const meta = params["_meta"];
  return isObject(meta) && META.protocolVersion in meta ? "meta" : "legacy";
}

/** Why a request is refused before it runs: its HTTP status and JSON-RPC error. */
export interface Refusal {
  status: 400;
  code: number;
  message: string;
  data?: unknown;
  /** What the usage counts call it (`refused:<reason>`). */
  reason: "invalid" | "header_mismatch" | "unsupported_version";
}

export type Checked =
  { ok: true; version: string; modern: boolean } | { ok: false; refusal: Refusal };

const refuse = (
  code: number,
  message: string,
  reason: Refusal["reason"],
  data?: unknown,
): Checked => ({
  ok: false,
  refusal: { status: 400, code, message, reason, ...(data === undefined ? {} : { data }) },
});

/** A header's value as the client meant it: the `=?base64?…?=` sentinel decoded; null when invalid. */
export function decodeHeaderValue(value: string): string | null {
  const encoded = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (encoded) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encoded[1]!, "base64"));
    } catch {
      return null;
    }
  }
  // Plain: visible ASCII, inner spaces and tabs (RFC 9110), nothing leading or trailing.
  return /^[\x21-\x7e](?:[\x20-\x7e\t]*[\x21-\x7e])?$/.test(value) ? value : null;
}

const quoted = (value: string) => {
  const text = value.length > 60 ? `${value.slice(0, 57)}...` : value;
  return `'${text}'`;
};

/** Why a modern request's mirrored headers do not match its body; null when they do. */
function headerMismatch(
  method: string,
  params: Record<string, unknown>,
  version: string,
  header: (name: string) => string | undefined,
): string | null {
  const protocol = header("mcp-protocol-version");
  if (protocol === undefined) return "MCP-Protocol-Version is missing";
  if (protocol !== version) {
    return `MCP-Protocol-Version ${quoted(protocol)} does not match the body's ${quoted(version)}`;
  }
  const mirrored = header("mcp-method");
  if (mirrored === undefined) return "Mcp-Method is missing";
  if (mirrored !== method) {
    return `Mcp-Method ${quoted(mirrored)} does not match the body's ${quoted(method)}`;
  }
  if (method === "tools/call") {
    const raw = header("mcp-name");
    if (raw === undefined) return "Mcp-Name is missing";
    const name = decodeHeaderValue(raw);
    if (name === null) return "Mcp-Name is not a valid header value";
    if (name !== params["name"]) return "Mcp-Name does not match the body's name";
  }
  return null;
}

/**
 * A request that carries its version in `_meta`. A modern one needs its
 * client capabilities there too, and its headers to mirror the body; a legacy
 * version sent this way is served as that version, its header (if any) the
 * same. An unknown version is refused with the versions this server speaks.
 */
export function checkMeta(
  method: string,
  params: Record<string, unknown>,
  header: (name: string) => string | undefined,
): Checked {
  const meta = params["_meta"] as Record<string, unknown>;
  const version = meta[META.protocolVersion];
  if (typeof version !== "string" || !version) {
    return refuse(
      ERRORS.invalidParams,
      "_meta io.modelcontextprotocol/protocolVersion must be a version",
      "invalid",
    );
  }
  if (!SUPPORTED_VERSIONS.includes(version)) {
    return refuse(
      ERRORS.unsupportedVersion,
      "Unsupported protocol version",
      "unsupported_version",
      {
        supported: SUPPORTED_VERSIONS,
        requested: version,
      },
    );
  }
  const modern = (MODERN_VERSIONS as readonly string[]).includes(version);
  if (!modern) {
    const protocol = header("mcp-protocol-version");
    return protocol === undefined || protocol === version
      ? { ok: true, version, modern }
      : refuse(
          ERRORS.headerMismatch,
          `Header mismatch: MCP-Protocol-Version ${quoted(protocol)} does not match the body's ${quoted(version)}`,
          "header_mismatch",
        );
  }
  if (!isObject(meta[META.clientCapabilities])) {
    return refuse(
      ERRORS.invalidParams,
      "_meta io.modelcontextprotocol/clientCapabilities must be an object",
      "invalid",
    );
  }
  const mismatch = headerMismatch(method, params, version, header);
  return mismatch
    ? refuse(ERRORS.headerMismatch, `Header mismatch: ${mismatch}`, "header_mismatch")
    : { ok: true, version, modern };
}

/**
 * A legacy request after its handshake: its version header names a legacy
 * version this server speaks; without one it is 2025-03-26. A modern version
 * there without `_meta` is a malformed modern request.
 */
export function checkLegacy(header: (name: string) => string | undefined): Checked {
  const protocol = header("mcp-protocol-version");
  if (protocol === undefined) return { ok: true, version: UNVERSIONED_LEGACY, modern: false };
  if ((LEGACY_VERSIONS as readonly string[]).includes(protocol)) {
    return { ok: true, version: protocol, modern: false };
  }
  if ((MODERN_VERSIONS as readonly string[]).includes(protocol)) {
    return refuse(
      ERRORS.invalidParams,
      `A ${protocol} request carries its version and capabilities in params._meta`,
      "invalid",
    );
  }
  return refuse(ERRORS.unsupportedVersion, "Unsupported protocol version", "unsupported_version", {
    supported: SUPPORTED_VERSIONS,
    requested: protocol,
  });
}

/** The version `initialize` answers: the one asked for when it is a legacy version spoken here, else the newest. */
export function negotiate(requested: unknown): string {
  return typeof requested === "string" && (LEGACY_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LEGACY_VERSIONS[0];
}

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
}

/** A result as each era expects it: a modern one typed and signed with the server's identity. */
export function shaped(
  modern: boolean,
  result: Record<string, unknown>,
  serverInfo: ServerInfo,
): Record<string, unknown> {
  return modern
    ? { resultType: "complete", ...result, _meta: { [META.serverInfo]: serverInfo } }
    : result;
}

export const success = (id: Id, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });

/** An error response; without an id when the request's could not be read. */
export function failure(id: Id | null, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    ...(id === null ? {} : { id }),
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}
