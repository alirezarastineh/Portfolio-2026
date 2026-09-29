import { transformWithOxc } from "vite";
import { describe, expect, it } from "vitest";

import { aotOnly, decoratorLeft } from "./aot-only";

/** A service and a component as written. */
const SOURCE = [
  'import { Component, Injectable, inject } from "@angular/core";',
  "",
  "/** One per app: `@Injectable()` in root. */",
  '@Injectable({ providedIn: "root" })',
  "export class Api {}",
  "",
  '@Component({ selector: "app-x", template: "<p>x</p>" })',
  "export class X {",
  "  readonly api = inject(Api);",
  "}",
].join("\n");

/** The same compiled ahead of time, in the shape Angular's compiler emits. */
const COMPILED = [
  'import * as i0 from "@angular/core";',
  'import { Component, Injectable, inject } from "@angular/core";',
  "/** One per app: `@Injectable()` in root. */",
  "export class Api {",
  "  static ɵfac = function Api_Factory(t) { return new (t || Api)(); };",
  '  static ɵprov = i0.ɵɵdefineInjectable({ token: Api, factory: Api.ɵfac, providedIn: "root" });',
  "}",
  "(() => {",
  '  (typeof ngDevMode === "undefined" || ngDevMode) &&',
  '    i0.ɵsetClassMetadata(X, [{ type: Component, args: [{ selector: "app-x" }] }], null, null);',
  "})();",
].join("\n");

type Transform = (this: { error: (message: string) => never }, code: string, id: string) => void;

function transform(code: string, id: string): void {
  const hook = aotOnly().transform as unknown as Transform;
  hook.call(
    {
      error: (message) => {
        throw new Error(message);
      },
    },
    code,
    id,
  );
}

describe("decoratorLeft", () => {
  it("finds a decorator oxc lowered: what a file Analog did not compile becomes", async () => {
    const { code } = await transformWithOxc(SOURCE, "/src/app/x.ts", {
      lang: "ts",
      decorator: { legacy: true },
    });
    expect(decoratorLeft(code)).toMatch(/^_*decorate\(\[Injectable\($/);
  });

  it("finds one still as written, on its own line or after export", () => {
    expect(decoratorLeft(SOURCE)).toBe("@Injectable(");
    expect(decoratorLeft('export @Component({ selector: "app-x" }) class X {}')).toBe(
      "export @Component(",
    );
  });

  it("finds nothing in compiled code, nor in a comment that names a decorator", () => {
    expect(decoratorLeft(COMPILED)).toBeUndefined();
  });
});

describe("aotOnly", () => {
  it("stops the build on the app's own TypeScript", () => {
    expect(() => transform(SOURCE, "C:/app/src/app/x.ts?v=1")).toThrow(
      /^C:\/app\/src\/app\/x\.ts was not compiled ahead of time \(`@Injectable\(`/,
    );
  });

  it("lets compiled code, dependencies and other files through", () => {
    expect(() => transform(COMPILED, "C:/app/src/app/x.ts")).not.toThrow();
    expect(() => transform(SOURCE, "C:/app/node_modules/lib/x.ts")).not.toThrow();
    expect(() => transform(SOURCE, "C:/app/src/app/x.md")).not.toThrow();
  });
});
