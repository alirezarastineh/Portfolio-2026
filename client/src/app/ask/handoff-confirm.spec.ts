import { describe, expect, it } from "vitest";

import { confirmHandoff } from "./handoff-confirm";

const noWait = async () => undefined;

function answers(...statuses: (number | "throw")[]) {
  const calls: number[] = [];
  const post = async () => {
    const status = statuses[Math.min(calls.length, statuses.length - 1)]!;
    calls.push(calls.length + 1);
    if (status === "throw") throw new Error("offline");
    return { status };
  };
  return { post, calls };
}

describe("confirming a hand-off", () => {
  it("tries again while the answer is not logged yet, then counts the yes", async () => {
    const { post, calls } = answers(404, 404, 200);
    expect(await confirmHandoff(post, { sleep: noWait })).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("gives up after a few tries, and at once on any other refusal or a network error", async () => {
    const missing = answers(404);
    expect(await confirmHandoff(missing.post, { attempts: 4, sleep: noWait })).toBe(false);
    expect(missing.calls).toHaveLength(4);

    const refused = answers(400);
    expect(await confirmHandoff(refused.post, { sleep: noWait })).toBe(false);
    expect(refused.calls).toHaveLength(1);

    const offline = answers("throw");
    expect(await confirmHandoff(offline.post, { sleep: noWait })).toBe(false);
    expect(offline.calls).toHaveLength(1);
  });
});
