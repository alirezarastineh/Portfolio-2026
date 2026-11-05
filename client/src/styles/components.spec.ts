import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * components.css is global, and Angular's scoping only raises a component's own rule above it: a
 * local `.field` still takes every property the shared `.field` sets and it does not. That put a
 * 56px minimum on the assistant's input, in production. So no component names a shared piece.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "./components.css"), "utf8");
const shared = [...new Set([...css.matchAll(/^\s*\.([a-z][a-z-]*)/gm)].map((match) => match[1]))];

describe("the shared pieces", () => {
  it("are found in the stylesheet", () => {
    expect(shared).toEqual(expect.arrayContaining(["btn", "control", "field", "disclosure"]));
  });

  it("share no name with a component's own styles", () => {
    const app = resolve(here, "../app");
    const clashes = readdirSync(app, { recursive: true, encoding: "utf8" })
      .filter(
        (file) => file.endsWith(".ts") && !file.endsWith(".spec.ts") && !file.includes("admin"),
      )
      .flatMap((file) => {
        const source = readFileSync(resolve(app, file), "utf8");
        return shared
          .filter((name) =>
            new RegExp(String.raw`^\s*\.${name}\b(?!-)[^;\n]*\{$`, "m").test(source),
          )
          .map((name) => `${file}: .${name}`);
      });
    expect(clashes).toEqual([]);
  });
});
