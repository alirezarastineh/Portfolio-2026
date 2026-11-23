// Every screen at 320, 390, 820, 1024 (touch), 1280 and 1920 (mouse), dark and light: shots plus layout
// numbers (plan 5, U23: on touch, no target under 44px and no field under 16px). U24 adds 200% text and 400%
// zoom with a mouse (no sideways scroll, no text cut off, bars that leave the page room), forced colours in
// both themes (a current or selected item still differs from its neighbours, the trace keeps its line), and
// with a mouse WCAG 2.5.8's spacing test for the targets under 24px.
// Usage: node matrix.mjs [path filter]. Writes shots/matrix/<row>-<theme>/<screen>.png and matrix.json.
// A filter (a part of a path, `/admin/login`) measures those screens alone and no Assistant tab.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { answersFor, ROUTES, VIEWS } from "./data.mjs";

const only = process.argv[2] ?? "";
import { chromium, inTurn, loaded, open, outDir, shot, SIZES, SPECS, startServer } from "./lib.mjs";

const centre = ([left, top, width, height]) => [left + width / 2, top + height / 2];

/**
 * WCAG 2.5.8's spacing exception, with a mouse: an undersized target passes when a 24px circle on its box's
 * centre meets no other target and no other undersized target's circle. Boxes are [left, top, width, height];
 * returns the places in `undersized` of those failing.
 */
function spacingFailures(boxes, undersized) {
  return undersized.flatMap((index, place) => {
    const [x, y] = centre(boxes[index]);
    const nearTarget = boxes.some(
      ([left, top, width, height], other) =>
        other !== index && Math.hypot(Math.max(left - x, 0, x - left - width), Math.max(top - y, 0, y - top - height)) < 12,
    );
    const nearCircle = undersized.some((other) => {
      const [ox, oy] = centre(boxes[other]);
      return other !== index && Math.hypot(x - ox, y - oy) < 24;
    });
    return nearTarget || nearCircle ? [place] : [];
  });
}
// 40px apart two 20px links pass; 20px apart their circles meet; a 20px link 10px from a button fails.
assert.deepEqual(spacingFailures([[0, 0, 20, 20], [40, 0, 20, 20]], [0, 1]), []);
assert.deepEqual(spacingFailures([[0, 0, 20, 20], [20, 0, 20, 20]], [0, 1]), [0, 1]);
assert.deepEqual(spacingFailures([[0, 0, 20, 20], [20, 0, 100, 40]], [0]), [0]);

const { server, origin } = await startServer(4200);
const browser = await chromium.launch({ channel: "chrome" });
// 200% text: Chrome's default font size doubled, as a reader's setting does, so the rem breakpoints move too.
const bigText = await chromium.launch({ channel: "chrome", args: ["--blink-settings=defaultFontSize=32"] });
// Each row: its name, its window, its themes, how the page opens. Text and zoom are about layout: one theme.
const ROWS = [
  ...["small", "phone", "tablet", "landscape", "laptop", "wide"].map((size) => [size, size, ["dark", "light"], {}]),
  ["text200", "laptop", ["dark"], { big: true }],
  ["zoom400", "zoom", ["dark"], { touch: false }],
  ["forced", "laptop", ["dark", "light"], { forced: true }],
];
const MATRIX = ROWS.flatMap(([row, size, themes, how]) => themes.map((theme) => [row, size, theme, how]));
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
  const undersized = [];
  for (const [index, el] of controls.entries()) {
    if (el.matches("input[type=checkbox], input[type=radio], [contenteditable=true], textarea")) {
      continue;
    }
    const size = tooSmall(el);
    if (size) {
      small.push(`${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 18)} ${size}`);
      undersized.push(index);
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
  const clipped = [...document.querySelectorAll("input:not([type=url], [inputmode=url])")].filter((f) => shown.has(f) && f.scrollWidth > f.clientWidth + 2);
  const past = [...document.querySelectorAll("main *")].filter((el) => shown.has(el) && el.getBoundingClientRect().right > edge + 1 && !el.closest("[data-slot=sidebar], table, pre, [class*=overflow-x]")).length;
  return {
    touch,
    sideways: document.documentElement.scrollWidth - edge,
    height: document.documentElement.scrollHeight,
    controls: controls.length,
    small: small.length,
    smallSample: [...new Set(small)].slice(0, 5),
    smallNames: small,
    boxes: controls.map((el) => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height];
    }),
    undersized,
    under12: under12.size,
    under12Sample: [...under12].slice(0, 4),
    fields: fields.length,
    smallFields,
    clippedInputs: clipped.length,
    clippedIds: clipped.slice(0, 3).map((f) => f.id),
    past,
  };
}

// Runs in the page at 200% text and 400% zoom: text a box cuts off (an ellipsis or a line clamp apart), and
// the bars that stay on screen as the page scrolls (fixed, or sticky once stuck, half the window wide or more).
function measureText() {
  const cut = [...document.body.querySelectorAll("*")].filter((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const hides = [s.overflowX, s.overflowY].some((v) => v === "hidden" || v === "clip");
    const over = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
    return hides && over && r.width > 1 && r.height > 1 && s.visibility !== "hidden" && el.tagName !== "MAIN" && !el.closest(".sr-only, [data-slot=sidebar]") && el.textContent.trim() !== "";
  });
  const ended = cut.filter((el) => getComputedStyle(el).textOverflow === "ellipsis" || getComputedStyle(el).webkitLineClamp !== "none");
  const lost = cut.filter((el) => !ended.includes(el));
  const doc = document.documentElement;
  const bars = [];
  if (doc.scrollHeight > innerHeight) {
    const back = scrollY;
    scrollTo({ top: Math.min(400, doc.scrollHeight - innerHeight), behavior: "instant" });
    const spans = [...document.body.querySelectorAll("*")]
      .filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position) && getComputedStyle(el).pointerEvents !== "none" && el.textContent.trim() !== "")
      .map((el) => [el, el.getBoundingClientRect()])
      .filter(([, r]) => r.width >= innerWidth / 2 && Math.min(r.bottom, innerHeight) > Math.max(r.top, 0))
      .sort(([, a], [, b]) => a.top - b.top);
    let reach = 0;
    for (const [el, r] of spans) {
      const height = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0, reach);
      if (height > 0) {
        const id = el.id ? `#${el.id}` : "";
        bars.push([`${el.tagName.toLowerCase()}${id}`, Math.round(height)]);
      }
      reach = Math.max(reach, Math.min(r.bottom, innerHeight));
    }
    scrollTo({ top: back, behavior: "instant" });
  }
  return {
    rootFont: Number.parseFloat(getComputedStyle(doc).fontSize),
    cut: lost.length,
    cutSample: lost.slice(0, 4).map((el) => el.textContent.trim().replaceAll(/\s+/g, " ").slice(0, 24)),
    ellipsis: ended.length,
    bars: bars.reduce((sum, [, height]) => sum + height, 0),
    barNames: bars.map(([tag, height]) => `${tag} ${height}`),
  };
}

// Runs in the page in forced colours, where fills and author colours give way to the system's: a current,
// selected or pressed item that looks like a neighbour of its kind there (its weight alone does not count),
// and a trace whose line does not keep a colour of its own.
function measureForced() {
  const state = "[aria-current]:not([aria-current=false]), [aria-selected=true], [aria-pressed=true]";
  const lost = [...document.querySelectorAll(state)].filter((el) => {
    if (el.getBoundingClientRect().width === 0) {
      return false;
    }
    let peer;
    for (let above = el.parentElement, up = 0; above && !peer && up < 3; above = above.parentElement, up += 1) {
      peer = [...above.querySelectorAll(el.tagName)].find(
        (x) => x !== el && !x.matches(state) && x.getAttribute("role") === el.getAttribute("role") && x.getBoundingClientRect().width > 0,
      );
    }
    const [mine, theirs] = [el, peer].map((node) =>
      node
        ? [null, "::before", "::after"]
            .map((pseudo) => {
              const s = getComputedStyle(node, pseudo);
              return [s.color, s.backgroundColor, s.borderTopStyle, s.borderTopColor, s.borderLeftStyle, s.borderLeftColor, s.borderBottomStyle, s.borderBottomColor, s.outlineStyle, s.textDecorationLine, pseudo ? s.content : ""].join();
            })
            .join("|")
        : "",
    );
    return peer !== undefined && mine === theirs;
  });
  const traces = [...document.querySelectorAll(".change-trace[data-change]")];
  return {
    stateLost: lost.length,
    stateSample: lost.slice(0, 4).map((el) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 18)}`),
    traces: traces.length,
    traceLost: traces.filter((el) => getComputedStyle(el, "::before").forcedColorAdjust !== "none").length,
  };
}

const rows = [];
async function one(row, size, theme, how, screen, path) {
  const dir = outDir(`shots/matrix/${row}-${theme}`);
  const { page, context, problems } = await open(how.big ? bigText : browser, origin, answersFor(path), { path, size: SIZES[size], theme, touch: how.touch, forced: how.forced === true });
  await loaded(page);
  await page.waitForTimeout(350);
  await shot(page, dir, screen, false);
  const { boxes, undersized, smallNames, ...numbers } = await page.evaluate(measure);
  const spacing = numbers.touch ? [] : spacingFailures(boxes, undersized).map((place) => smallNames[place]);
  const text = row === "text200" || row === "zoom400" ? await page.evaluate(measureText) : {};
  const forced = how.forced ? await page.evaluate(measureForced) : {};
  rows.push({ row, size, theme, screen, ...numbers, spacingFails: spacing.length, spacingSample: spacing.slice(0, 4), ...text, ...forced, problems: problems.slice(0, 2) });
  await context.close();
}

// Each row and theme: the routes, then (Part M1, U18) the Assistant's views by their addresses
// (Now is /admin/assistant, in ROUTES).
const screens = [
  ...ROUTES.filter((p) => p.includes(only)).map((path) => [name(path), path]),
  ...(only ? [] : VIEWS).map((view) => [`assistant-${view}`, `/admin/assistant?view=${view}`]),
];
const runs = MATRIX.flatMap(([row, size, theme, how]) => screens.map((screen) => [row, size, theme, how, ...screen]));
try {
  await inTurn(runs, (args) => one(...args));
} finally {
  await browser.close();
  await bigText.close();
  server.kill();
  writeFileSync(join(SPECS, "matrix.json"), JSON.stringify(rows, null, 1));
}

/** How many of `key` in `r`, in how many screens, with a few samples from `sample`. */
function tally(r, key, sample) {
  const hit = r.filter((x) => x[key] > 0);
  const total = hit.reduce((n, x) => n + x[key], 0);
  const seen = hit.flatMap((x) => (x[sample] ?? []).slice(0, 1).map((s) => `${x.screen}: ${s}`)).slice(0, 4);
  const samples = seen.length ? ` (${seen.join("; ")})` : "";
  return `${total} in ${hit.length} screens${samples}`;
}

for (const [row, , theme] of MATRIX) {
  const r = rows.filter((x) => x.row === row && x.theme === theme);
  const touch = r.some((x) => x.touch);
  console.log(`\n# ${row} ${theme}${touch ? " (touch)" : ""}: ${r.length} screens; sideways>0: ${r.filter((x) => x.sideways > 0).length}; console problems: ${r.filter((x) => x.problems.length).length}`);
  for (const x of r) {
    if (x.sideways > 0 || x.past > 0 || x.clippedInputs > 0) {
      console.log(`  ${x.screen}: sideways ${x.sideways}, past ${x.past}, clipped inputs ${x.clippedInputs} ${x.clippedIds.join(" ")}`);
    }
  }
  const short = r.filter((x) => x.small).sort((a, b) => b.small - a.small);
  const worst = short.slice(0, 4).map((x) => `${x.screen} ${x.small} (${x.smallSample[0] ?? ""})`);
  console.log(`  targets under ${touch ? 44 : 24}px: ${short.reduce((n, x) => n + x.small, 0)} in ${short.length} screens; worst: ${worst.join("; ")}`);
  if (!touch) {
    console.log(`  failing 2.5.8's spacing test: ${tally(r, "spacingFails", "spacingSample")}`);
  }
  const under12 = r.filter((x) => x.under12).map((x) => `${x.screen} ${x.under12}`);
  console.log(`  under 12px: ${under12.slice(0, 12).join(", ")}`);
  // With a mouse the admin's fields are 14px by design; 16px is the touch rule (iOS zooms into smaller ones).
  if (touch) {
    console.log(`  fields under 16px: ${r.reduce((n, x) => n + x.smallFields, 0)} of ${r.reduce((n, x) => n + x.fields, 0)}`);
  }
  if (row === "text200" || row === "zoom400") {
    console.log(`  root font ${r[0]?.rootFont}px; text cut off: ${tally(r, "cut", "cutSample")}; ellipsis or clamp: ${r.reduce((n, x) => n + x.ellipsis, 0)}`);
    const crowded = r.filter((x) => x.bars > SIZES[x.size].height / 2).map((x) => `${x.screen} ${x.bars} (${x.barNames.join(", ")})`);
    console.log(`  bars over half the window: ${crowded.length ? crowded.join("; ") : "none"}`);
  }
  if (row === "forced") {
    console.log(`  a state lost in forced colours: ${tally(r, "stateLost", "stateSample")}; traces ${r.reduce((n, x) => n + x.traces, 0)}, ${r.reduce((n, x) => n + x.traceLost, 0)} without their line`);
  }
}
