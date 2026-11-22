// Names every visible one-line input whose text runs past it (the matrix counts them as `clippedInputs`).
// Usage: node clipped.mjs [path filter]   (laptop dark and phone dark; client/dist as built)
import { answersFor, ROUTES, VIEWS } from "./data.mjs";
import { chromium, inTurn, loaded, open, SIZES, startServer } from "./lib.mjs";

const only = process.argv[2] ?? "";
// Part M1 (U18): the Assistant's views by their addresses too.
const paths = [...ROUTES, ...VIEWS.map((v) => `/admin/assistant?view=${v}`)].filter((p) =>
  p.includes(only),
);
const runs = [
  ["laptop", SIZES.laptop],
  ["phone", SIZES.phone],
].flatMap(([name, size]) => paths.map((path) => ({ name, size, path })));
const { server, origin } = await startServer(4209);
const browser = await chromium.launch({ channel: "chrome" });
try {
  await inTurn(runs, async ({ name, size, path }) => {
    const { page, context } = await open(browser, origin, answersFor(path), { theme: "dark", size, path });
    await loaded(page);
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll("input")]
        .filter((f) => {
          const r = f.getBoundingClientRect();
          const shown = r.width > 0 && r.height > 0 && getComputedStyle(f).visibility !== "hidden";
          return shown && f.scrollWidth > f.clientWidth + 2;
        })
        .map((f) => {
          const label = f.id || f.getAttribute("aria-label") || f.name || "?";
          return `${label} (${f.clientWidth}px, ${f.value.length} chars)`;
        }),
    );
    const detail = cut.length ? `\n  ${cut.join("\n  ")}` : "";
    console.log(`${name} ${path}: ${cut.length}${detail}`);
    await context.close();
  });
} finally {
  await browser.close();
  server.kill();
}
