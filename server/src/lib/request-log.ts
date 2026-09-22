import type { MiddlewareHandler } from "hono";

/**
 * One JSON line per request on stdout, where `docker compose logs api` and any
 * log shipper can parse it. Deliberately minimal: the path without its query
 * string (tokens and search terms stay out of the log) and no client IP —
 * Caddy's access log already records that at the edge.
 */
export const requestLog: MiddlewareHandler = async (c, next) => {
  const started = performance.now();
  await next();

  // The container healthcheck polls every 10s; logging it would drown the rest.
  if (c.req.path === "/health") return;

  const status = c.res.status;
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      msg: "request",
      method: c.req.method,
      path: c.req.path,
      status,
      ms: Math.round(performance.now() - started),
    }),
  );
};
