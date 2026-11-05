import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./copy-text";

describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says copied once the clipboard has the text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("hello")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("says failed when the browser refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(copyText("hello")).resolves.toBe("failed");
  });

  it("says failed where there is no clipboard at all, as on an insecure page", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyText("hello")).resolves.toBe("failed");
  });
});
