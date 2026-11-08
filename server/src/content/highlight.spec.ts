import { describe, expect, it } from "vitest";

import { codeStylesheet, highlightCode } from "./highlight.js";

/** Each class the stylesheet maps, with the token it gets. */
async function roles(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rules = (await codeStylesheet()).matchAll(/([^{}]+)\{\s*color: var\((--[a-z0-9-]+)\);/g);
  for (const [, selectors, token] of rules) {
    for (const [cls] of selectors!.matchAll(/sh[dl]-[0-9a-f]+/g)) map.set(cls, token!);
  }
  return map;
}

describe("codeStylesheet", () => {
  it("gives all 23 classes the site's colours, and none of its own", async () => {
    const map = await roles();
    expect(map.size).toBe(23);
    expect(new Set(map.values())).toEqual(
      new Set(["--accent-orange", "--data-2", "--foreground", "--faint-foreground"]),
    );
    expect(await codeStylesheet()).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    // The themes' purple.
    expect(map.get("shd-d2a8ff")).toBe("--foreground");
    expect(map.get("shl-8250df")).toBe("--foreground");
  });

  it("gives a token's two classes one colour, in either theme", async () => {
    const map = await roles();
    const samples: [string, string][] = [
      ["ts", 'const a: Thing = f("x", 1); // why\nexport class B extends C {}'],
      ["json", '{ "a": [1, true, null] }'],
      ["html", '<a href="/x" class="y">z</a><!-- c -->'],
      ["css", "a:hover { color: #fff; margin: 0 1px; }"],
      ["shellscript", 'echo "$HOME" | grep -v x # c'],
      ["diff", "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new"],
      ["python", 'def f(a: int) -> str:\n    return f"{a}"  # c'],
      ["sql", "select a, count(*) from t where b = 'x' group by a;"],
      ["yaml", "a: 1\nb: [x, 'y']  # c"],
      ["markdown", "# h\n\n- a *b* `c`\n\n> q"],
    ];
    for (const [lang, code] of samples) {
      const html = await highlightCode(code, lang);
      const pairs = [...html.matchAll(/class="(shd-[0-9a-f]+) (shl-[0-9a-f]+)/g)];
      expect(pairs.length, lang).toBeGreaterThan(0);
      for (const [, dark, light] of pairs) {
        expect(map.get(dark!), `${lang}: ${dark}`).toBeDefined();
        expect(map.get(light!), `${lang}: ${dark} ${light}`).toBe(map.get(dark!));
      }
    }
  });
});
