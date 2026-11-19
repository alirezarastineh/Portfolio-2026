import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAskQuestions, resetAskQuestions } from "./ask-questions";

const READ = { suggestions: { en: ["One?"], de: [] }, state: "resting", scorecard: false };
const OK = { ...READ, model: "not for the page" };

function respond(body: unknown, status = 200) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

async function expectCachedAfterFailure(failing: () => Promise<Response>): Promise<void> {
  vi.advanceTimersByTime(60_001);
  vi.stubGlobal("fetch", failing);
  expect(await getAskQuestions()).toEqual(READ);
}

describe("the admin's suggested questions on the server", () => {
  beforeEach(() => {
    resetAskQuestions();
    vi.useFakeTimers();
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://api.test");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads them once a minute", async () => {
    const fetcher = respond(OK);
    vi.stubGlobal("fetch", fetcher);
    expect(await getAskQuestions()).toEqual(READ);
    await getAskQuestions();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await getAskQuestions();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good ones when the API fails or answers nonsense", async () => {
    vi.stubGlobal("fetch", respond(OK));
    await getAskQuestions();
    await expectCachedAfterFailure(respond({}, 500));
    await expectCachedAfterFailure(respond({ suggestions: "no" }));
    await expectCachedAfterFailure(vi.fn(() => Promise.reject(new Error("down"))));
  });

  it("has none to give without an API, or when it never answered", async () => {
    vi.stubGlobal("fetch", respond({}, 500));
    expect(await getAskQuestions()).toEqual({});
    resetAskQuestions();
    vi.stubEnv("API_INTERNAL_BASE_URL", "");
    expect(await getAskQuestions()).toEqual({});
  });
});
