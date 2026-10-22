import { describe, expect, it } from "vitest";

import { LEVEL_STORAGE_KEY } from "./ask-level";
import { clearDeviceKeys, DEVICE_KEYS, forgetBody, forgetConversation } from "./forget";

/** `forget` in the browser (visitor plan V14): the device's keys, the request, its outcome. */

function storage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("forget in the browser (visitor plan V14)", () => {
  it("clears what the terminal kept on this device, and nothing else", () => {
    const kept = storage({ [LEVEL_STORAGE_KEY]: "plain", theme: "dark" });
    clearDeviceKeys(kept);
    expect([...kept.data.keys()]).toEqual(["theme"]);
    expect(DEVICE_KEYS).toEqual(["ask:level"]);
    // Blocked storage, or none: nothing to clear, nothing thrown.
    expect(() =>
      clearDeviceKeys({
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
    expect(() => clearDeviceKeys(null)).not.toThrow();
  });

  it("asks for this session and the tab's earlier ones, the newest ten, each once", () => {
    expect(forgetBody("now-session-0000000001", [])).toEqual({
      sessionId: "now-session-0000000001",
    });
    const earlier = Array.from(
      { length: 12 },
      (_, i) => `earlier-session-${String(i).padStart(6, "0")}`,
    );
    const body = forgetBody("now-session-0000000001", [...earlier, "now-session-0000000001"]);
    expect(body.earlier).toEqual(earlier.slice(2));
  });

  it("reads how many answers the log deleted, or why it could not", async () => {
    const respond = (status: number, body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    expect(await forgetConversation(() => respond(200, { ok: true, deleted: 3 }))).toEqual({
      ok: true,
      deleted: 3,
    });
    expect(await forgetConversation(() => respond(429, { retryAfter: 30 }))).toEqual({
      ok: false,
      retryAfter: 30,
    });
    expect(await forgetConversation(() => respond(500, {}))).toEqual({
      ok: false,
      retryAfter: null,
    });
    expect(await forgetConversation(() => respond(200, { ok: true }))).toEqual({
      ok: false,
      retryAfter: null,
    });
    expect(await forgetConversation(() => Promise.reject(new TypeError("offline")))).toEqual({
      ok: false,
      retryAfter: null,
    });
  });
});
