import { MockLanguageModelV4 } from "ai/test";
import { eq, like, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { getDb } from "../../db/client.js";
import { aiMcpUsage, aiRateEvents } from "../../db/schema.js";
import { fixtureConfig } from "../../test/ask-fixtures.js";
import { mockEntry } from "../../test/ask-models.js";
import { ADMIN_ORIGIN } from "../../test/constants.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import { SYSTEM_CARD_UPDATED } from "../corpus/assistant-docs.js";
import { setAskDeps, type AskDeps } from "../deps.js";
import { setEmbeddingDeps } from "../embeddings.js";
import { fixtureAskCorpus } from "../evals/fixture.js";
import { hashWithSalt, MCP_RATE } from "../guard.js";
import { MCP_BODY_LIMIT } from "./route.js";
import { MCP_TOOL_NAMES } from "./tools.js";
import { flushMcpUsage, pendingMcpUsage } from "./usage.js";

const SITE = "https://example.test";
const IP = "203.0.113.7";

/** Any model asked would be counted, and refused: the endpoint must never ask one. */
let modelAsked = 0;
const refuse = (): Promise<never> => {
  modelAsked++;
  return Promise.reject(new Error("the MCP endpoint must not ask a model"));
};
const forbidden = new MockLanguageModelV4({
  modelId: "forbidden",
  doGenerate: refuse,
  doStream: refuse,
});
const DEPS: AskDeps = {
  config: () => fixtureConfig(),
  chain: () => [mockEntry("gemini-3.5-flash-lite", forbidden)],
  corpus: (config) => Promise.resolve({ ...fixtureAskCorpus(config), siteUrl: SITE }),
};
const app = createApp({ ask: DEPS });

beforeEach(async () => {
  await resetDb();
  modelAsked = 0;
  // Counts another test left in memory.
  await flushMcpUsage(() => Promise.resolve());
});

afterEach(() => {
  setAskDeps(DEPS);
  setEmbeddingDeps(null);
  vi.restoreAllMocks();
});

interface McpError {
  code: number;
  message: string;
  data?: unknown;
}

interface DiscoverResult {
  resultType?: string;
  supportedVersions?: string[];
  capabilities?: { tools: { listChanged: boolean } };
  ttlMs?: number;
  cacheScope?: string;
  _meta?: Record<string, unknown>;
  instructions?: string;
  protocolVersion?: string;
  serverInfo?: { name: string; version: string };
}

interface ToolsListResult {
  resultType?: string;
  tools: {
    name: string;
    inputSchema: Record<string, unknown>;
    annotations: Record<string, unknown>;
  }[];
}

interface ToolCallResult<T = Record<string, unknown>> {
  resultType?: string;
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent: T;
}

interface Body<T = Record<string, unknown>> {
  id?: number;
  result?: T;
  error?: McpError;
}

const read = async <T = Record<string, unknown>>(res: Response): Promise<Body<T>> =>
  (await res.json()) as Body<T>;

const counted = (rows: { name: string; count: number }[]) =>
  rows.map((r) => [r.name, r.count]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request("/v1/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-forwarded-for": IP,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let ids = 0;
const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** A request the 2026-07-28 way: version and capabilities in `_meta`, mirrored into headers. */
function modern(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  const mirrored: Record<string, string> = {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  };
  if (method === "tools/call") {
    mirrored["mcp-name"] = String(params["name"]);
  }
  return post(
    { jsonrpc: "2.0", id: ++ids, method, params: { ...params, _meta: META } },
    { ...mirrored, ...headers },
  );
}

/** A request of the handshake revisions: no `_meta`, the version in a header from 2025-06-18. */
function legacy(method: string, params: Record<string, unknown> = {}, version?: string) {
  return post(
    { jsonrpc: "2.0", id: ++ids, method, params },
    version ? { "mcp-protocol-version": version } : {},
  );
}

/* The results are checked by shape below. */
const result = async <T = Record<string, unknown>>(resPromise: Promise<Response>): Promise<T> => {
  const res = await resPromise;
  const body = await read<T>(res);
  if (body.result === undefined) {
    throw new Error("Expected MCP result in response body");
  }
  return body.result;
};

describe("the read-only MCP endpoint (plan phase 32)", () => {
  it("serves a 2026-07-28 client: discovery, the tool list, and each tool (the done-when)", async () => {
    const discovered = await modern("server/discover");
    expect(discovered.status).toBe(200);
    expect(discovered.headers.get("content-type")).toContain("application/json");
    expect(discovered.headers.get("cache-control")).toBe("no-store");
    const discoverBody = await read<DiscoverResult>(discovered);
    const discover = discoverBody.result;
    expect(discover).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"],
      capabilities: { tools: { listChanged: false } },
      ttlMs: 300_000,
      cacheScope: "public",
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "alirezarastineh-portfolio",
          version: "1.0.0",
        },
      },
    });
    expect(discover?.instructions).toMatch(
      /^Read-only access to Alireza Rastineh's published portfolio/,
    );
    // Visitor plan V21: where an exception sits, and what a fact is true as of.
    expect(discover?.instructions).toContain("Read a document's related ids");
    expect(discover?.instructions).toContain("the day it last changed (updated)");

    const listed = await result<ToolsListResult>(modern("tools/list"));
    expect(listed.tools.map((t) => t.name)).toEqual([
      "search_portfolio",
      "get_document",
      "list_projects",
      "get_resume",
    ]);
    for (const tool of listed.tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }

    const call = <T = Record<string, unknown>>(name: string, args: Record<string, unknown>) =>
      result<ToolCallResult<T>>(modern("tools/call", { name, arguments: args }));
    const search = await call<{ results: { id: string; url: string; updated?: string }[] }>(
      "search_portfolio",
      { query: "pgvector" },
    );
    expect(search.resultType).toBe("complete");
    expect(search.structuredContent.results).toContainEqual(
      expect.objectContaining({ id: "project:atlas@en", url: `${SITE}/en/work/atlas` }),
    );
    // The same JSON as text, for a client that reads only text.
    expect(JSON.parse(search.content[0].text)).toEqual(search.structuredContent);

    const doc = await call<{
      id: string;
      title: string;
      url: string;
      locale: string;
      related: string[];
      text: string;
    }>("get_document", { id: "project:atlas" });
    expect(doc.structuredContent).toMatchObject({
      id: "project:atlas@en",
      title: "Atlas",
      url: `${SITE}/en/work/atlas`,
      locale: "en",
      related: ["experience:northwind@en"],
    });
    expect(doc.structuredContent.text).toContain("pgvector");
    // The day each document last changed, where the corpus dates it (visitor plan V21).
    const card = await call<{ updated: string }>("get_document", { id: "system-card@en" });
    expect(card.structuredContent.updated).toBe(SYSTEM_CARD_UPDATED);
    const faq = await call<{ results: unknown[] }>("search_portfolio", { query: "notice period" });
    expect(faq.structuredContent.results).toContainEqual(
      expect.objectContaining({ id: "faq:a1c2e3f4@en", updated: "2026-09-01" }),
    );

    const projects = await call<{ projects: { slug: string; url: string }[] }>("list_projects", {
      text: "rag",
    });
    expect(projects.structuredContent.projects.map((p) => p.slug)).toEqual(["atlas"]);
    expect(projects.structuredContent.projects[0].url).toBe(`${SITE}/en/work/atlas`);
    const german = await call<{ projects: { descriptor: string }[] }>("list_projects", {
      locale: "de",
    });
    expect(german.structuredContent.projects.map((p) => p.descriptor)).toEqual([
      "Support-Assistent mit RAG",
    ]);

    const cv = await call<{ available: boolean; id: string; download: string }>("get_resume", {});
    expect(cv.structuredContent).toMatchObject({
      available: true,
      id: "cv@en",
      download: `${SITE}/en/resume.pdf`,
    });

    expect(modelAsked).toBe(0);
  });

  it("serves a client of the handshake revisions: initialize, initialized, the tool list, a tool", async () => {
    const opened = await legacy("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "old-client", version: "0.9.0" },
    });
    expect(opened.status).toBe(200);
    // No session: none minted.
    expect(opened.headers.get("mcp-session-id")).toBeNull();
    const handshakeBody = await read<DiscoverResult>(opened);
    const handshake = handshakeBody.result;
    expect(handshake).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "alirezarastineh-portfolio", version: "1.0.0" },
    });
    expect(handshake?.instructions).toContain("search_portfolio");
    expect(handshake?.resultType).toBeUndefined();

    const initialized = await post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { "mcp-protocol-version": "2025-06-18" },
    );
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe("");

    const listed = await result<ToolsListResult>(legacy("tools/list", {}, "2025-06-18"));
    expect(listed.tools.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES]);
    expect(listed.resultType).toBeUndefined();
    const call = <T = Record<string, unknown>>(name: string, args: Record<string, unknown>) =>
      result<ToolCallResult<T>>(legacy("tools/call", { name, arguments: args }, "2025-06-18"));
    const found = await call<{ results: unknown[] }>("search_portfolio", { query: "Borealis" });
    expect(found.structuredContent.results).toContainEqual(
      expect.objectContaining({ id: "project:borealis@en", url: `${SITE}/en/work/borealis` }),
    );
    const called = await call<{ id: string; title: string }>("get_document", { id: "profile@en" });
    expect(called.structuredContent).toMatchObject({ id: "profile@en", title: "Alireza Rastineh" });
    expect(called.isError).toBeUndefined();
    expect(called.resultType).toBeUndefined();
    const projects = await call<{ projects: { slug: string }[] }>("list_projects", {});
    expect(projects.structuredContent.projects.map((p) => p.slug)).toEqual(["atlas", "borealis"]);
    // No German CV in the fixture: the English one.
    const cv = await call<{ available: boolean; id: string; download: string }>("get_resume", {
      locale: "de",
    });
    expect(cv.structuredContent).toMatchObject({
      available: true,
      id: "cv@en",
      download: `${SITE}/en/resume.pdf`,
    });

    // A 2025-03-26 client sends no version header; a handshake asking for an older version
    // gets the newest one spoken here.
    expect(await result(legacy("ping"))).toEqual({});
    const older = await result<DiscoverResult>(
      legacy("initialize", { protocolVersion: "2024-11-05", capabilities: {} }),
    );
    expect(older.protocolVersion).toBe("2025-11-25");
    expect(modelAsked).toBe(0);
  });

  it("refuses what the protocol refuses, each with its status and error", async () => {
    const refused = async (res: Promise<Response>, status: number, code: number) => {
      const answer = await res;
      expect(answer.status, `${status} ${code}`).toBe(status);
      const body = await read(answer);
      expect(body.error?.code, `${status} ${code}`).toBe(code);
      if (!body.error) {
        throw new Error(`Expected error for ${status} ${code}`);
      }
      return body.error;
    };
    // The 2026-07-28 rules: headers mirror the body, the version is spoken, capabilities given.
    await refused(modern("tools/list", {}, { "mcp-method": "ping" }), 400, -32_020);
    await refused(
      modern("tools/call", { name: "get_document" }, { "mcp-name": "get_resume" }),
      400,
      -32_020,
    );
    const unsupported = await refused(
      post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: { ...META, "io.modelcontextprotocol/protocolVersion": "1900-01-01" },
          },
        },
        { "mcp-protocol-version": "1900-01-01", "mcp-method": "tools/list" },
      ),
      400,
      -32_022,
    );
    expect(unsupported.data).toEqual({
      supported: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"],
      requested: "1900-01-01",
    });
    await refused(
      post(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
        },
        { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
      ),
      400,
      -32_602,
    );

    // An unknown method: 404 for a modern client, 200 for one of the handshake revisions.
    await refused(modern("resources/list"), 404, -32_601);
    await refused(legacy("resources/list", {}, "2025-11-25"), 200, -32_601);
    // An unknown tool is a protocol error; arguments that do not fit, a tool error to correct.
    const unknown = await refused(
      modern("tools/call", { name: "delete_everything", arguments: {} }),
      200,
      -32_602,
    );
    expect(unknown.message).toBe("Unknown tool: delete_everything");
    const invalid = await result<ToolCallResult>(
      modern("tools/call", { name: "search_portfolio", arguments: {} }),
    );
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0].text).toMatch(/^Invalid arguments for search_portfolio: query/);
    const missing = await result<ToolCallResult>(
      modern("tools/call", { name: "get_document", arguments: { id: "project:nowhere" } }),
    );
    expect(missing).toMatchObject({ isError: true });
    expect(missing.content[0].text).toMatch(/^No document has the id "project:nowhere"/);

    // The transport: POST only, one message, JSON, from no browser but the site's own.
    await Promise.all(
      ["GET", "DELETE"].map(async (method) => {
        const res = await app.request("/v1/mcp", { method });
        expect(res.status, method).toBe(405);
        expect(res.headers.get("allow")).toBe("POST");
        // The Origin rule holds for every method.
        const elsewhere = await app.request("/v1/mcp", {
          method,
          headers: { origin: "https://evil.example" },
        });
        expect(elsewhere.status, method).toBe(403);
      }),
    );
    await refused(post([{ jsonrpc: "2.0", id: 1, method: "ping" }]), 400, -32_600);
    await refused(post("{not json"), 400, -32_700);
    await refused(post({ jsonrpc: "2.0", id: 3, result: {} }), 400, -32_600);
    const evilPost = await modern("tools/list", {}, { origin: "https://evil.example" });
    expect(evilPost.status).toBe(403);
    // The site's own origin (the public CORS list) may.
    const allowedPost = await modern("tools/list", {}, { origin: ADMIN_ORIGIN });
    expect(allowedPost.status).toBe(200);
    const huge = await post({
      jsonrpc: "2.0",
      id: 4,
      method: "ping",
      params: { pad: "x".repeat(MCP_BODY_LIMIT) },
    });
    expect(huge.status).toBe(413);
    expect(modelAsked).toBe(0);
  });

  it("limits each IP in a bucket of its own, and says when to come back", async () => {
    const bucket = `mcp:${hashWithSalt("ip", IP)}`;
    await getDb()
      .insert(aiRateEvents)
      .values(Array.from({ length: MCP_RATE.perHour }, () => ({ bucket })));
    const limited = await modern("tools/list");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const limitedBody = await read(limited);
    expect(limitedBody.error).toMatchObject({ code: -31_429 });

    // Another address is served; the visitors' own buckets stay untouched.
    const otherIp = await modern("tools/list", {}, { "x-forwarded-for": "198.51.100.9" });
    expect(otherIp.status).toBe(200);
    expect(
      await getDb().select().from(aiRateEvents).where(like(aiRateEvents.bucket, "ip:%")),
    ).toEqual([]);
  });

  it("puts every POST in the IP's bucket, read or not, and holds the day's limit too", async () => {
    const bucket = `mcp:${hashWithSalt("ip", IP)}`;
    const inBucket = async () => {
      const rows = await getDb().select().from(aiRateEvents).where(eq(aiRateEvents.bucket, bucket));
      return rows.length;
    };
    const okRes = await modern("tools/list");
    expect(okRes.status).toBe(200);
    const badRes = await post("{not json");
    expect(badRes.status).toBe(400);
    expect(await inBucket()).toBe(2);

    // A day's worth, none of it in the last hour: the hour's limit is not reached, the day's is.
    const earlier = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await getDb()
      .insert(aiRateEvents)
      .values(Array.from({ length: MCP_RATE.perDay }, () => ({ bucket, occurredAt: earlier })));
    const limited = await modern("tools/list");
    expect(limited.status).toBe(429);
    const wait = Number(limited.headers.get("retry-after"));
    // Until the oldest of the day's leaves the window: about 22 hours.
    expect(wait).toBeGreaterThan(21 * 60 * 60);
    expect(wait).toBeLessThanOrEqual(22 * 60 * 60);
  });

  it("asks no model, not even with search by meaning switched on", async () => {
    const base = fixtureConfig();
    const meaning = { ...base, embeddings: { ...base.embeddings, enabled: true } };
    setAskDeps({ ...DEPS, config: () => meaning });
    let embedder = 0;
    setEmbeddingDeps({
      model: () => {
        embedder++;
        return null;
      },
    });
    const calls: [string, Record<string, unknown>][] = [
      ["search_portfolio", { query: "retrieval-augmented support" }],
      ["get_document", { id: "project:atlas" }],
      ["list_projects", {}],
      ["get_resume", {}],
    ];
    await calls.reduce<Promise<void>>(
      (prev, [name, args]) =>
        prev.then(async () => {
          const called = await modern("tools/call", { name, arguments: args });
          expect(called.status, name).toBe(200);
          const calledBody = await read<{ isError?: boolean }>(called);
          expect(calledBody.result?.isError, name).toBeUndefined();
        }),
      Promise.resolve(),
    );
    expect(embedder).toBe(0);
    expect(modelAsked).toBe(0);
  });

  it("answers a failure inside with -32603 and the request's id, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setAskDeps({
      ...DEPS,
      corpus: () => Promise.reject(new Error("the database is down")),
    });
    const failed = await post(
      {
        jsonrpc: "2.0",
        id: 77,
        method: "tools/call",
        params: { name: "list_projects", arguments: {}, _meta: META },
      },
      {
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "list_projects",
      },
    );
    expect(failed.status).toBe(500);
    expect(await read(failed)).toMatchObject({
      id: 77,
      error: { code: -32_603, message: "Internal error: try again later" },
    });
    expect(logged).toHaveBeenCalledWith("[mcp] a request failed", expect.any(Error));
  });

  it("writes only its rate events and usage counts", async () => {
    const tableResult = await getDb().execute<{ name: string }>(
      sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    );
    const tables = tableResult.rows.map((r) => r.name);
    const counts = async (): Promise<Record<string, number>> => {
      const entries = await Promise.all(
        tables.map(async (table) => {
          const res = await getDb().execute<{ n: number }>(
            sql`select count(*)::int as n from ${sql.identifier(table)}`,
          );
          return [table, res.rows[0].n] as const;
        }),
      );
      return Object.fromEntries(entries);
    };
    const before = await counts();

    await modern("server/discover");
    await legacy("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    await modern("tools/list");
    await MCP_TOOL_NAMES.reduce<Promise<void>>(
      (prev, name) =>
        prev.then(async () => {
          await modern("tools/call", {
            name,
            arguments: name === "search_portfolio" ? { query: "Atlas" } : {},
          });
        }),
      Promise.resolve(),
    );
    await modern("tools/call", { name: "get_document", arguments: { id: "profile" } });
    await modern("no/such-method");
    await modern("tools/list", {}, { origin: "https://evil.example" });
    await flushMcpUsage();

    const after = await counts();
    expect(tables.filter((t) => after[t] !== before[t])).toEqual([
      "ai_mcp_usage",
      "ai_rate_events",
    ]);
  });

  it("counts what it served and refused per day and name, writes it on a flush, and shows the admin", async () => {
    await modern("server/discover");
    await modern("tools/call", { name: "search_portfolio", arguments: { query: "Atlas" } });
    await modern("tools/call", { name: "search_portfolio", arguments: { query: "Borealis" } });
    await modern("no/such-method");
    await modern("tools/list", {}, { origin: "https://evil.example" });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    const expected = [
      ["notification", 1],
      ["refused:origin", 1],
      ["refused:unknown_method", 1],
      ["server/discover", 1],
      ["tools/call:search_portfolio", 2],
    ];
    expect(counted(pendingMcpUsage())).toEqual(expected);
    await flushMcpUsage();
    expect(pendingMcpUsage()).toEqual([]);
    expect(counted(await getDb().select().from(aiMcpUsage))).toEqual(expected);

    // A second flush adds to the day.
    await modern("server/discover");
    await flushMcpUsage();
    const rows = await getDb().select().from(aiMcpUsage);
    expect(rows.find((r) => r.name === "server/discover")?.count).toBe(2);

    await createAdmin();
    const admin = new TestClient(app);
    await admin.login();
    const usageRes = await admin.get("/admin/assistant/usage");
    const usage = (await usageRes.json()) as {
      mcp: { day: string; name: string; count: number }[];
    };
    expect(counted(usage.mcp)).toEqual([
      ["notification", 1],
      ["refused:origin", 1],
      ["refused:unknown_method", 1],
      ["server/discover", 2],
      ["tools/call:search_portfolio", 2],
    ]);
  });
});
