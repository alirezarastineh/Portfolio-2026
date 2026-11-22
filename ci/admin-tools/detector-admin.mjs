// Impeccable's detector on the rendered admin. It cannot log in, so Playwright opens each screen with the API
// faked and the detector reads that tab over CDP, as detector-scan.mjs does for the public pages.
// Usage: node detector-admin.mjs <label> [path filter]   (a filter scans those screens alone and no Assistant view)
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { answersFor, realReview, ROUTES, VIEWS } from "./data.mjs";
import { chromium, fake, inTurn, loaded, REPO, SIZES, SPECS, startServer } from "./lib.mjs";

const label = process.argv[2] ?? "baseline";
const only = process.argv[3] ?? "";
const CDP = 9335;
const { server, origin } = await startServer(4201);
const browser = await chromium.launch({ channel: "chrome", args: [`--remote-debugging-port=${CDP}`] });
const THEMES = ["dark", "light"];
const WIDTHS = [SIZES.phone, SIZES.laptop];
const results = [];
// `?` and `=` (Experience's entry, `?edit=e0`) cannot stand in a Windows file name.
const name = (p) =>
  p.replace(/^\/admin\/?/, "").replaceAll("/", "-").replaceAll(/[?=]/g, "-") || "dashboard";

/** Screens that exist only after a click (plan 5, U16): the review, and a publication's changes in History. */
const DIALOGS = [
  { screen: "review", path: "/admin", answers: { "GET /admin/publish/review": realReview() }, open: async (page) => {
    await page.getByRole("banner").getByRole("button", { name: /^Publish/ }).click();
    await page.getByRole("dialog", { name: "Review and publish" }).getByRole("button", { name: "Publish", exact: true }).waitFor();
  } },
  // Part M1 (U18): the Playground is a panel, over any page.
  { screen: "playground", path: "/admin/assistant", answers: {}, open: async (page) => {
    await page.getByRole("button", { name: "Playground", exact: true }).click();
    await page.getByLabel("Question for the draft assistant").waitFor();
  } },
  { screen: "publications-changes", path: "/admin/publications", answers: {}, open: async (page) => {
    await page.getByRole("button", { name: "More actions for #11", exact: true }).click();
    await page.getByRole("menuitem", { name: "View changes" }).click();
    await page.getByRole("dialog", { name: "#11 against the live site" }).getByRole("heading", { level: 3 }).first().waitFor();
  } },
];

async function scan(theme, viewport, screen, path, dialog) {
  const context = await browser.newContext({ viewport, colorScheme: theme, reducedMotion: "reduce" });
  const page = await context.newPage();
  await fake(page, origin, { ...answersFor(path), ...dialog?.answers });
  await page.goto(`${origin}${path}`);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached", timeout: 30_000 });
  await loaded(page);
  if (dialog) {
    await dialog.open(page);
  } else {
    // Half a screen at a time, the height read again at each step: lazy sections grow the page.
    await page.evaluate(async () => {
      const scrollFrom = async (y) => {
        if (y >= document.documentElement.scrollHeight) {
          return;
        }
        scrollTo(0, y);
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        await scrollFrom(y + innerHeight / 2);
      };
      await scrollFrom(0);
      scrollTo(0, 0);
    });
  }
  await page.waitForTimeout(250);
  // The engine: CI's download (IMPECCABLE_BIN), else the PC's skill launcher.
  const run = spawnSync(process.env.IMPECCABLE_BIN ?? `${REPO}/.claude/skills/impeccable/scripts/impeccable.cmd`, ["detect", "--json", "--cdp", String(CDP), "--target", `${origin}${path}`], { cwd: REPO, encoding: "utf8", shell: true, timeout: 120_000 });
  let findings = [];
  let parseError = null;
  try {
    const j = JSON.parse(run.stdout);
    findings = Array.isArray(j) ? j : (j.findings ?? []);
  } catch {
    parseError = `${run.stdout.slice(0, 160)} ${run.stderr.slice(0, 160)}`;
    console.error(`unparsed ${theme} ${viewport.width} ${screen}: ${parseError}`);
  }
  results.push({ theme, width: viewport.width, screen, parseError, findings: findings.map((f) => ({ rule: f.antipattern ?? f.rule ?? f.id, severity: f.severity, advisory: f.advisory ?? false, snippet: (f.snippet ?? f.selector ?? f.element ?? "").toString().slice(0, 120) })) });
  // Written after every scan, so a run cut short keeps what it saw.
  writeFileSync(join(SPECS, `detector-${label}.json`), JSON.stringify(results, null, 1));
  await context.close();
}

// Each theme and width: the routes, the Assistant's views, then the dialogs, in that order.
const screens = [
  ...ROUTES.filter((p) => p.includes(only)).map((path) => [name(path), path]),
  ...(only ? [] : VIEWS).map((view) => [`assistant-${view}`, `/admin/assistant?view=${view}`]),
  ...DIALOGS.filter((d) => d.path.includes(only) || d.screen.includes(only)).map((dialog) => [
    dialog.screen,
    dialog.path,
    dialog,
  ]),
];
const scans = THEMES.flatMap((theme) =>
  WIDTHS.flatMap((viewport) => screens.map((screen) => [theme, viewport, ...screen])),
);
try {
  await inTurn(scans, (args) => scan(...args));
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(join(SPECS, `detector-${label}.json`), JSON.stringify(results, null, 1));
const byRule = {};
const byScreen = {};
for (const r of results) {
  for (const f of r.findings) {
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
    byScreen[r.screen] = (byScreen[r.screen] ?? 0) + 1;
  }
}
console.log(`scans ${results.length}, findings ${results.reduce((n, r) => n + r.findings.length, 0)}, unparsed ${results.filter((r) => r.parseError).length}`);
console.log(Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(Object.entries(byScreen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
