// Confirms or strikes the suspected defects in a real browser. Prints one line per probe.
// Every call is answered in the browser or aborted: nothing reaches a real API.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { answers } from "./data.mjs";
import * as fx from "./fixtures.generated.mjs";
import { chromium, inTurn, loaded, open, outDir, shot, SIZES, SPECS, startServer } from "./lib.mjs";

const dir = outDir("shots/states");
const { server, origin } = await startServer(4198);
const browser = await chromium.launch({ channel: "chrome" });
const results = [];
const only = process.argv[2];
function log(id, verdict, detail) {
  results.push({ id, verdict, detail });
  console.log(`${id} | ${verdict} | ${String(detail).replaceAll(/\s+/g, " ").slice(0, 300)}`);
}
async function probe(id, fn) {
  if (only && !id.startsWith(only)) {
    return;
  }
  try {
    await fn();
  } catch (error) {
    log(id, "ERROR", error.message.split("\n")[0]);
  }
}
// Part G: About is on the bilingual field and the editor header ("Save"); the other editors keep the pair and "Save draft".
const firstField = (page) => page.locator("app-field-pair input, app-field-pair textarea, app-bilingual-field input, app-bilingual-field textarea").first();
const nextTick = (page, ms = 400) => page.waitForTimeout(ms);
const consoleErrors = (problems) => problems.slice(0, 3).join(" // ");
// A reply that never comes, so the screen stays on its loading state.
const neverAnswered = () => new Promise(() => {});

await probe("D01 401 during an edit destroys it", async () => {
  const a = answers();
  a["PATCH /admin/sections/ui"] = () => ({ status: 401, body: { error: "unauthorized" } });
  const { page, context } = await open(browser, origin, a, { path: "/admin/about" });
  await loaded(page);
  await firstField(page).fill("Typed before the session died");
  await page.getByRole("button", { name: /^Save( draft)?$/ }).first().click();
  await page.waitForTimeout(1500);
  const url = page.url();
  await shot(page, dir, "d01-after-401");
  const still = await firstField(page).inputValue({ timeout: 1000 }).catch(() => null);
  log("D01", url.includes("/login") || still === null ? "CONFIRMED" : "STRUCK", `url ${url.replace(origin, "")}, field now ${JSON.stringify(still)}`);
  await context.close();
});

await probe("D02 sign out with a dirty editor", async () => {
  const { page, context, record } = await open(browser, origin, { ...answers(), "POST /auth/logout": { ok: true } }, { path: "/admin/about" });
  await loaded(page);
  await firstField(page).fill("Unsaved words");
  await nextTick(page);
  await page.getByRole("button", { name: /sign out/i }).first().click();
  await page.waitForTimeout(900);
  const dialog = await page.getByRole("alertdialog").count();
  log("D02", dialog === 0 ? "CONFIRMED" : "STRUCK", `alertdialogs ${dialog}, url ${page.url().replace(origin, "")}, writes ${record.writes.map((w) => w.key).join(",")}`);
  await context.close();
});

await probe("D03 Ctrl+S right after rich-text typing", async () => {
  const puts = [];
  const a = answers();
  a["PUT /admin/projects/p0"] = (n, req) => { puts.push(req.postDataJSON()); return { status: 200, body: { ok: true } }; };
  const { page, context } = await open(browser, origin, a, { path: "/admin/projects/project-one" });
  await loaded(page);
  const ed = page.locator("app-rich-text [contenteditable=true]").first();
  await ed.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" TAIL", { delay: 5 });
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1200);
  const saved = puts.at(-1)?.translations?.en?.problem ?? "(no save)";
  log("D03", saved.includes("TAIL") ? "STRUCK" : "CONFIRMED", `saves ${puts.length}; saved tail present: ${saved.includes("TAIL")}`);
  await context.close();
});

await probe("D04 media alt edit lost on close", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/media" });
  await loaded(page);
  await page.getByRole("button", { name: "Details of old-screenshot.png" }).click();
  const sheet = page.locator("hlm-sheet-content");
  await sheet.waitFor();
  const alt = sheet.getByRole("textbox").first();
  await alt.fill("Alt text I typed");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const asked = await page.getByRole("alertdialog").count();
  // Since plan 5's Part B the question stands in the way: keep editing, and the text must still be there.
  if (asked) {
    await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing" }).click();
    await page.waitForTimeout(500);
    const kept = await sheet.getByRole("textbox").first().inputValue();
    log("D04", kept === "Alt text I typed" ? "STRUCK" : "CONFIRMED", `asked ${asked}, after Keep editing ${JSON.stringify(kept)}`);
    await context.close();
    return;
  }
  await page.getByRole("button", { name: "Details of old-screenshot.png" }).click();
  await sheet.waitFor();
  const v = await sheet.getByRole("textbox").first().inputValue();
  log("D04", asked === 0 && v !== "Alt text I typed" ? "CONFIRMED" : "STRUCK", `asked ${asked}, value after reopening ${JSON.stringify(v)}`);
  await context.close();
});

await probe("D05 post language off wipes text", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/writing/shipping-rag-to-production" });
  await loaded(page);
  const sw = page.getByRole("switch", { name: /German version/i });
  // The German title by its id (plan 5, Part K: one bilingual field labels both languages).
  const title = page.locator("#post-title-de");
  const before = await title.inputValue();
  await sw.click();
  await nextTick(page);
  const asked = await page.getByRole("alertdialog").count();
  if (asked) {
    await page.getByRole("button", { name: /remove|delete|discard|yes|confirm/i }).first().click().catch(() => {});
  }
  await nextTick(page);
  await sw.click();
  await nextTick(page);
  const after = await title.inputValue({ timeout: 5000 }).catch(() => "(gone)");
  log("D05", after === before ? "STRUCK" : "CONFIRMED", `asked ${asked}; before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  await context.close();
});

await probe("D06 copy EN to DE overwrites, no undo", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/about" });
  await loaded(page);
  const pair = page.locator("app-field-pair, app-bilingual-field").first();
  const de = pair.locator("input, textarea").nth(1);
  const before = await de.inputValue();
  // Part G: the bilingual field keeps its steps in a ⋯ menu.
  const more = pair.getByRole("button", { name: /^More actions for/ });
  if (await more.count()) {
    await more.click();
    await page.getByRole("menuitem", { name: "Copy English to German" }).click();
  } else {
    await pair.getByRole("button", { name: /copy|EN.*DE/i }).first().click();
  }
  await nextTick(page);
  const asked = await page.getByRole("alertdialog").count();
  const after = await de.inputValue();
  const undo = await page.getByRole("button", { name: /undo/i }).count();
  log("D06", asked === 0 && after !== before && undo === 0 ? "CONFIRMED" : "STRUCK", `asked ${asked}, undo offers ${undo}, ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  await context.close();
});

await probe("D07 Discard is one click", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/about" });
  await loaded(page);
  await firstField(page).fill("A long thought I do not want to lose");
  await nextTick(page);
  // Part G: About's Discard is in its editor header's ⋯.
  const more = page.getByRole("button", { name: "More actions for About" });
  if (await more.count()) {
    await more.click();
    await page.getByRole("menuitem", { name: /^Discard/ }).click();
  } else {
    await page.getByRole("button", { name: "Discard" }).first().click();
  }
  await nextTick(page);
  const asked = await page.getByRole("alertdialog").count();
  const v = await firstField(page).inputValue();
  log("D07", asked === 0 ? "CONFIRMED" : "STRUCK", `asked ${asked}; field ${JSON.stringify(v)}`);
  await context.close();
});

await probe("D12 failed media load reads as empty", async () => {
  const { page, context } = await open(browser, origin, { ...answers(), "GET /admin/media": () => ({ status: 502, body: { error: "upstream_down" } }) }, { path: "/admin/media" });
  await page.waitForTimeout(1500);
  const text = await page.locator("main").innerText();
  await shot(page, dir, "d12-media-failed");
  log("D12", /nothing uploaded/i.test(text) ? "CONFIRMED" : "STRUCK", text.slice(0, 200));
  await context.close();
});

await probe("D14 status failure shows All published", async () => {
  const { page, context } = await open(browser, origin, { ...answers(), "GET /admin/status": () => ({ status: 502, body: { error: "upstream_down" } }) }, { path: "/admin/about" });
  await page.waitForTimeout(1500);
  const txt = await page.locator("[data-slot=sidebar-footer]").innerText();
  await shot(page, dir, "d14-status-failed");
  log("D14", /all published/i.test(txt) ? "CONFIRMED" : "STRUCK", txt);
  await context.close();
});

await probe("D18 save bar sticks", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/hero" });
  await loaded(page);
  await page.getByLabel("Name", { exact: true }).fill("Changed name");
  await nextTick(page);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(400);
  // Part H: Profile's Save is in its editor header (plan 5, U11).
  const box = await page.locator("app-save-bar, app-editor-header [aria-keyshortcuts]").first().boundingBox();
  const view = page.viewportSize();
  await shot(page, dir, "d18-save-bar-mid-page");
  const inView = box && box.y >= 0 && box.y + box.height <= view.height + 1;
  log("D18", inView ? "STRUCK" : "CONFIRMED", `save bar y ${box && Math.round(box.y)}, h ${box && Math.round(box.height)}, viewport ${view.height}, scrollY 900`);
  await context.close();
});

await probe("D19 clicking through an empty rich text marks dirty", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/projects/project-three" });
  await loaded(page);
  await page.waitForTimeout(400);
  const eds = page.locator("app-rich-text [contenteditable=true]");
  const n = await eds.count();
  const before = await page.locator("app-editor-header [role=status]").first().innerText();
  await eds.nth(n - 1).click();
  await page.keyboard.press("Tab");
  await page.waitForTimeout(600);
  const after = await page.locator("app-editor-header [role=status]").first().innerText();
  log("D19", /changed|unsaved/i.test(after) && !/changed|unsaved/i.test(before) ? "CONFIRMED" : "STRUCK", `editors ${n}; before "${before.replaceAll('\n', " ")}" after "${after.replaceAll('\n', " ")}"`);
  await context.close();
});

await probe("D30 stepping with J marks messages read", async () => {
  const a = answers();
  const patched = [];
  for (const id of ["m1", "m2", "m6"]) {
    a[`PATCH /admin/messages/${id}`] = (n, req) => { patched.push([id, req.postDataJSON()]); return { status: 200, body: { ok: true } }; };
  }
  const { page, context } = await open(browser, origin, a, { path: "/admin/inbox" });
  await loaded(page);
  await page.keyboard.press("j");
  await nextTick(page);
  await page.keyboard.press("j");
  await nextTick(page);
  await page.keyboard.press("j");
  await page.waitForTimeout(600);
  await shot(page, dir, "d30-inbox-open");
  log("D30", patched.length >= 2 ? "CONFIRMED" : "STRUCK", JSON.stringify(patched));
  await context.close();
});

await probe("D44 code block in light theme", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/writing/shipping-rag-to-production", theme: "light" });
  await loaded(page);
  const pre = page.locator("app-rich-text .admin-prose pre, app-rich-text pre").first();
  await pre.scrollIntoViewIfNeeded();
  const c = await pre.evaluate((el) => { const s = getComputedStyle(el); const code = el.querySelector("code"); const t = getComputedStyle(code ?? el); return { bg: s.backgroundColor, color: t.color }; });
  await page.waitForTimeout(200);
  await shot(page, dir, "d44-code-block-light");
  log("D44", "MEASURED", JSON.stringify(c));
  await context.close();
});

await probe("E04 tab titles", async () => {
  const titles = new Set();
  await inTurn(["/admin", "/admin/hero", "/admin/inbox", "/admin/projects/project-one"], async (path) => {
    const { page, context } = await open(browser, origin, answers(), { path });
    await loaded(page);
    titles.add(await page.title());
    await context.close();
  });
  log("E04", titles.size === 1 ? "CONFIRMED" : "STRUCK", [...titles].join(" | "));
});

await probe("E06 phone has no palette", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin", size: SIZES.phone });
  await loaded(page);
  // Part E named it Find (it was "Jump to…"), in the top bar.
  const find = page.getByRole("button", { name: /^(find|jump to)/i });
  const n = await find.count();
  const vis = n ? await find.first().isVisible() : false;
  await shot(page, dir, "e06-phone-dashboard");
  log("E06", vis ? "STRUCK" : "CONFIRMED", `Jump to count ${n}, visible ${vis}`);
  await context.close();
});

await probe("E07 phone sheet closes after a tap", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin", size: SIZES.phone });
  await loaded(page);
  // Spartan's trigger, by its slot: Part E named it Navigation (it was "Toggle sidebar").
  await page.locator("[data-sidebar=trigger]").first().click();
  await page.waitForTimeout(500);
  await shot(page, dir, "e07-phone-menu");
  await page.getByRole("link", { name: /^Inbox/ }).first().click();
  await page.waitForTimeout(900);
  const open_ = await page.locator("[data-mobile=true]").count();
  const url = page.url().replace(origin, "");
  await shot(page, dir, "e07-after-tap");
  log("E07", open_ > 0 ? "CONFIRMED" : "STRUCK", `mobile sheet nodes ${open_}, url ${url}`);
  await context.close();
});

await probe("E08 Ctrl+B in rich text collapses the sidebar", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/projects/project-one" });
  await loaded(page);
  const state = () => page.locator("[data-slot=sidebar]").first().evaluate((el) => el.dataset.state);
  const before = await state();
  await page.locator("app-rich-text [contenteditable=true]").first().click();
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(500);
  const after = await state();
  log("E08", before === after ? "STRUCK" : "CONFIRMED", `sidebar ${before} → ${after}`);
  await context.close();
});

await probe("E09 aria-current and skip link", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/projects/project-one" });
  await loaded(page);
  const cur = await page.locator("[aria-current=page]").evaluateAll((els) => els.map((e) => `${e.tagName}:${e.textContent.trim().slice(0, 24)}`));
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => `${document.activeElement.tagName} ${(document.activeElement.textContent || "").trim().slice(0, 30)}`);
  log("E09", "MEASURED", `aria-current: ${cur.join(" ; ")} || first Tab: ${first}`);
  await context.close();
});

await probe("E10 focus after navigation", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin" });
  await loaded(page);
  await page.getByRole("link", { name: /^About/ }).first().click();
  await page.waitForTimeout(900);
  const a = await page.evaluate(() => `${document.activeElement.tagName}.${document.activeElement.dataset.slot ?? ""} ${(document.activeElement.textContent || "").trim().slice(0, 30)}`);
  log("E10", "MEASURED", a);
  await context.close();
});

await probe("E11 signed-in user on login page", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/login" });
  await page.waitForTimeout(800);
  log("E11", page.url().endsWith("/admin/login") ? "CONFIRMED" : "STRUCK", page.url().replace(origin, ""));
  await context.close();
});

await probe("E20 legal preview button follows the tab", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/legal" });
  await loaded(page);
  // Part K2: the header's draft link ("Imprint draft"), where the save bar's Preview was.
  const link = page.locator("app-editor-header a[target=_blank]").first();
  const a = await link.getAttribute("href");
  await page.getByRole("tab", { name: /Privacy/ }).click();
  await nextTick(page);
  const b = await link.getAttribute("href");
  log("E20", a === b ? "CONFIRMED" : "STRUCK", `${a} → ${b}`);
  await context.close();
});

await probe("E28 draft tab: match link", async () => {
  const { page, context, problems } = await open(browser, origin, answers(), { path: "/admin/preview/en" });
  await page.waitForTimeout(2500);
  const hrefs = await page.locator("a[href*='match']").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  const shell = await page.evaluate(() => ({ publicShell: !!document.querySelector("app-public-shell"), frame: !!document.querySelector("app-admin-preview-frame") }));
  const h1 = await page.locator("h1").first().evaluate((e) => { const s = getComputedStyle(e); return { textWrap: s.textWrap, hyphens: s.hyphens }; });
  await shot(page, dir, "e28-draft-tab");
  if (hrefs[0]) {
    await page.locator("a[href*='match']").first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  const body = await page.locator("body").innerText();
  log("E28", "MEASURED", `match hrefs ${hrefs.join(",")}, shell ${JSON.stringify(shell)}, h1 ${JSON.stringify(h1)}, after click url ${page.url().replace(origin, "")}, says 404: ${/404|isn.t here/i.test(body)}, console: ${consoleErrors(problems)}`);
  await context.close();
});

await probe("E29 draft tab: stage asks for real", async () => {
  const asked = [];
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/preview/en" });
  page.on("request", (r) => { if (/\/ask/.test(r.url())) {
    asked.push(`${r.method()} ${new URL(r.url()).pathname}`);
  } });
  await page.waitForTimeout(2500);
  const btn = page.locator("#hero button, section button").filter({ hasText: /\?/ }).first();
  const label = await btn.textContent({ timeout: 2000 }).catch(() => null);
  if (label) {
    await btn.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  log("E29", asked.some((a) => a.startsWith("POST")) ? "CONFIRMED" : "STRUCK", `clicked ${JSON.stringify(label?.trim())}; requests ${[...new Set(asked)].join(" ; ") || "none"}`);
  await context.close();
});

// Plan 5, U20: Ctrl Enter saves now (S went); on a fresh answer, nothing pressed, it must send nothing.
await probe("R01 Reviews: Save and next on a fresh answer", async () => {
  const puts = [];
  const a = answers();
  a["PUT /admin/assistant/reviews/m_review0001"] = (n, req) => { puts.push(req.postDataJSON()); return { status: 200, body: { ok: true, reviewedAt: fx.NOW } }; };
  const { page, context } = await open(browser, origin, a, { path: "/admin/assistant?view=reviews" });
  await loaded(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(700);
  log("R01", puts.length ? "CONFIRMED" : "STRUCK", JSON.stringify(puts[0]));
  await context.close();
});

await probe("R02 Reviews: J drops unsaved verdicts", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/assistant?view=reviews" });
  await loaded(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("1");
  await nextTick(page, 200);
  const correct = page.getByRole("group", { name: "Correct" }).getByRole("button", { name: "Good", exact: true });
  const on = await correct.getAttribute("aria-pressed");
  await page.keyboard.press("j");
  await nextTick(page);
  await page.keyboard.press("k");
  await nextTick(page);
  const later = await page.getByRole("group", { name: "Correct" }).getByRole("button", { name: "Good", exact: true }).getAttribute("aria-pressed");
  log("R02", on === "true" && later !== "true" ? "CONFIRMED" : "STRUCK", `after 1: ${on}; after J then K: ${later}`);
  await context.close();
});

await probe("S01 failed loads in Assistant tabs read as empty", async () => {
  // Part M1 (U18): each old tab by the view that holds it now.
  await inTurn([["Conversations", "GET /admin/assistant/conversations", "conversations"], ["Evals", "GET /admin/assistant/runs", "quality"], ["Journal", "GET /admin/assistant/journal", "journal"], ["Reviews", "GET /admin/assistant/reviews", "reviews"]], async ([tab, key, view]) => {
    const { page, context } = await open(browser, origin, { ...answers(), [key]: () => ({ status: 502, body: { error: "upstream_down" } }) }, { path: `/admin/assistant?view=${view}` });
    await page.waitForTimeout(1300);
    const t = await page.locator("main").innerText();
    log(`S01 ${tab}`, /could not|failed|try again/i.test(t) ? "STRUCK" : "CONFIRMED", t.slice(0, 120));
    await context.close();
  });
});

await probe("S02 outcomes failure stays Loading", async () => {
  const { page, context } = await open(browser, origin, { ...answers(), "GET /admin/assistant/outcomes": () => ({ status: 502, body: { error: "x" } }) }, { path: "/admin/assistant?view=quality" });
  await page.waitForTimeout(2500);
  const t = await page.locator("app-assistant-outcomes").innerText();
  log("S02", /loading/i.test(t) ? "CONFIRMED" : "STRUCK", t.slice(0, 120));
  await context.close();
});

await probe("V01 conflict", async () => {
  const a = answers();
  a["PATCH /admin/sections/ui"] = () => ({ status: 409, body: { error: "stale" } });
  const { page, context } = await open(browser, origin, a, { path: "/admin/about" });
  await loaded(page);
  await firstField(page).fill("My edit");
  await page.getByRole("button", { name: /^Save( draft)?$/ }).first().click();
  await page.waitForTimeout(900);
  await shot(page, dir, "v01-conflict");
  const text = await page.locator("[data-sonner-toast]").first().innerText().catch(() => "");
  log("V01", "SEEN", text);
  await context.close();
});

await probe("V02 validation errors", async () => {
  const a = answers();
  a["PATCH /admin/sections/ui"] = () => ({ status: 400, body: { error: "invalid", issues: [{ path: ["groups", "about", "en", "heading"], message: "Required" }, { path: ["groups", "about", "de", "philosophy"], message: "Required" }] } });
  const { page, context } = await open(browser, origin, a, { path: "/admin/about" });
  await loaded(page);
  await firstField(page).fill("x");
  await page.getByRole("button", { name: /^Save( draft)?$/ }).first().click();
  await page.waitForTimeout(900);
  await shot(page, dir, "v02-invalid");
  const focus = await page.evaluate(() => document.activeElement.id);
  log("V02", "SEEN", `focus ${focus}`);
  await context.close();
});

await probe("V03 overlays", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin" });
  await loaded(page);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(400);
  await shot(page, dir, "v03-palette");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("?");
  await page.waitForTimeout(400);
  await shot(page, dir, "v03-shortcuts");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Publish:/ }).click();
  await page.waitForTimeout(700);
  await shot(page, dir, "v03-publish-review");
  log("V03", "SEEN", "palette, shortcuts, publish review");
  await context.close();
});

await probe("V04 live preview split", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/hero", size: { width: 1440, height: 900 }, init: () => localStorage.setItem("admin.preview.open", "1") });
  await page.waitForTimeout(4000);
  await shot(page, dir, "v04-live-preview");
  log("V04", "SEEN", "live preview");
  await context.close();
});

await probe("V05 first run, nothing yet", async () => {
  const a = answers();
  Object.assign(a, { "GET /admin/projects": { projects: [] }, "GET /admin/posts": { posts: [] }, "GET /admin/experiences": { experiences: [] }, "GET /admin/skills": { skills: [] }, "GET /admin/socials": { socials: [] }, "GET /admin/media": { media: [] }, "GET /admin/messages": { messages: [] }, "GET /admin/publications": { publications: [] } });
  await inTurn([["/admin/projects", "projects"], ["/admin/experience", "experience"], ["/admin/writing", "writing"], ["/admin/skills", "skills"], ["/admin/media", "media"], ["/admin/inbox", "inbox"], ["/admin/publications", "publications"]], async ([path, name]) => {
    const { page, context } = await open(browser, origin, a, { path });
    await loaded(page);
    await shot(page, dir, `v05-empty-${name}`);
    await context.close();
  });
  log("V05", "SEEN", "empty lists shot");
});

await probe("V06 loading state", async () => {
  const { page, context } = await open(browser, origin, { ...answers(), "GET /admin/sections/ui": neverAnswered, "GET /admin/projects": neverAnswered }, { path: "/admin/about" });
  await page.waitForTimeout(1200);
  await shot(page, dir, "v06-loading-about");
  await page.goto(`${origin}/admin/projects`);
  await page.waitForTimeout(1500);
  await shot(page, dir, "v06-loading-projects");
  log("V06", "SEEN", "loading shots");
  await context.close();
});

await probe("V07 leave with unsaved", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/about" });
  await loaded(page);
  await firstField(page).fill("Dirty");
  await nextTick(page);
  await page.getByRole("link", { name: /^Skills/ }).first().click();
  await page.waitForTimeout(500);
  await shot(page, dir, "v07-unsaved-guard");
  const t = await page.getByRole("alertdialog").innerText().catch(() => "(no dialog)");
  log("V07", "SEEN", t);
  await context.close();
});

await probe("V08 shortcuts line, Ctrl or command", async () => {
  const { page, context } = await open(browser, origin, answers(), { path: "/admin/about" });
  await loaded(page);
  // Part E named it Find (it was "Jump to…").
  const jump = await page.getByRole("button", { name: /^(find|jump to)/i }).first().innerText();
  // Part G: About's Save is in its editor header.
  const bar = await page.locator("app-save-bar, app-editor-header").first().innerText();
  log("V08", /⌘/.test(jump) ? "CONFIRMED" : "STRUCK", `jump "${jump.replaceAll('\n', " ")}"; bar "${bar.replaceAll('\n', " ")}"`);
  await context.close();
});

writeFileSync(join(SPECS, only ? `probe-${only}.json` : "probe.json"), JSON.stringify(results, null, 1));
await browser.close();
server.kill();
