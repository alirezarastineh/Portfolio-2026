import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { clientIp } from "../../auth/middleware.js";
import { captureError } from "../../lib/sentry.js";
import type { AskCorpus } from "../corpus/index.js";
import { askConfig, askCorpus } from "../deps.js";
import { checkMcpRate, hashWithSalt, recordMcpRequest } from "../guard.js";
import {
  checkLegacy,
  checkMeta,
  eraOf,
  ERRORS,
  failure,
  negotiate,
  parseMessage,
  shaped,
  success,
  SUPPORTED_VERSIONS,
  type Checked,
  type Id,
  type ServerInfo,
} from "./protocol.js";
import { callTool, listTools, type McpToolName } from "./tools.js";
import { countMcp } from "./usage.js";

/**
 * The read-only MCP endpoint (plan phase 32), `POST /v1/mcp`: the published
 * portfolio for agents outside, over the Streamable HTTP transport, answered
 * with JSON (never a stream, never a session). No sign-in and no model: four
 * reads of the corpus visitors' answers cite (tools.ts), limited per IP in a
 * bucket of their own, counted per day (usage.ts). What each era expects of a
 * request is protocol.ts's.
 */

/** A request's body at most: JSON-RPC calls of a few hundred bytes. */
export const MCP_BODY_LIMIT = 64 * 1024;

export const SERVER_INFO: ServerInfo = {
  name: "alirezarastineh-portfolio",
  title: "Alireza Rastineh's portfolio (read-only)",
  version: "1.0.0",
};

const CAPABILITIES = { tools: { listChanged: false } };

/** The tool list and the server's identity change only with a deploy. */
const CACHE = { ttlMs: 300_000, cacheScope: "public" };

/** What an agent should know before it calls anything: what is here, and in which order to read. */
export function instructionsFor(corpus: Pick<AskCorpus, "byId">): string {
  const owner = corpus.byId.get("profile@en")?.title ?? corpus.byId.get("profile@de")?.title;
  const whose = owner ? `${owner}'s` : "this";
  return [
    `Read-only access to ${whose} published portfolio, in English and German:`,
    "the profile, experience, projects and their case studies, writing, skills, the CV and an FAQ.",
    "Search with search_portfolio, then read a whole document with get_document;",
    "list_projects and get_resume go straight to the projects and the CV.",
    "Everything comes from the published site; nothing here calls a model or writes anything.",
  ].join(" ");
}

function reply(c: Context, body: unknown, status: ContentfulStatusCode = 200): Response {
  c.header("Cache-Control", "no-store");
  return c.json(body, status);
}

/** A client's value in an error message, kept short. */
const short = (value: unknown) =>
  (typeof value === "string" ? value : (JSON.stringify(value) ?? "nothing")).slice(0, 60);

/** A request's checks by its era: the handshake negotiates, the others are checked. */
function checkFor(
  method: string,
  params: Record<string, unknown>,
  header: (name: string) => string | undefined,
): Checked {
  const era = eraOf(params, method);
  if (era === "handshake") {
    return { ok: true, version: negotiate(params["protocolVersion"]), modern: false };
  }
  return era === "meta" ? checkMeta(method, params, header) : checkLegacy(header);
}

/** A request that passed its era's checks, answered. */
async function answer(
  c: Context,
  request: { id: Id; method: string; params: Record<string, unknown> },
  checked: Extract<Checked, { ok: true }>,
): Promise<Response> {
  const { id, method, params } = request;
  const done = (result: Record<string, unknown>) =>
    reply(c, success(id, shaped(checked.modern, result, SERVER_INFO)));

  switch (method) {
    case "initialize": {
      countMcp("initialize");
      const corpus = await askCorpus(askConfig());
      // The handshake's result is the legacy one: plain, the version negotiated.
      return reply(
        c,
        success(id, {
          protocolVersion: checked.version,
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
          instructions: instructionsFor(corpus),
        }),
      );
    }
    case "server/discover": {
      countMcp("server/discover");
      const corpus = await askCorpus(askConfig());
      return done({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: CAPABILITIES,
        instructions: instructionsFor(corpus),
        ...(checked.modern ? CACHE : {}),
      });
    }
    case "ping":
      countMcp("ping");
      return done({});
    case "tools/list":
      countMcp("tools/list");
      return done({ tools: listTools(), ...(checked.modern ? CACHE : {}) });
    case "tools/call": {
      const corpus = await askCorpus(askConfig());
      const result = callTool(corpus, params["name"], params["arguments"]);
      if (!result) {
        countMcp("refused:unknown_tool");
        return reply(
          c,
          failure(id, ERRORS.invalidParams, `Unknown tool: ${short(params["name"])}`),
        );
      }
      countMcp(`tools/call:${params["name"] as McpToolName}`);
      return done({ ...result });
    }
    default:
      countMcp("refused:unknown_method");
      // A modern server answers an unknown method 404; the handshake revisions' servers, 200.
      return reply(
        c,
        failure(id, ERRORS.methodNotFound, `Method not found: ${short(method)}`),
        checked.modern ? 404 : 200,
      );
  }
}

/**
 * The endpoint. `origins` are the site's own (the public CORS list): a request
 * from a browser elsewhere is refused, as the transport's DNS-rebinding rule
 * asks; agents send no Origin at all.
 */
export function createMcpRouter(origins: readonly string[]): Hono {
  const router = new Hono();

  // The transport's rule holds for every method: a present Origin that is not the site's is refused.
  router.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && !origins.includes(origin)) {
      countMcp("refused:origin");
      return reply(
        c,
        failure(null, ERRORS.invalidRequest, "This origin may not call the endpoint"),
        403,
      );
    }
    await next();
  });

  // No stream to open and no session to end: POST only.
  router.on(["GET", "DELETE"], "/", (c) => {
    c.header("Allow", "POST");
    return reply(
      c,
      failure(
        null,
        ERRORS.invalidRequest,
        "This MCP endpoint takes POST: one JSON-RPC message a request",
      ),
      405,
    );
  });

  router.post(
    "/",
    bodyLimit({
      maxSize: MCP_BODY_LIMIT,
      onError: (c) => {
        countMcp("refused:too_large");
        return reply(c, failure(null, ERRORS.invalidRequest, "The body is over 64 KB"), 413);
      },
    }),
    async (c) => {
      // Every POST counts against the limit, read or not: the limit comes before the parse.
      // The request's id once read, for an error past that point.
      let id: Id | null = null;
      try {
        const ipHash = hashWithSalt("ip", clientIp(c));
        const rate = await checkMcpRate(ipHash);
        if (!rate.ok) {
          countMcp("refused:rate_limited");
          c.header("Retry-After", String(rate.retryAfter));
          return reply(
            c,
            failure(null, ERRORS.rateLimited, `Rate limited: try again in ${rate.retryAfter} s`, {
              retryAfter: rate.retryAfter,
            }),
            429,
          );
        }
        await recordMcpRequest(ipHash);

        let body: unknown;
        try {
          body = JSON.parse(await c.req.text());
        } catch {
          countMcp("refused:invalid");
          return reply(c, failure(null, ERRORS.parse, "Parse error: the body is not JSON"), 400);
        }
        const message = parseMessage(body);
        if (message.kind === "invalid") {
          countMcp("refused:invalid");
          return reply(c, failure(message.id, ERRORS.invalidRequest, message.reason), 400);
        }
        // Accepted and nothing to say: the handshake's `notifications/initialized`, a cancel.
        if (message.kind === "notification") {
          countMcp("notification");
          c.header("Cache-Control", "no-store");
          return c.body(null, 202);
        }

        id = message.id;
        const checked = checkFor(message.method, message.params, (name) => c.req.header(name));
        if (!checked.ok) {
          const { refusal } = checked;
          countMcp(`refused:${refusal.reason}`);
          return reply(
            c,
            failure(message.id, refusal.code, refusal.message, refusal.data),
            refusal.status,
          );
        }
        return await answer(c, message, checked);
      } catch (error) {
        console.error("[mcp] a request failed", error);
        captureError(error, { phase: "mcp" });
        return reply(c, failure(id, ERRORS.internal, "Internal error: try again later"), 500);
      }
    },
  );

  return router;
}
