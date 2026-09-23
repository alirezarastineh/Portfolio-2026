// A stand-in for the content API, serving e2e/fixture-content.mjs on
// 127.0.0.1. The SSR server's BFF fetches, revalidates and validates it
// exactly as it does the real API — a fixture that drifts from the schema
// fails the BFF's validation, and the pages fall back visibly.
import { createServer } from "node:http";

import { fixtureCore, fixtureDocs } from "./fixture-content.mjs";

const KINDS = { projects: "project", posts: "post", legal: "legal" };
const PUBLISHED_AT = new Date("2026-09-20T08:00:00Z").toUTCString();
const ROUTE = /^\/v2\/content\/(en|de)(?:\/(projects|posts|legal)\/([a-z0-9-]+))?$/;

/** Starts the fixture API on a free port; resolves with its base URL. */
export function startFixtureApi() {
  const cores = { en: fixtureCore("en"), de: fixtureCore("de") };
  const docs = { en: fixtureDocs("en"), de: fixtureDocs("de") };

  const server = createServer((req, res) => {
    const match = ROUTE.exec(new URL(req.url ?? "/", "https://fixture").pathname);
    if (!match) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"not_found"}');
      return;
    }

    const [, locale, kind, slug] = match;
    const payload = kind ? docs[locale]?.[`${KINDS[kind]}:${slug}`] : cores[locale];

    if (!payload) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"not_found"}');
      return;
    }

    const docSuffix = kind ? `-${kind}-${slug}` : "";
    const etag = `W/"fixture-${locale}${docSuffix}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json",
      etag,
      "last-modified": PUBLISHED_AT,
    });
    res.end(JSON.stringify(payload));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}
