// Pixel-compares two directories of PNGs in Chrome: counts differing pixels
// (any channel off by more than 8) and lists the row bands they fall in.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, inTurn } from "./lib.mjs";

const [oldDir, newDir] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.setContent("<body></body>");

await inTurn(readdirSync(newDir).filter((f) => f.endsWith(".png")).sort(), async (f) => {
  const a = readFileSync(join(oldDir, f)).toString("base64");
  const b = readFileSync(join(newDir, f)).toString("base64");
  const res = await page.evaluate(
    async ([a, b]) => {
      const load = (src) =>
        new Promise((r) => {
          const img = new Image();
          img.onload = () => r(img);
          img.src = `data:image/png;base64,${src}`;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { size: `${ia.width}x${ia.height} → ${ib.width}x${ib.height}` };
      }
      const [da, db] = [ia, ib].map((img) => {
        const c = new OffscreenCanvas(img.width, img.height);
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      });
      let n = 0;
      const rows = new Set();
      let minX = Infinity;
      let maxX = -1;
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i] - db[i]) > 8 ||
          Math.abs(da[i + 1] - db[i + 1]) > 8 ||
          Math.abs(da[i + 2] - db[i + 2]) > 8
        ) {
          n++;
          const p = i / 4;
          rows.add(Math.floor(p / ia.width));
          minX = Math.min(minX, p % ia.width);
          maxX = Math.max(maxX, p % ia.width);
        }
      }
      // Merge rows into bands.
      const sorted = [...rows].sort((x, y) => x - y);
      const bands = [];
      for (const r of sorted) {
        const last = bands.at(-1);
        if (last && r - last[1] <= 4) {
          last[1] = r;
        } else {
          bands.push([r, r]);
        }
      }
      return { n, bands: bands.map(([s, e]) => `${s}-${e}`).join(" "), x: n ? `${minX}-${maxX}` : "" };
    },
    [a, b],
  );
  if (res.size || res.n) {
    console.log(f, JSON.stringify(res));
  }
});
await browser.close();
