// A keyboard walk through the admin: Tab from the top of each screen to the end, recording every focus stop.
// Flags a stop with no visible indicator, one covered by something fixed (WCAG 2.4.11), one outside the viewport,
// focus falling back to <body> early, and a stop that jumps backwards. Prints only flagged stops and a summary per
// screen. Usage: node keyboard-walk.mjs [dark|light] [390|1280] [path-filter]
import { answersFor, ROUTES, VIEWS } from "./data.mjs";
import { chromium, inTurn, loaded, open, startServer } from "./lib.mjs";

const theme = process.argv[2] ?? "dark";
const width = Number(process.argv[3] ?? 1280);
const filter = process.argv[4] ?? "";
const height = width < 700 ? 844 : 900;
const MAX_STOPS = 140;
const { server, origin } = await startServer(4203);
const browser = await chromium.launch({ channel: "chrome" });

// Runs in the page, for the element that holds focus.
async function describeStop() {
  const el = document.activeElement;
  if (!el || el === document.body) {
    return { body: true };
  }
  const r = el.getBoundingClientRect();
  const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.getAttribute("placeholder") || "").replaceAll(/\s+/g, " ").trim().slice(0, 60);
  // What changes on the element, its pseudo-elements or its ancestors when it loses focus is the indicator.
  const chain = [el];
  for (let p = el.parentElement; p && chain.length < 5; p = p.parentElement) {
    chain.push(p);
  }
  const look = () =>
    chain
      .flatMap((node) =>
        [null, "::after", "::before"].map((pseudo) => {
          const s = getComputedStyle(node, pseudo);
          return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}|${s.boxShadow}|${s.borderColor}|${s.backgroundColor}|${s.opacity}|${s.scale}|${s.transform}`;
        }),
      )
      .join("\n");
  // The look one frame after a change, once the styles have caught up.
  const nextLook = () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => resolve(look()));
    });
  const focused = look();
  const own = getComputedStyle(el);
  const outlined = own.outlineStyle !== "none" && Number.parseFloat(own.outlineWidth) > 0;
  const outline = `${own.outlineStyle} ${own.outlineWidth} ${own.outlineColor}`;
  el.blur();
  const blurred = await nextLook();
  el.focus();
  await nextLook();
  let indicator = "";
  if (outlined) {
    indicator = "outline";
  } else if (focused !== blurred) {
    indicator = "frame/pseudo";
  }
  const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
  const cy = Math.min(Math.max(r.top + Math.min(r.height / 2, 12), 0), innerHeight - 1);
  const top = document.elementFromPoint(cx, cy);
  const covered = !!top && top !== el && !el.contains(top) && !top.contains(el);
  return {
    tag: el.tagName.toLowerCase(),
    name,
    y: Math.round(r.top + scrollY),
    x: Math.round(r.left),
    type: el.type ?? "",
    rail: !!el.closest("[data-slot=sidebar]"),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    h: Math.round(r.height),
    w: Math.round(r.width),
    outline: outlined ? outline : "",
    indicator,
    covered: covered ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 40)}` : "",
  };
}

const screens = [...ROUTES.map((path) => ({ name: path, path })), ...VIEWS.map((view) => ({ name: `assistant:${view}`, path: `/admin/assistant?view=${view}` }))].filter((s) => s.name.includes(filter));

let flaggedTotal = 0;
const outlines = {};

/** What is wrong with a stop, given the stops before it and the furthest point reached outside the rail. */
function issuesOf(stop, before, lastY) {
  const issues = [];
  if (!stop.indicator) {
    issues.push("no focus indicator");
  }
  if (stop.w === 0 || stop.h === 0) {
    issues.push("zero size");
  }
  if (stop.covered) {
    issues.push(`covered by ${stop.covered}`);
  }
  if (stop.bottom < 0 || stop.top > height) {
    issues.push("outside the viewport");
  }
  if (!stop.rail && !before.at(-1)?.rail && stop.y < lastY - 240 && before.length > 0) {
    issues.push(`jumps back ${lastY - stop.y}px`);
  }
  return issues;
}

/** Tabs on until focus falls back to <body>, a stop repeats or MAX_STOPS, one stop at a time. */
async function walk(page, stops, lastY) {
  if (stops.length >= MAX_STOPS) {
    return stops;
  }
  await page.keyboard.press("Tab");
  await page.waitForTimeout(40);
  const stop = await page.evaluate(describeStop);
  if (stop.body) {
    return stops;
  }
  stop.issues = issuesOf(stop, stops, lastY);
  if (stop.outline) {
    outlines[stop.outline] = (outlines[stop.outline] ?? 0) + 1;
  }
  stops.push(stop);
  const key = `${stop.tag}|${stop.name}|${stop.x}|${stop.y}`;
  // A date input has parts of its own: the same element several times is not a trap.
  if (!/date|time/.test(stop.type) && stops.filter((s) => `${s.tag}|${s.name}|${s.x}|${s.y}` === key).length > 1) {
    stop.issues.push("repeats (trap?)");
    return stops;
  }
  return walk(page, stops, stop.rail ? -Infinity : Math.max(lastY, stop.y));
}

try {
  await inTurn(screens, async (screen) => {
    const { page, context } = await open(browser, origin, answersFor(screen.path), { path: screen.path, size: { width, height }, theme });
    await loaded(page);
    const stops = await walk(page, [], -Infinity);
    const flagged = stops.filter((s) => s.issues.length);
    flaggedTotal += flagged.length;
    console.log(`${screen.name}: ${stops.length} stops, ${flagged.length} flagged`);
    for (const s of flagged.slice(0, 12)) {
      console.log(`  !! ${s.tag} "${s.name}" y=${s.y} ${s.indicator || "-"}  <-- ${s.issues.join("; ")}`);
    }
    if (flagged.length > 12) {
      console.log(`  … and ${flagged.length - 12} more`);
    }
    await context.close();
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(`\n${flaggedTotal} flagged stop(s) in ${screens.length} screens, ${theme} ${width}px`);
console.log("outlines seen:", JSON.stringify(outlines));
