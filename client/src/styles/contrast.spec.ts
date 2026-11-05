import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Every pair the palette promises, computed from tokens.css (WCAG 2): a token
 * that drifts below its target fails here, in the theme where it does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(resolve(here, "./tokens.css"), "utf8");

type Theme = "dark" | "light";
type Rgb = [number, number, number];

const lightStart = tokens.indexOf(':root[data-theme="light"] {');
const declarations = { dark: tokens.slice(0, lightStart), light: tokens.slice(lightStart) };

function raw(theme: Theme, name: string): string {
  const pattern = new RegExp(String.raw`--${name}:\s*([^;]+);`);
  const value = pattern.exec(declarations[theme]) ?? pattern.exec(declarations.dark);
  if (!value?.[1]) throw new Error(`no --${name}`);
  return value[1];
}

/** A token as an opaque colour; one with an alpha, over `under`. */
function colour(theme: Theme, name: string, under?: Rgb): Rgb {
  const value = raw(theme, name);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(value);
  if (hex) return hex.slice(1).map((part) => Number.parseInt(part, 16)) as Rgb;

  const rgba = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value);
  if (!rgba || !under) throw new Error(`cannot read --${name}: ${value}`);
  const alpha = Number(rgba[4]) / 100;
  return [1, 2, 3].map((i) => Number(rgba[i]) * alpha + under[i - 1]! * (1 - alpha)) as Rgb;
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

const on = (theme: Theme, name: string, surface = "background"): number => {
  const under = colour(theme, surface);
  return ratio(colour(theme, name, under), under);
};

const AAA = 7;
const AA = 4.5;
const GRAPHIC = 3;

describe("the palette's contrast", () => {
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
      const fill = colour(theme, "signal");
      const text = colour(theme, "signal-foreground");
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
