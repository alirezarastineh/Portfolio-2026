import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Every pair a palette promises, computed from its stylesheet (WCAG 2): the
 * site's (tokens.css) and the admin's own (admin-theme.css). A token that
 * drifts below its target fails here, in the theme where it does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

type Theme = "dark" | "light";
type Rgb = [number, number, number];
/** A stylesheet's declarations per theme: the light block overrides the dark one. */
type Palette = Record<Theme, string>;

function palette(css: string, lightBlock: string): Palette {
  const start = css.indexOf(lightBlock);
  if (start === -1) throw new Error(`no ${lightBlock}`);
  return { dark: css.slice(0, start), light: css.slice(start) };
}

const site = palette(read("./tokens.css"), ':root[data-theme="light"] {');
const admin = palette(read("./admin-theme.css"), ':root:root[data-theme="light"]');

function raw(from: Palette, theme: Theme, name: string): string {
  const pattern = new RegExp(String.raw`--${name}:\s*([^;]+);`);
  const value = pattern.exec(from[theme]) ?? pattern.exec(from.dark);
  if (!value?.[1]) throw new Error(`no --${name}`);
  return value[1];
}

/** A token as an opaque colour; one with an alpha, over `under`. */
function colour(from: Palette, theme: Theme, name: string, under?: Rgb): Rgb {
  const value = raw(from, theme, name);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(value);
  if (hex) return hex.slice(1).map((part) => Number.parseInt(part, 16)) as Rgb;

  const rgba = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value);
  if (!rgba || !under) throw new Error(`cannot read --${name}: ${value}`);
  return over([1, 2, 3].map((i) => Number(rgba[i])) as Rgb, Number(rgba[4]) / 100, under);
}

/** `top` at `alpha` over `under`: what Tailwind's `bg-x/10` paints on a surface. */
function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  return top.map((channel, i) => channel * alpha + under[i]! * (1 - alpha)) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

const AAA = 7;
const AA = 4.5;
const GRAPHIC = 3;

describe.each([
  ["the site's palette", site],
  ["the admin's palette", admin],
] as const)("%s", (_, from) => {
  const on = (theme: Theme, name: string, surface = "background"): number => {
    const under = colour(from, theme, surface);
    return ratio(colour(from, theme, name, under), under);
  };

  describe.each([
    ["dark", { foreground: 17.9, muted: 10.2, faint: 6.2, text: 9.0, signal: 6.4, edge: 3.9 }],
    ["light", { foreground: 19.8, muted: 8.8, faint: 5.4, text: 5.8, signal: 3.3, edge: 4.0 }],
  ] as const)("%s theme, on the page", (theme, expected) => {
    it("keeps the promised values", () => {
      expect(on(theme, "foreground")).toBeCloseTo(expected.foreground, 1);
      expect(on(theme, "muted-foreground")).toBeCloseTo(expected.muted, 1);
      expect(on(theme, "faint-foreground")).toBeCloseTo(expected.faint, 1);
      expect(on(theme, "accent-orange")).toBeCloseTo(expected.text, 1);
      expect(on(theme, "signal")).toBeCloseTo(expected.signal, 1);
      expect(on(theme, "input-line")).toBeCloseTo(expected.edge, 1);
    });
  });

  describe.each(["dark", "light"] as const)("%s theme, on every surface", (theme) => {
    it.each(["background", "card", "surface-2"])("reads as text on %s", (surface) => {
      expect(on(theme, "foreground", surface)).toBeGreaterThanOrEqual(AAA);
      expect(on(theme, "muted-foreground", surface)).toBeGreaterThanOrEqual(AAA);
      for (const name of [
        "faint-foreground",
        "accent-orange",
        "available",
        "destructive",
        "data-2",
      ]) {
        expect(on(theme, name, surface), name).toBeGreaterThanOrEqual(AA);
      }
    });

    it.each(["background", "card", "surface-2"])("shows a field's edge on %s", (surface) => {
      expect(on(theme, "input-line", surface)).toBeGreaterThanOrEqual(GRAPHIC);
    });

    it("keeps the signal a graphic: visible on the page, too faint to be text in light", () => {
      expect(on(theme, "signal")).toBeGreaterThanOrEqual(GRAPHIC);
      expect(on(theme, "signal", "card")).toBeGreaterThanOrEqual(GRAPHIC);
    });

    it("puts black on the orange fill, never white", () => {
      const fill = colour(from, theme, "signal");
      const text = colour(from, theme, "signal-foreground");
      expect(ratio(text, fill)).toBeGreaterThanOrEqual(AA);
      expect(ratio(text, fill)).toBeCloseTo(6.4, 1);
      expect(ratio([255, 255, 255], fill)).toBeLessThan(AA);
    });
  });

  it("knows the two pairs that need care", () => {
    // Why the signal never sits on surface-2 in light.
    expect(on("light", "signal", "surface-2")).toBeLessThan(GRAPHIC);
    // Why dark's raised surfaces always carry a border.
    expect(on("dark", "card")).toBeLessThan(1.1);
  });
});

/*
 * The admin's own pairs: what axe and the detector cannot measure (the change
 * trace is a pseudo-element), and the two they found failing in light.
 */
describe("the admin's pairs", () => {
  describe.each(["dark", "light"] as const)("%s theme", (theme) => {
    const page = colour(admin, theme, "background");

    it("draws the change trace at 3:1 on the page: unsaved in the signal, in draft in the field's edge", () => {
      expect(ratio(colour(admin, theme, "signal"), page)).toBeGreaterThanOrEqual(GRAPHIC);
      expect(ratio(colour(admin, theme, "input-line", page), page)).toBeGreaterThanOrEqual(GRAPHIC);
    });

    it("draws the trace in admin.css with those two tokens, as the page shows it", () => {
      const css = read("../admin.css");
      const token = (selector: string) =>
        new RegExp(String.raw`${selector} \{[^}]*?background-color: var\(--([\w-]+)\);`).exec(
          css,
        )?.[1];
      const draft = token(String.raw`\.change-trace::before`);
      const unsaved = token(String.raw`\.change-trace\[data-change="unsaved"\]::before`);
      expect([draft, unsaved]).toEqual(["input-line", "signal"]);
      for (const name of [draft!, unsaved!]) {
        expect(ratio(colour(admin, theme, name, page), page), name).toBeGreaterThanOrEqual(GRAPHIC);
      }
    });

    it.each(["background", "card"])(
      "reads a destructive badge on its own tint, on %s",
      (surface) => {
        // Spartan's badge: `bg-destructive/10`, and `/20` in dark.
        const red = colour(admin, theme, "destructive");
        const tint = over(red, theme === "dark" ? 0.2 : 0.1, colour(admin, theme, surface));
        expect(ratio(red, tint)).toBeGreaterThanOrEqual(AA);
      },
    );

    it("reads the rich text's code block: its surface is a token, under the page's text", () => {
      const editor = read("../app/admin/components/rich-text.component.ts");
      const block = /\.admin-prose pre \{[^}]*?background: ([^;]+);/.exec(editor)?.[1];
      const token = /^var\(--([\w-]+)\)$/.exec(block ?? "")?.[1];
      expect(token, `the code block's background, ${block}, follows the theme`).toBeDefined();
      const surface = colour(admin, theme, token!);
      expect(ratio(colour(admin, theme, "foreground"), surface)).toBeGreaterThanOrEqual(AA);
    });
  });
});
