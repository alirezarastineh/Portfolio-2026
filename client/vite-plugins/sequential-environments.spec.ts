import type { BuildEnvironment, UserConfig, ViteBuilder } from "vite";
import { describe, expect, it } from "vitest";

import { inTurn, sequentialEnvironments } from "./sequential-environments";

/** A builder whose builds take `ms` each and log when they start and end. */
function fakeBuilder(ms: number, fail?: string) {
  const log: string[] = [];
  const builder = {
    async build(environment: { name: string }) {
      log.push(`start ${environment.name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end ${environment.name}`);
      if (environment.name === fail) throw new Error(`${fail} failed`);
      return {};
    },
  } as unknown as ViteBuilder;
  return { builder, log };
}

const env = (name: string) => ({ name }) as unknown as BuildEnvironment;

type ConfigHook = { handler: (config: UserConfig) => UserConfig | undefined };

describe("inTurn", () => {
  it("starts each build once the one before it has ended", async () => {
    const { builder, log } = fakeBuilder(20);
    const turns = inTurn(builder);
    // Analog's buildApp starts both at once and waits for both.
    await Promise.all([turns.build(env("client")), turns.build(env("ssr"))]);
    expect(log).toEqual(["start client", "end client", "start ssr", "end ssr"]);
  });

  it("does not start a build queued after one that failed", async () => {
    const { builder, log } = fakeBuilder(5, "client");
    const turns = inTurn(builder);
    await expect(
      Promise.all([turns.build(env("client")), turns.build(env("ssr"))]),
    ).rejects.toThrow("client failed");
    expect(log).toEqual(["start client", "end client"]);
  });
});

describe("sequentialEnvironments", () => {
  const hook = sequentialEnvironments().config as unknown as ConfigHook;

  it("runs after Analog's config and wraps its buildApp", async () => {
    expect((sequentialEnvironments().config as { order?: string }).order).toBe("post");
    const { builder, log } = fakeBuilder(10);
    const buildApp = async (b: ViteBuilder) => {
      await Promise.all([b.build(env("client")), b.build(env("ssr"))]);
    };
    const config = hook.handler({ builder: { sharedPlugins: true, buildApp } });
    await config?.builder?.buildApp?.(builder);
    expect(log).toEqual(["start client", "end client", "start ssr", "end ssr"]);
  });

  it("leaves a config without a buildApp alone", () => {
    expect(hook.handler({})).toBeUndefined();
  });
});
