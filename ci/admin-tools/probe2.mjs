// Second pass: the probes that needed the server's real error code, or a better locator.
import { setTimeout as sleep } from "node:timers/promises";
import { answers } from "./data.mjs";
import { chromium, fake, inTurn, loaded, open, outDir, shot, SIZES, startServer } from "./lib.mjs";
const dir = outDir("shots/states");
const { server, origin } = await startServer(4199);
const browser = await chromium.launch({ channel: "chrome" });
const log = (id, v, d) => console.log(`${id} | ${v} | ${String(d).replaceAll(/\s+/g, " ").slice(0, 320)}`);
// Part G: About is on the bilingual field and the editor header ("Save"); the other editors keep the pair and "Save draft".
const firstField = (page) => page.locator("app-field-pair input, app-field-pair textarea, app-bilingual-field input, app-bilingual-field textarea").first();
// A reply 2.5 s late, so the screen shows its loading state first.
const later = (body) => async () => {
  await sleep(2500);
  return { status: 200, body };
};
async function t(id, fn) {
  try {
    await fn();
  } catch (error) {
    log(id, "ERROR", error.message.split("\n")[0]);
  }
}

await t("D01", async () => {
  const a = answers();
  a["PATCH /admin/sections/ui"] = () => ({ status: 401, body: { error: "unauthenticated" } });
  const { page, context } = await open(browser, origin, a, { path: "/admin/about" });
  await loaded(page);
  await firstField(page).fill("Typed before the session died");
  await page.getByRole("button", { name: /^Save( draft)?$/ }).first().click();
  await page.waitForTimeout(1800);
  await shot(page, dir, "d01-after-401");
  const url = page.url().replace(origin, "");
  const asked = await page.getByRole("alertdialog").count();
  log("D01", url.includes("/login") ? "CONFIRMED" : "STRUCK", `url ${url}, guard dialog ${asked}`);
  await context.close();
});

await t("D03", async () => {
  await inTurn([0, 100, 300, 800], async (wait) => {
    const puts = [];
    const a = answers();
    a["PUT /admin/projects/p0"] = (n, req) => {
      puts.push(req.postDataJSON());
      return { status: 200, body: { ok: true } };
    };
    const { page, context } = await open(browser, origin, a, { path: "/admin/projects/project-one" });
    await loaded(page);
    const ed = page.locator("app-rich-text [contenteditable=true]").first();
    await ed.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" TAIL", { delay: 5 });
    if (wait) {
      await page.waitForTimeout(wait);
    }
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(1200);
    const bar = await page.locator("app-editor-header [role=status]").first().innerText();
    const saved = puts.at(-1)?.translations?.en?.problem ?? "";
    log(`D03 wait ${wait}`, puts.length && saved.includes("TAIL") ? "OK" : "LOST", `saves ${puts.length}, tail saved ${saved.includes("TAIL")}, bar "${bar.replaceAll('\n', " ").slice(0, 70)}"`);
    await context.close();
  });
});

await t("D05", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/writing/shipping-rag-to-production" });
  await loaded(page);
  // The switch by its name (plan 5, Part K: the version switches lead the Text section).
  const sw = () => page.getByRole("switch", { name: "German version" });
  const before = await page.locator("#post-title-de").inputValue();
  await sw().click();
  await page.waitForTimeout(400);
  const asked = await page.getByRole("alertdialog").count();
  // Since plan 5's Part B it asks once: agree, then the switch back on must restore the text.
  if (asked) {
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove when I save" }).click();
    await page.waitForTimeout(400);
  }
  const off = await page.locator("#post-title-de").count();
  await sw().click();
  await page.waitForTimeout(400);
  const after = await page.locator("#post-title-de").inputValue();
  log("D05", after !== before && asked === 0 ? "CONFIRMED" : "STRUCK", `asked ${asked}, field gone while off ${off === 0}; before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  await context.close();
});

await t("S01", async () => {
  // Part M1 (U18): each old tab by the view that holds it now (Trust's alerts are on Now).
  await inTurn([["Conversations", "GET /admin/assistant/conversations", "conversations"], ["Journal", "GET /admin/assistant/journal", "journal"], ["FAQ", "GET /admin/assistant/faq", "questions"], ["Trust", "GET /admin/assistant/trust", "now"], ["Copilot", "GET /admin/ai/skills", "quality"], ["Insights", "GET /admin/assistant/insights", "questions"]], async ([tab, key, view]) => {
    const { page, context } = await open(browser, origin, { ...answers(), [key]: () => ({ status: 502, body: { error: "upstream_down" } }) }, { path: `/admin/assistant?view=${view}` });
    await page.waitForTimeout(1300);
    const alerts = await page.getByRole("alert").count();
    const toast = await page.locator("[data-sonner-toast]").count();
    const says = /could not load|try again|failed to load/i.test(await page.locator("main").innerText());
    await shot(page, dir, `s01-${tab.toLowerCase()}-failed`);
    let verdict = "SILENT";
    if (says || alerts) {
      verdict = "says so";
    } else if (toast) {
      verdict = "toast only";
    }
    log(`S01 ${tab}`, verdict, `alerts ${alerts}, toasts ${toast}`);
    await context.close();
  });
});

await t("V06", async () => {
  await inTurn([["/admin/about", ["GET /admin/sections/ui"], "about"], ["/admin/projects", ["GET /admin/projects"], "projects"], ["/admin", ["GET /admin/status", "GET /admin/assistant/health"], "dashboard"], ["/admin/media", ["GET /admin/media"], "media"]], async ([path, keys, name]) => {
    const a = answers();
    for (const k of keys) {
      a[k] = later(a[k]);
    }
    const context = await browser.newContext({ viewport: SIZES.laptop, colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    await fake(page, origin, a);
    await page.goto(`${origin}${path}`, { waitUntil: "commit" });
    await page.waitForTimeout(1800);
    await shot(page, dir, `v06-loading-${name}`);
    await context.close();
  });
  log("V06", "SEEN", "loading shots");
});

await t("V09 login", async () => {
  const a = answers();
  a["GET /auth/me"] = () => ({ status: 401, body: { error: "unauthenticated" } });
  a["POST /auth/login"] = () => ({ status: 200, body: { ok: true, totpRequired: true, user: null } });
  const context = await browser.newContext({ viewport: SIZES.phone, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  await fake(page, origin, a);
  await page.goto(`${origin}/admin/login`);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.waitForTimeout(500);
  await shot(page, dir, "v09-login-phone");
  await page.getByLabel("Email").fill("a@b.c");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForTimeout(700);
  await shot(page, dir, "v09-login-totp-phone");
  log("V09", "SEEN", await page.locator("h1").first().innerText());
  await context.close();
});

await browser.close();
server.kill();
