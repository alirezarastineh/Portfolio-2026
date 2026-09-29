import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { THEME_COLOR } from "../app/services/theme.service";
import { OG_COLOR } from "../server/utils/og";

/*
 * Some places cannot read the tokens and hold them in sRGB instead: the social
 * cards (Satori takes no oklch), the browser's theme-color and the web app
 * manifest. These tests keep each copy equal to what tokens.css says, so a
 * token change that forgets one fails here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");
const tokens = read("./tokens.css");

type Theme = "dark" | "light";

/** A theme's declarations: `:root` holds the dark theme, `[data-theme="light"]` overrides it. */
function block(theme: Theme): string {
  const selector = theme === "dark" ? ":root {" : ':root[data-theme="light"] {';
  const start = tokens.indexOf(selector);
  return tokens.slice(start, tokens.indexOf("\n}", start));
}

/** OKLCh to 8-bit sRGB, clipped into the gamut as an sRGB screen shows it. */
function srgb(l: number, c: number, h: number): number[] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const [lc, mc, sc] = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map((v) => v ** 3) as [number, number, number];
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ].map((linear) => {
    const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  });
}

/** A token as the copies write it: `#rrggbb`, or `rgba(r, g, b, a)` when it has an alpha. */
function token(theme: Theme, name: string): string {
  const match = new RegExp(
    String.raw`--${name}:\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: / ([\d.]+)%)?\)`,
  ).exec(block(theme));
  if (!match) throw new Error(`no oklch value for --${name} in the ${theme} theme`);
  const [, l, c, h, alpha] = match;
  const rgb = srgb(Number(l), Number(c), Number(h));
  if (alpha !== undefined) return `rgba(${rgb.join(", ")}, ${Number(alpha) / 100})`;
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

describe("the tokens' sRGB copies", () => {
  it("draw the social cards in the dark theme's colours", () => {
    expect(OG_COLOR).toEqual({
      background: token("dark", "background"),
      card: token("dark", "card"),
      foreground: token("dark", "foreground"),
      mutedForeground: token("dark", "muted-foreground"),
      borderStrong: token("dark", "border-strong"),
      orange: token("dark", "accent-orange"),
      indigo: token("dark", "accent-indigo"),
    });
  });

  it("give the browser each theme's background", () => {
    expect(THEME_COLOR).toEqual({
      dark: token("dark", "background"),
      light: token("light", "background"),
    });
  });

  it("start index.html dark, as the server renders, and switch it to light before the paint", () => {
    const html = read("../../index.html");
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLOR.dark}" />`);
    const script = /<script id="theme-init">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(script).toContain(`"${THEME_COLOR.light}"`);
  });

  it("colour the installed app as the dark theme", () => {
    const manifest = JSON.parse(read("../../public/site.webmanifest")) as Record<string, string>;
    expect(manifest["theme_color"]).toBe(THEME_COLOR.dark);
    expect(manifest["background_color"]).toBe(THEME_COLOR.dark);
  });
});
