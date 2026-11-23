// Every screen at 320, 390, 820, 1024 (touch), 1280 and 1920 (mouse), dark and light: shots plus layout
// numbers (plan 5, U23: on touch, no target under 44px and no field under 16px).
// Usage: node matrix.mjs [path filter]. Writes shots/matrix/<size>-<theme>/<screen>.png and matrix.json.
// A filter (a part of a path, `/admin/login`) measures those screens alone and no Assistant tab.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { answersFor, ROUTES, VIEWS } from "./data.mjs";

const only = process.argv[2] ?? "";
import { chromium, inTurn, loaded, open, outDir, shot, SIZES, SPECS, startServer } from "./lib.mjs";

const { server, origin } = await startServer(4200);
const browser = await chromium.launch({ channel: "chrome" });
const MATRIX = ["small", "phone", "tablet", "landscape", "laptop", "wide"].flatMap((size) => [
  [size, "dark"],
  [size, "light"],
]);
// `?` and `=` (Experience's entry, `?edit=e0`) cannot stand in a Windows file name.
const name = (p) =>
  p.replace(/^\/admin\/?/, "").replaceAll("/", "-").replaceAll(/[?=]/g, "-") || "dashboard";

function measure() {
  const edge = document.documentElement.clientWidth;
  const touch = matchMedia("(pointer: coarse)").matches;
  // Every element drawn: it has a size, and is neither hidden nor display: none.
  const shown = new Set(
    [document.body, ...document.body.querySelectorAll("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    }),
  );
  const controls = [...document.querySelectorAll("a[href], button, input, select, textarea, [role=switch], [role=tab], summary, [contenteditable=true]")].filter((el) => shown.has(el));
  const min = touch ? 44 : 24;
  // A target's size when under `min`, else null. Its area is the box, or an absolute ::after reaching
  // past it (the switch's is 44×44 on touch). WCAG 2.5.5 and 2.5.8 exempt a link in a sentence: inline,
  // with words of its parent's own beside it (a cell's slug in a block under the link is no sentence).
  const tooSmall = (el) => {
    const inText = [...el.parentElement.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== "");
    if (el.matches("a") && getComputedStyle(el).display === "inline" && inText) {
      return null;
    }
    const r = el.getBoundingClientRect();
    const after = getComputedStyle(el, "::after");
    const reach = after.content !== "none" && after.position === "absolute" && after.pointerEvents !== "none";
    const width = reach ? Math.max(r.width, Number.parseFloat(after.width) || 0) : r.width;
    const height = reach ? Math.max(r.height, Number.parseFloat(after.height) || 0) : r.height;
    return width < min || height < min ? `${Math.round(width)}x${Math.round(height)}` : null;
  };
  const small = [];
  for (const el of controls) {
    if (el.matches("input[type=checkbox], input[type=radio], [contenteditable=true], textarea")) {
      continue;
    }
    const size = tooSmall(el);
    if (size) {
      small.push(`${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 18)} ${size}`);
    }
  }
  const under12 = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent.trim();
    if (!t) {
      continue;
    }
    const p = walker.currentNode.parentElement;
    if (!shown.has(p)) {
      continue;
    }
    if (Number.parseFloat(getComputedStyle(p).fontSize) < 12) {
      under12.add(t.slice(0, 22));
    }
  }
  const fields = [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]), textarea, select")].filter((el) => shown.has(el));
  const smallFields = fields.filter((f) => Number.parseFloat(getComputedStyle(f).fontSize) < 16).length;
  // A URL keeps one line and scrolls in its field, as an address bar does.
  const clipped = [...document.querySelectorAll("input:not([type=url], [inputmode=url])")].filter((f) => shown.has(f) && f.scrollWidth > f.clientWidth + 2).length;
  const past = [...document.querySelectorAll("main *")].filter((el) => shown.has(el) && el.getBoundingClientRect().right > edge + 1 && !el.closest("[data-slot=sidebar], table, pre, [class*=overflow-x]")).length;
  return {
    touch,
    sideways: document.documentElement.scrollWidth - edge,
    height: document.documentElement.scrollHeight,
    controls: controls.length,
    small: small.length,
    smallSample: [...new Set(small)].slice(0, 5),
    under12: under12.size,
    under12Sample: [...under12].slice(0, 4),
    fields: fields.length,
    smallFields,
    clippedInputs: clipped,
    past,
  };
}

const rows = [];
async function one(size, theme, screen, path) {
  const dir = outDir(`shots/matrix/${size}-${theme}`);
  const { page, context, problems } = await open(browser, origin, answersFor(path), { path, size: SIZES[size], theme });
  await loaded(page);
  await page.waitForTimeout(350);
  await shot(page, dir, screen, false);
  rows.push({ size, theme, screen, ...(await page.evaluate(measure)), problems: problems.slice(0, 2) });
  await context.close();
}

// Each size and theme: the routes, then (Part M1, U18) the Assistant's views by their addresses
// (Now is /admin/assistant, in ROUTES).
const screens = [
  ...ROUTES.filter((p) => p.includes(only)).map((path) => [name(path), path]),
  ...(only ? [] : VIEWS).map((view) => [`assistant-${view}`, `/admin/assistant?view=${view}`]),
];
const runs = MATRIX.flatMap(([size, theme]) => screens.map((screen) => [size, theme, ...screen]));
try {
  await inTurn(runs, (args) => one(...args));
} finally {
  await browser.close();
  server.kill();
  writeFileSync(join(SPECS, "matrix.json"), JSON.stringify(rows, null, 1));
}
for (const [size, theme] of MATRIX) {
  const r = rows.filter((x) => x.size === size && x.theme === theme);
  const touch = r.some((x) => x.touch);
  console.log(`\n# ${size} ${theme}${touch ? " (touch)" : ""}: ${r.length} screens; sideways>0: ${r.filter((x) => x.sideways > 0).length}; console problems: ${r.filter((x) => x.problems.length).length}`);
  for (const x of r) {
    if (x.sideways > 0 || x.past > 0 || x.clippedInputs > 0) {
      console.log(`  ${x.screen}: sideways ${x.sideways}, past ${x.past}, clipped inputs ${x.clippedInputs}`);
    }
  }
  const short = r.filter((x) => x.small).sort((a, b) => b.small - a.small);
  const worst = short.slice(0, 4).map((x) => `${x.screen} ${x.small} (${x.smallSample[0] ?? ""})`);
  console.log(`  targets under ${touch ? 44 : 24}px: ${short.reduce((n, x) => n + x.small, 0)} in ${short.length} screens; worst: ${worst.join("; ")}`);
  const under12 = r.filter((x) => x.under12).map((x) => `${x.screen} ${x.under12}`);
  console.log(`  under 12px: ${under12.slice(0, 12).join(", ")}`);
  // With a mouse the admin's fields are 14px by design; 16px is the touch rule (iOS zooms into smaller ones).
  if (touch) {
    console.log(`  fields under 16px: ${r.reduce((n, x) => n + x.smallFields, 0)} of ${r.reduce((n, x) => n + x.fields, 0)}`);
  }
}
