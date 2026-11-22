// Phase 7 review: the admin against the production build, API faked, in both
// themes. Writes screenshots to ./shots/admin-*.png and prints problems.
// Usage: node admin-shots.mjs
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { inTurn } from "./lib.mjs";

const CLIENT = fileURLToPath(new URL("../../client", import.meta.url)).replace(/[\\/]$/, "");
const OUT = process.env.ADMIN_TOOLS_OUT ? join(process.env.ADMIN_TOOLS_OUT, "admin-shots") : fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const require = createRequire(`${CLIENT}/package.json`);
const { chromium } = require("@playwright/test");
const PORT = 4191;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const content = (l) => JSON.parse(readFileSync(`${CLIENT}/src/app/content/fallback.${l}.json`, "utf8"));
const en = content("en");
const de = content("de");
const user = { id: "u1", email: "admin@example.com", totpEnrolled: true };
const now = new Date().toISOString();
const ago = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const msg = (id, name, status, h) => ({
  id, createdAt: ago(h), locale: "en", name, email: `${id}@example.com`,
  message: `Hi, I saw your ${name.length % 2 ? "RAG" : "evals"} case study and wondered whether you would talk about a senior role.`,
  status, mailStatus: "sent", mailError: null,
});

const answers = {
  "GET /auth/me": { user, pendingTotp: false, csrfToken: "x" },
  "GET /admin/status": { user, pointers: [{ locale: "en", versionId: 12, publishedAt: ago(26) }, { locale: "de", versionId: 12, publishedAt: ago(26) }], lastEdit: now, lastPublish: ago(26), hasUnpublishedChanges: true },
  "GET /admin/publish/review": { canPublish: true, locales: [
    { locale: "en", issues: [], changed: true, draft: en, live: { ...en, ui: { ...en.ui, hero: { ...en.ui.hero, askCta: "old" } }, identity: { ...en.identity, name: "Old" } }, liveVersionId: 12, docs: [] },
    { locale: "de", issues: [], changed: true, draft: de, live: { ...de, identity: { ...de.identity, name: "Alt" } }, liveVersionId: 12, docs: [] },
  ] },
  "GET /admin/messages": { messages: [msg("m1", "Ada Lovelace", "new", 2), msg("m2", "Grace Hopper", "new", 5), msg("m3", "Spam", "spam", 6), msg("m4", "Alan Turing", "read", 30)] },
  "GET /admin/i18n": { items: [{ kind: "project", id: "p1", label: "Project One", missingDe: ["hook"], missingEn: [], stale: false, absent: null }, { kind: "section", id: "about", label: "About", missingDe: [], missingEn: [], stale: true, absent: null }] },
  "GET /admin/assistant/health": { state: { state: "ok", deepAllowed: true, spentUsd: 0.42, budgetUsd: 2 }, inFlight: 0, breakers: [{ model: "gemini-2.5-flash", state: "open", openUntil: now, consecutiveFailures: 3, lastSuccessAt: ago(2), lastFailureAt: now, lastError: "429 quota", p50TtftMs: 420 }], last24h: { answers: 12, failures: 3, fallbackRate: 0.1, models: [] }, corpus: null },
  "GET /admin/assistant/usage": { days: 30, models: [], answers: [] },
  "GET /admin/publications": { publications: [
    { id: 12, kind: "publish", label: "New case study", schemaVersion: 2, restoredFrom: null, createdAt: ago(26), versions: [{ id: 23, locale: "en", live: true }, { id: 24, locale: "de", live: true }], live: true },
    { id: 11, kind: "publish", label: null, schemaVersion: 2, restoredFrom: null, createdAt: ago(80), versions: [{ id: 21, locale: "en", live: false }, { id: 22, locale: "de", live: false }], live: false },
    { id: 10, kind: "rollback", label: null, schemaVersion: 2, restoredFrom: 8, createdAt: ago(200), versions: [], live: false },
  ] },
  "GET /admin/media-reconcile": { missingFiles: [], orphanFiles: [], totalAssets: 3, totalBytes: 123_456 },
  // Today's queues since plan 5's Part F, each empty: their rows show only when something waits.
  "GET /admin/assistant/reviews": { week: "2026-W45", previous: "2026-W44", next: null, queue: [], stats: { answers: 0, queued: 0, reviewed: 0, labels: Object.fromEntries(["correct", "grounded", "helpful", "tone", "language"].map((l) => [l, { good: 0, bad: 0 }])) } },
  "GET /admin/assistant/proposals": { proposals: [] },
  "GET /admin/assistant/faq-proposals": { proposals: [] },
  "GET /admin/assistant/journal": { entries: [], counts: { proposed: 0, accepted: 0, fixed: 0, retired: 0 } },
  "GET /admin/assistant/lessons": { lessons: [], counts: { proposed: 0, active: 0, retired: 0 } },
  "GET /admin/content/preview/en": en,
  "GET /admin/content/preview/de": de,
  "GET /admin/sections/ui": { section: "ui", updatedAt: ago(1), data: { en: en.ui, de: de.ui } },
  "GET /admin/projects": { projects: en.projects.map((p, i) => ({ id: `p${i}`, slug: p.slug, position: i, coverId: null, coverPath: null, stack: [], linkLive: "", linkRepo: "", linkCaseStudy: "", isVisible: i !== 2, featured: i === 0, periodStart: null, periodEnd: null, category: "", tags: [], createdAt: now, updatedAt: now, translations: { en: { name: p.name, hasCaseStudy: p.hasCaseStudy }, de: { name: p.name, hasCaseStudy: false } } })) },
};
let seoCalls = 0;
// Since plan 5's Part E a signed-in visitor leaves the login (E11): the login is shot signed out.
let signedOut = false;
function answer(method, path) {
  if (signedOut && path === "/auth/me") {
    return { status: 401, body: { error: "unauthenticated" } };
  }
  if (path === "/admin/sections/seo") {
    seoCalls++;
    return seoCalls === 1 ? { status: 502, body: { error: "upstream_down" } } : { status: 200, body: { section: "seo", updatedAt: now, data: { en: en.seo, de: de.seo } } };
  }
  if (method === "POST" && path === "/auth/login") {
    return { status: 401, body: { error: "invalid_credentials" } };
  }
  const body = answers[`${method} ${path}`];
  return body === undefined ? null : { status: 200, body };
}

const server = spawn(process.execPath, ["e2e/serve.mjs", "--port", String(PORT)], { cwd: CLIENT, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve) => {
  const on = (d) => String(d).includes("Listening on") && resolve();
  server.stdout.on("data", on);
  server.stderr.on("data", on);
});

const browser = await chromium.launch({ channel: "chrome" });
const problems = [];
const unmocked = new Set();
async function open(scheme, size, path, { reduced = false } = {}) {
  const context = await browser.newContext({ viewport: size, colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && !m.text().includes("ERR_FAILED") && problems.push(`${path}: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${path}: ${e}`));
  await page.route((url) => /^\/(?:admin|auth)\//.test(url.pathname) && url.origin !== ORIGIN, async (route) => {
    const req = route.request();
    const headers = { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type, x-csrf-token", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE" };
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers });
    }
    const path = new URL(req.url()).pathname;
    const a = answer(req.method(), path);
    if (!a) { unmocked.add(`${req.method()} ${path}`); return route.fulfill({ status: 404, headers, json: { error: "not_found" } }); }
    return route.fulfill({ status: a.status, headers, json: a.body });
  });
  await page.route((url) => url.hostname !== "127.0.0.1" && !/^\/(?:admin|auth)\//.test(url.pathname), (r) => r.abort());
  await page.goto(`${ORIGIN}${path}`);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  return { page, context };
}
// FREEZE=1 runs finite animations to their end before the shot: the sidebar caret then has one state.
const shot = (page, name, full = false) => page.screenshot({ path: join(OUT, `admin-${name}.png`), fullPage: full, animations: process.env.FREEZE ? "disabled" : "allow" });

try {
  await inTurn(["dark", "light"], async (scheme) => {
    // Dashboard, whole page.
    let { page, context } = await open(scheme, { width: 1440, height: 1000 }, "/admin");
    // Today since plan 5's Part F: the status line's publication and Needs you's rows.
    await page.getByRole("heading", { name: "Needs you" }).waitFor();
    await page.getByText("#12", { exact: true }).waitFor();
    await page.getByRole("link", { name: /^2 new messages/ }).waitFor();
    await page.waitForTimeout(600);
    await shot(page, `dashboard-${scheme}`, true);
    // Review dialog from the sidebar.
    await page.getByRole("button", { name: /^Publish:/ }).click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(500);
    await shot(page, `review-${scheme}`);
    await page.keyboard.press("Escape");
    // Collapsed to icons: the rail's button by its slot (Part E named it Navigation).
    await page.locator("[data-sidebar=trigger]").click();
    await page.waitForTimeout(400);
    await shot(page, `collapsed-${scheme}`);
    await context.close();

    // A long editor, scrolled: the header stuck on its surface.
    ({ page, context } = await open(scheme, { width: 1280, height: 800 }, "/admin/about"));
    await page.getByRole("heading", { level: 1, name: "About" }).waitFor();
    await page.locator("app-field-pair, app-bilingual-field").first().waitFor();
    await shot(page, `about-top-${scheme}`);
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(300);
    await shot(page, `about-stuck-${scheme}`);
    await context.close();

    // Work: the page header and the table (plan 5, U13).
    ({ page, context } = await open(scheme, { width: 1280, height: 900 }, "/admin/projects"));
    await page.getByRole("table").waitFor();
    await page.waitForTimeout(500);
    await shot(page, `projects-${scheme}`, true);
    await context.close();

    // A failed load, then its retry.
    seoCalls = 0;
    ({ page, context } = await open(scheme, { width: 1280, height: 800 }, "/admin/seo"));
    await page.getByText("Could not load this section").waitFor();
    await shot(page, `seo-error-${scheme}`);
    await context.close();

    // Sign-in, and after a wrong password: signed out, and by its heading (Part E took the terminal window away).
    signedOut = true;
    ({ page, context } = await open(scheme, { width: 1280, height: 800 }, "/admin/login"));
    await page.getByRole("heading", { level: 1, name: "Sign in" }).waitFor();
    await shot(page, `login-${scheme}`);
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Incorrect email or password.").waitFor();
    await page.waitForTimeout(500);
    await shot(page, `login-error-${scheme}`);
    await context.close();
    signedOut = false;

    // Phone width: dashboard and login.
    ({ page, context } = await open(scheme, { width: 390, height: 844 }, "/admin"));
    await page.getByRole("link", { name: /^2 new messages/ }).waitFor();
    await page.waitForTimeout(500);
    await shot(page, `dashboard-phone-${scheme}`, true);
    await context.close();
    signedOut = true;
    ({ page, context } = await open(scheme, { width: 390, height: 844 }, "/admin/login"));
    await page.getByRole("heading", { level: 1, name: "Sign in" }).waitFor();
    await shot(page, `login-phone-${scheme}`);
    await context.close();
    signedOut = false;
  });
} finally {
  console.log("problems:", problems.length ? problems.join("\n  ") : "none");
  console.log("unmocked:", unmocked.size ? [...unmocked].join(", ") : "none");
  await browser.close();
  server.kill();
}
