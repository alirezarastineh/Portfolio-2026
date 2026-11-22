// Shared driver for the admin against the production build, its API faked in the browser.
// Never the real API, the tunnel or a paid model: every /admin and /auth call is answered here, and
// anything off-host is aborted.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
export const CLIENT = `${REPO}/client`;
// CI writes into its own folder (ADMIN_TOOLS_OUT); the PC into the redesign's notes.
export const SPECS = process.env.ADMIN_TOOLS_OUT ?? `${REPO}/.claude/specs/admin-redesign`;
const require = createRequire(`${CLIENT}/package.json`);
export const { chromium } = require("@playwright/test");

export const SIZES = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1280, height: 800 },
  wide: { width: 1920, height: 1080 },
};

export function startServer(port) {
  const server = spawn(process.execPath, ["e2e/serve.mjs", "--port", String(port)], {
    cwd: CLIENT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 60_000);
    const on = (d) => {
      if (String(d).includes("Listening on")) {
        clearTimeout(timer);
        resolve({ server, origin: `http://127.0.0.1:${port}` });
      }
    };
    server.stdout.on("data", on);
    server.stderr.on("data", on);
  });
}

const CORS = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type, x-csrf-token",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
};

/**
 * Runs `step` on each item in turn, the next only once the one before has finished: the tools drive
 * one page at a time, and their measures would disturb each other in parallel.
 */
export function inTurn(items, step) {
  return items.reduce(
    (chain, item, index) => chain.then(() => step(item, index)),
    Promise.resolve(),
  );
}

/** Answers the admin API from `answers`; records what went unanswered and every write. */
export async function fake(page, origin, answers, given) {
  const record = given ?? { unmocked: new Set(), writes: [] };
  const calls = new Map();
  const handle = async (route) => {
    const request = route.request();
    const headers = { ...CORS, "access-control-allow-origin": request.headers()["origin"] ?? "*" };
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers });
    }
    const url = new URL(request.url());
    // Exact key first, then the path without its query.
    const key = `${request.method()} ${url.pathname}`;
    const n = (calls.get(key) ?? 0) + 1;
    calls.set(key, n);
    let answer = answers[`${key}${url.search}`];
    if (answer === undefined) {
      answer = answers[key];
    }
    if (request.method() !== "GET") {
      record.writes.push({ key, body: request.postData() });
    }
    if (answer === undefined) {
      record.unmocked.add(key);
      return route.fulfill({ status: 404, headers, json: { error: "not_found" } });
    }
    const { status, body } =
      typeof answer === "function" ? await answer(n, request) : { status: 200, body: answer };
    return route.fulfill({ status, headers, json: body });
  };
  await page.route(
    (url) => /^\/(?:admin|auth)\//.test(url.pathname) && url.origin !== origin,
    handle,
  );
  await page.route(
    (url) => /^\/(?:admin|auth)\//.test(url.pathname) && url.origin === origin,
    (route) =>
      ["fetch", "xhr"].includes(route.request().resourceType()) ? handle(route) : route.fallback(),
  );
  await page.route(
    (url) => url.hostname !== "127.0.0.1" && !/^\/(?:admin|auth)\//.test(url.pathname),
    (route) => route.abort(),
  );
  return record;
}

/** A fresh page on `path`, ready when the admin's sidebar or login has rendered. */
export async function open(browser, origin, answers, { theme = "dark", size = SIZES.laptop, path, reduced = true, init, clock } = {}) {
  const context = await browser.newContext({
    viewport: size,
    colorScheme: theme,
    reducedMotion: reduced ? "reduce" : "no-preference",
    hasTouch: size.width < 700,
    isMobile: size.width < 700,
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() !== "error") {
      return;
    }
    const t = m.text();
    if (t.includes("ERR_FAILED") || t.includes("Failed to load resource") || t.includes("ERR_BLOCKED")) {
      return;
    }
    problems.push(t);
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  if (init) {
    await page.addInitScript(init);
  }
  if (clock) {
    await page.clock.setFixedTime(new Date(clock));
  }
  const record = await fake(page, origin, answers);
  await page.goto(`${origin}${path}`);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached", timeout: 30_000 });
  return { page, context, problems, record };
}

export function outDir(name) {
  const dir = join(SPECS, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function shot(page, dir, name, full = false) {
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: full, animations: "disabled", caret: "hide" });
}

/** Loaded: no skeleton's "Loading" status left. */
export async function loaded(page, timeout = 8000) {
  await page.waitForTimeout(250);
  await page
    .locator("[role=status] .sr-only")
    .first()
    .waitFor({ state: "detached", timeout })
    .catch(() => {});
  await page.waitForTimeout(350);
}
