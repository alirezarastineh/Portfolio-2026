// What each Assistant view loads of its own (plan 5, U18: each at most 25 KB brotli): the scripts a view's address
// loads beyond what /admin/inbox loads, less the Assistant page's own chunk; and what the Playground panel loads on
// its first opening. Brotli sizes from the build's .br files. Usage: node view-chunks.mjs   (serves client/dist)
import { statSync } from "node:fs";
import { join } from "node:path";
import { answers, VIEWS } from "./data.mjs";
import { chromium, CLIENT, inTurn, loaded, open, startServer } from "./lib.mjs";

const ASSETS = join(CLIENT, "dist/analog/public/assets");
const BUDGET = 25;
const PAGE = "admin-assistant.page-";
const { server, origin } = await startServer(4203);
const browser = await chromium.launch({ channel: "chrome" });
const kb = (n) => +(n / 1000).toFixed(1);
const brotli = (file) => statSync(join(ASSETS, `${file}.br`), { throwIfNoEntry: false })?.size ?? 0;
const sum = (files) => kb(files.reduce((n, f) => n + brotli(f), 0));
const over = (size) => (size > BUDGET ? ` OVER ${BUDGET}` : "");

/** The script files loaded at `path`, or only those a click there (`then`) adds. */
async function scripts(path, then) {
  // Room for every chunk: the browser keeps 250 resource timings by default.
  const { page, context } = await open(browser, origin, answers(), {
    path,
    init: () => performance.setResourceTimingBufferSize(5000),
  });
  const names = () =>
    page.evaluate(() =>
      performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\.js(\?|$)/.test(n)).map((n) => n.split("/").pop().split("?")[0]),
    );
  await page.locator("[data-slot=sidebar-inset]").waitFor({ timeout: 20_000 });
  await loaded(page);
  await page.waitForTimeout(600);
  const before = await names();
  let out = before;
  if (then) {
    await then(page);
    await loaded(page);
    await page.waitForTimeout(600);
    const seen = new Set(before);
    const after = await names();
    out = after.filter((n) => !seen.has(n));
  }
  await context.close();
  return [...new Set(out)];
}

try {
  const base = new Set(await scripts("/admin/inbox"));
  await inTurn(["now", ...VIEWS], async (view) => {
    const all = await scripts(view === "now" ? "/admin/assistant" : `/admin/assistant?view=${view}`);
    const own = all.filter((f) => !base.has(f) && !f.startsWith(PAGE));
    const page = all.find((f) => f.startsWith(PAGE));
    console.log(`${view}: ${sum(own)} KB brotli in ${own.length} files${over(sum(own))}; the page's own chunk ${page ? sum([page]) : "?"}`);
    console.log(`  ${own.join(", ")}`);
  });
  const panel = await scripts("/admin/assistant", async (page) => {
    await page.getByRole("button", { name: "Playground", exact: true }).click();
    await page.getByLabel("Question for the draft assistant").waitFor();
  });
  console.log(`playground panel (first opening): ${sum(panel)} KB brotli in ${panel.length} files${over(sum(panel))}`);
  console.log(`  ${panel.join(", ")}`);
} finally {
  await browser.close();
  server.kill();
}
