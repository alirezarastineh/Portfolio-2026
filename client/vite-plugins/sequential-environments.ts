import type { Plugin, ViteBuilder } from "vite";

/**
 * Builds the app's environments one after the other instead of side by side.
 *
 * Analog's `buildApp` (`@analogjs/vite-plugin-nitro`) starts the client and
 * the server build together, and both go through one shared Angular compiler
 * (`sharedPlugins`). Whichever build finishes its module graph first releases
 * that compiler in its `buildEnd`; every TypeScript module the other build
 * reaches after that is passed through uncompiled and would need the JIT
 * compiler at runtime. On the 2-vCPU server the server build finishes last,
 * and 16 files went through that way (2026-09-29, stopped by `aot-only`); a
 * loaded laptop did the same in Phase 7. One after the other, each build
 * compiles for itself: about ten seconds more, and complete every time.
 */
export function sequentialEnvironments(): Plugin {
  return {
    name: "sequential-environments",
    apply: "build",
    config: {
      // After Analog's own `config`, which sets `builder.buildApp`.
      order: "post",
      handler(config) {
        const buildApp = config.builder?.buildApp;
        if (!buildApp) return;
        return { builder: { buildApp: (builder) => buildApp(inTurn(builder)) } };
      },
    },
  };
}

/** The builder, each `build` starting once the one asked for before it has ended. */
export function inTurn(builder: ViteBuilder): ViteBuilder {
  const build = builder.build.bind(builder);
  let previous: Promise<unknown> = Promise.resolve();
  builder.build = (environment) => {
    // A failed build fails the ones queued after it, without starting them.
    const next = previous.then(() => build(environment));
    previous = next;
    return next;
  };
  return builder;
}
