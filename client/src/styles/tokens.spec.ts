import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { THEME_COLOR } from "../app/services/theme.service";
import { OG_COLOR } from "../server/utils/og";

/*
 * Some places cannot read the tokens and hold copies instead: the social cards
 * (Satori takes no CSS variables), the browser's theme-color and the web app
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

/** A token as the copies write it: `#rrggbb`, or `rgba(r, g, b, a)` when it has an alpha. */
function token(theme: Theme, name: string): string {
  const match = new RegExp(
    String.raw`--${name}:\s*(?:(#[0-9a-f]{6})|rgb\((\d+) (\d+) (\d+) / (\d+)%\));`,
  ).exec(block(theme));
  if (!match) throw new Error(`no colour for --${name} in the ${theme} theme`);
  const [, hex, r, g, b, alpha] = match;
  return hex ?? `rgba(${r}, ${g}, ${b}, ${Number(alpha) / 100})`;
}

describe("the tokens' copies", () => {
  it("draw the social cards in the dark theme's colours", () => {
    expect(OG_COLOR).toMatchObject({
      background: token("dark", "background"),
      card: token("dark", "card"),
      foreground: token("dark", "foreground"),
      mutedForeground: token("dark", "muted-foreground"),
      borderStrong: token("dark", "border-strong"),
      orange: token("dark", "signal"),
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

describe("the palette", () => {
  it("has no indigo left, and no colour the build must write a fallback for", () => {
    expect(tokens).not.toMatch(/indigo|oklch\(/);
  });
});
