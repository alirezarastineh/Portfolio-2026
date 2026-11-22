// A screen reader's view of the admin, without a screen reader (plan 5, Accessibility: "the screen-reader tree,
// rebuilt for the admin, with a keyboard walk"). The visitors' tool is ../sr-audit.mjs; this one reads the admin on the
// fixture build, its API answered in the browser (lib.mjs), in Chrome at 1280, dark, reduced motion.
// What NVDA is handed is Chromium's accessibility tree (CDP Accessibility.getFullAXTree), so per screen (data.mjs's
// ROUTES and the Assistant's tabs):
// - the tab's title, the landmarks, the heading outline, the number of h1s and of aria-current="page";
// - every control in the tree without a name;
// - a keyboard walk: each Tab stop's role, name and description, and whatever the live regions said on the way.
// Flags: a control without a name, a stop whose role is generic or none, not exactly one h1 or one main, no
// aria-current, focus lost to the page, a live region speaking during a plain walk. Then three flows: a save (the
// header's status), a dialog (focus into it and back to its opener) and Find.
// Usage: node sr-audit.mjs [path filter] [max stops]. Writes sr-audit.json; prints the flags and a summary.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { answersFor, ROUTES, VIEWS } from "./data.mjs";
import { chromium, inTurn, loaded, open, SPECS, startServer } from "./lib.mjs";

const filter = process.argv[2] ?? "";
const MAX_STOPS = Number(process.argv[3] ?? 60);
const CONTROLS = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "checkbox", "switch", "radio", "tab", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "slider", "spinbutton", "listbox", "treeitem",
]);
const LANDMARKS = new Set(["banner", "navigation", "main", "complementary", "contentinfo", "region", "search", "form"]);

/** Everything the live regions say, in order: their text without what is aria-hidden, whenever it changes. */
const LISTEN = String.raw`(() => {
  const said = [];
  const last = new WeakMap();
  const regions = () => [...document.querySelectorAll('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]')];
  const text = (el) => {
    const copy = el.cloneNode(true);
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return (copy.textContent || "").replaceAll(/\s+/g, " ").trim();
  };
  const scan = (quiet) => {
    for (const el of regions()) {
      const now = text(el);
      if (!quiet && now && last.get(el) !== now) {
        const how = el.getAttribute("aria-live") || (el.getAttribute("role") === "alert" ? "assertive" : "polite");
        said.push("[" + how + "] " + now.slice(0, 140));
      }
      last.set(el, now);
    }
  };
  window.__heard = () => said.splice(0);
  window.__quiet = () => { scan(true); said.length = 0; };
  new MutationObserver(() => scan(false)).observe(document, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-live", "role"],
  });
})();`;

const { server, origin } = await startServer(4206);
const browser = await chromium.launch({ channel: "chrome" });
const report = [];
let flagged = 0;

const prop = (node, name) => node.properties?.find((p) => p.name === name)?.value?.value;

async function session(path, extra = {}) {
  const s = await open(browser, origin, { ...answersFor(path), ...extra }, {
    path,
    size: { width: 1280, height: 900 },
    init: LISTEN,
  });
  const cdp = await s.context.newCDPSession(s.page);
  await cdp.send("Accessibility.enable");
  const tree = async () => {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    return nodes.filter((n) => !n.ignored);
  };
  const focused = async () => {
    const nodes = await tree();
    return nodes.findLast((n) => prop(n, "focused") === true && n.role?.value !== "RootWebArea") ?? null;
  };
  return { ...s, cdp, tree, focused };
}

const said = (node) => {
  if (!node) {
    return "(nothing focused)";
  }
  const name = node.name?.value ?? "";
  const description = node.description?.value ? `, "${node.description.value}"` : "";
  return `${node.role?.value} "${name}"${description}`;
};

/** A stop as a screen reader reads it: role, name and any description. */
const spoken = ({ role, name, description }) =>
  description ? `${role} "${name}", "${description}"` : `${role} "${name}"`;

/** Tabs on until focus falls back to <body> or the cap, noting each stop and anything said meanwhile. */
async function walk(s, stops, heard) {
  if (stops.length >= MAX_STOPS) {
    return;
  }
  await s.page.keyboard.press("Tab");
  await s.page.waitForTimeout(60);
  const node = await s.focused();
  const onBody = await s.page.evaluate(() => document.activeElement === document.body);
  if (onBody || !node) {
    return;
  }
  stops.push({
    role: node.role?.value ?? "",
    name: (node.name?.value ?? "").trim(),
    description: node.description?.value ?? "",
  });
  heard.push(...(await s.page.evaluate(() => globalThis.__heard())));
  await walk(s, stops, heard);
}

/** What a screen gets wrong for a screen reader. */
function issuesOf({ h1, mains, current, unnamed, stops, heard }) {
  const issues = [];
  if (h1 !== 1) {
    issues.push(`${h1} h1`);
  }
  if (mains !== 1) {
    issues.push(`${mains} main`);
  }
  if (current !== 1) {
    issues.push(`${current} aria-current="page"`);
  }
  if (unnamed.length) {
    const counts = [...new Set(unnamed)].map((r) => `${r} ×${unnamed.filter((u) => u === r).length}`);
    issues.push(`unnamed: ${counts.join(", ")}`);
  }
  const generic = stops.filter((stop) => !stop.role || ["generic", "none", "presentation"].includes(stop.role));
  if (generic.length) {
    issues.push(`stops with no role: ${generic.length} (${generic.map((g) => g.name || "?").slice(0, 3).join(", ")})`);
  }
  const nameless = stops.filter((stop) => !stop.name && stop.role !== "tabpanel");
  if (nameless.length) {
    issues.push(`stops with no name: ${nameless.map((n) => n.role).join(", ")}`);
  }
  if (heard.length) {
    issues.push(`spoke during the walk: ${heard.slice(0, 3).join(" / ")}`);
  }
  return issues;
}

/** One screen: its landmarks, headings and unnamed controls, then the walk. */
async function audit(screen) {
  const s = await session(screen.path);
  const { page } = s;
  await page.locator("[data-slot=sidebar-inset]").waitFor({ timeout: 20_000 });
  await loaded(page);
  await page.evaluate(() => globalThis.__quiet());

  const nodes = await s.tree();
  const headings = nodes
    .filter((n) => n.role?.value === "heading")
    .map((n) => `h${prop(n, "level") ?? "?"} ${n.name?.value ?? ""}`.trim());
  const landmarks = nodes
    .filter((n) => LANDMARKS.has(n.role?.value) && (n.role.value !== "region" || n.name?.value))
    .map((n) => (n.name?.value ? `${n.role.value} "${n.name.value}"` : n.role.value));
  const unnamed = nodes
    .filter((n) => CONTROLS.has(n.role?.value) && !(n.name?.value ?? "").trim())
    .map((n) => n.role.value);
  const current = await page.locator('[aria-current="page"]').count();
  const h1 = headings.filter((h) => h.startsWith("h1")).length;
  const mains = landmarks.filter((l) => l === "main" || l.startsWith('main "')).length;

  // The walk: Tab from the page's top to the end, or the cap.
  const stops = [];
  const heard = [];
  await walk(s, stops, heard);
  const issues = issuesOf({ h1, mains, current, unnamed, stops, heard });
  flagged += issues.length;

  const entry = {
    screen: screen.name,
    title: await page.title(),
    landmarks,
    headings,
    h1,
    current,
    unnamed,
    stops: stops.map((stop) => spoken(stop)),
    walkedAll: stops.length < MAX_STOPS,
    heard,
    issues,
    problems: s.problems,
  };
  report.push(entry);
  const verdict = issues.length ? ` — ${issues.join("; ")}` : "";
  console.log(
    `${screen.name}: "${entry.title}", ${landmarks.length} landmarks, ${headings.length} headings (h1: ${h1}), ${stops.length}${entry.walkedAll ? "" : "+"} stops${verdict}`,
  );
  await s.context.close();
}

try {
  const screens = [
    ...ROUTES.filter((path) => path !== "/admin/login").map((path) => ({ name: path, path })),
    ...VIEWS.map((view) => ({ name: `assistant:${view}`, path: `/admin/assistant?view=${view}` })),
  ].filter((screen) => screen.name.includes(filter));

  await inTurn(screens, (screen) => audit(screen));

  // Flows: what a save says, where a dialog takes the focus and gives it back, and Find.
  if (!filter || "flows".includes(filter)) {
    const flows = [];
    const step = async (s, label, act, settle = 600) => {
      await s.page.evaluate(() => globalThis.__quiet());
      await act();
      await s.page.waitForTimeout(settle);
      const line = { label, focus: said(await s.focused()), heard: await s.page.evaluate(() => globalThis.__heard()) };
      flows.push(line);
      const spokenLines = line.heard.map((h) => `\n  heard: ${h}`).join("");
      console.log(`\n> ${label}\n  focus: ${line.focus}${spokenLines}`);
      return line;
    };

    const groups = answersFor("/admin/skills")["GET /admin/skills"].skills.map((group) => group.id);
    let s = await session(
      "/admin/skills",
      Object.fromEntries(groups.map((id) => [`PUT /admin/skills/${id}`, { ok: true }])),
    );
    await s.page.locator("[data-slot=sidebar-inset]").waitFor({ timeout: 20_000 });
    await loaded(s.page);
    const title = s.page.locator("input[id$='-title-en']").first();
    await step(s, "Skills: type in a group's title", () => title.fill("Core architecture and APIs"));
    await step(s, "Skills: Ctrl S", () => s.page.keyboard.press("Control+s"), 1200);
    const remove = s.page.getByRole("button", { name: /^Delete / }).first();
    await step(s, "Skills: Delete on the first group (a dialog)", () => remove.click());
    await step(s, "Skills: Escape closes it", () => s.page.keyboard.press("Escape"));
    await s.context.close();

    s = await session("/admin/legal");
    await s.page.locator("[data-slot=sidebar-inset]").waitFor({ timeout: 20_000 });
    await loaded(s.page);
    await step(s, "Legal: the Privacy tab by arrow", async () => {
      await s.page.getByRole("tab", { name: /^Imprint/ }).focus();
      await s.page.keyboard.press("ArrowRight");
    });
    await step(s, "Find: Ctrl K", () => s.page.keyboard.press("Control+k"));
    await step(s, "Find: type send", () => s.page.keyboard.type("send", { delay: 30 }), 900);
    await step(s, "Find: Escape", () => s.page.keyboard.press("Escape"));
    await s.context.close();
    report.push({ flows });
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(join(SPECS, "sr-audit.json"), JSON.stringify(report, null, 2));
console.log(`\n${flagged} flag(s) in ${report.filter((r) => r.screen).length} screens; full walk in sr-audit.json`);
