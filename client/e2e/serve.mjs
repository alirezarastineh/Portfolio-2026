// Starts the production build (`pnpm build` first) the way the container runs
// it, with test defaults: a local fixture API instead of the real one (the
// bundled fallback plus test case studies, posts, experience and a CV — see
// fixture-content.mjs), so runs are deterministic and offline, and the CSP
// enforced. Used by Playwright and Lighthouse CI; also handy by hand:
// `node e2e/serve.mjs [--port 4173]`.
//
// In front of it sits what Caddy does in production: responses the app sends
// uncompressed (pages, feeds) are gzipped. The build's scripts and styles
// arrive pre-compressed from Nitro already. So Lighthouse measures the bytes a
// visitor actually downloads.
import { existsSync } from "node:fs";
import { createServer, request } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createGzip } from "node:zlib";
import { loadEnv } from "vite";

import { startFixtureApi } from "./fixture-api.mjs";

const entry = new URL("../dist/analog/server/index.mjs", import.meta.url);
if (!existsSync(fileURLToPath(entry))) {
  console.error("No production build at dist/analog/server — run `pnpm build` first.");
  process.exit(1);
}

const { values } = parseArgs({ options: { port: { type: "string" } } });

process.env.HOST ??= "127.0.0.1";
const port = Number(values.port ?? process.env.PORT ?? "4173");
// The app itself listens beside the compressing front, which takes `port`.
const appPort = port + 10000;
process.env.PORT = String(appPort);
process.env.CSP_MODE ??= "enforce";
// The API and analytics origins the build was made with, as compose passes
// them to the container: the CSP must allow what the bundle actually calls,
// or the browser blocks the contact form's POST and the tracker (and every
// page logs a violation). CI sets VITE_API_BASE_URL for the whole e2e job;
// locally both come from .env.production, when there is one. Tests still
// never reach either (see fixtures.ts; Lighthouse blocks the tracker in
// lighthouserc.cjs).
const buildEnv = loadEnv("production", fileURLToPath(new URL("..", import.meta.url)), "VITE_");
for (const key of ["VITE_API_BASE_URL", "VITE_UMAMI_SRC"]) {
  if (buildEnv[key]) process.env[key] ??= buildEnv[key];
}
// Never live content, whatever the shell has set: the fixture API, on loopback.
process.env.API_INTERNAL_BASE_URL = await startFixtureApi();

const COMPRESSIBLE = /^(text\/|application\/(json|xml|rss\+xml|manifest\+json))/;

createServer((req, res) => {
  const upstream = request(
    {
      host: process.env.HOST,
      port: appPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (reply) => {
      const gzip =
        req.method !== "HEAD" &&
        reply.statusCode !== 204 &&
        reply.statusCode !== 304 &&
        !reply.headers["content-encoding"] &&
        COMPRESSIBLE.test(String(reply.headers["content-type"] ?? "")) &&
        /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
      if (!gzip) {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
        return;
      }
      const headers = { ...reply.headers, "content-encoding": "gzip" };
      delete headers["content-length"];
      headers.vary = headers.vary ? `${headers.vary}, Accept-Encoding` : "Accept-Encoding";
      res.writeHead(reply.statusCode ?? 502, headers);
      reply.pipe(createGzip()).pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
}).listen(port, process.env.HOST);

// Prints "Listening on …", which Lighthouse CI waits for; the front above is
// already accepting connections by then.
await import(entry.href);
