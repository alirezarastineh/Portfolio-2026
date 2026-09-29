import type { Plugin } from "vite";

/** Angular's class decorators (the set `@analogjs/vite-plugin-angular` checks for). */
const DECORATORS = "Component|Directive|Pipe|Injectable|Service|NgModule";

/**
 * An Angular class decorator still in a module's code: lowered by oxc
 * (`X = _decorate([Component({…})], X)`, the tsconfig's
 * `experimentalDecorators`) or as written (`@Component(` opening a line, or
 * after `export`). A doc comment that mentions one does not match.
 */
const DECORATOR_LEFT = new RegExp(
  String.raw`\b_*decorate\(\s*\[\s*(?:[\w$]+\.)?(?:${DECORATORS})\(` +
    String.raw`|(?:^[ \t]*|\bexport[ \t]+(?:default[ \t]+)?)@(?:${DECORATORS})\(`,
  "m",
);

/** The Angular decorator left in a module's final code, if there is one. */
export function decoratorLeft(code: string): string | undefined {
  return DECORATOR_LEFT.exec(code)?.[0].trim();
}

/**
 * Fails the build when an Angular class reaches the bundle without being
 * compiled ahead of time.
 *
 * Analog passes a file through with its decorators, and only a warning, when
 * its compiler has no output for it: the file is not in the TypeScript
 * program, or the compiler was already released (the parallel builds that
 * `sequential-environments.ts` puts in turn). The class then needs the JIT
 * compiler at runtime, which a production bundle does not have: "JIT compiler
 * unavailable" in the server's log for every request that renders it, and in
 * the browser a page that never boots. This stops such a build instead of
 * shipping it.
 *
 * Runs after every other transform, on the app's own TypeScript: compiled,
 * it holds no decorators at all.
 */
export function aotOnly(): Plugin {
  return {
    name: "aot-only",
    apply: "build",
    enforce: "post",
    transform(code, id) {
      const file = id.split("?")[0]!;
      if (file.includes("/node_modules/") || !/\.[cm]?tsx?$/.test(file)) return;
      const left = decoratorLeft(code);
      if (left) {
        this.error(
          `${file} was not compiled ahead of time (\`${left}\` is still in its code), so it would need the JIT compiler at runtime. Check that the file is in tsconfig.app.json's program, and that the sequential-environments plugin is in vite.config.ts.`,
        );
      }
    },
  };
}
