import { afterEach, describe, expect, it, vi } from "vitest";

import { INTERACTIVE_ATTRIBUTE, markWhenInteractive, nextIdle } from "./app-interactive";

describe("markWhenInteractive", () => {
  afterEach(() => document.documentElement.removeAttribute(INTERACTIVE_ATTRIBUTE));

  it("marks the page once it is stable, idle, and stable again", async () => {
    const steps: string[] = [];
    const appRef = {
      whenStable: vi.fn(async () => {
        steps.push("stable");
      }),
    };
    const idle = vi.fn(async () => {
      steps.push("idle");
    });

    await markWhenInteractive(appRef, document, idle);

    expect(steps).toEqual(["stable", "idle", "stable"]);
    expect(document.documentElement.hasAttribute(INTERACTIVE_ATTRIBUTE)).toBe(true);
  });

  it("does not mark the page while the idle-hydrated blocks are still loading", async () => {
    let finishLoading!: () => void;
    const loading = new Promise<void>((resolve) => (finishLoading = resolve));
    const whenStable = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(loading);

    const marked = markWhenInteractive({ whenStable }, document, async () => undefined);
    await vi.waitFor(() => expect(whenStable).toHaveBeenCalledTimes(2));
    expect(document.documentElement.hasAttribute(INTERACTIVE_ATTRIBUTE)).toBe(false);

    finishLoading();
    await marked;
    expect(document.documentElement.hasAttribute(INTERACTIVE_ATTRIBUTE)).toBe(true);
  });
});

describe("nextIdle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("waits for an idle callback where the browser has them", async () => {
    const requestIdleCallback = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);

    await nextIdle();

    expect(requestIdleCallback).toHaveBeenCalledOnce();
  });

  it("falls back to a task where it has none (Safari)", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    await expect(nextIdle()).resolves.toBeUndefined();
  });
});
