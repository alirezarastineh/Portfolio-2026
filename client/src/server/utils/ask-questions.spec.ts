import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAskQuestions, resetAskQuestions } from "./ask-questions";

const OK = { suggestions: { en: ["One?"], de: [] }, state: "ok" };

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
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
    expect(await getAskQuestions()).toEqual(OK.suggestions);
    await getAskQuestions();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await getAskQuestions();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good ones when the API fails or answers nonsense", async () => {
    vi.stubGlobal("fetch", respond(OK));
    await getAskQuestions();
    for (const failing of [
      respond({}, 500),
      respond({ suggestions: "no" }),
      vi.fn(() => Promise.reject(new Error("down"))),
    ]) {
      vi.advanceTimersByTime(60_001);
      vi.stubGlobal("fetch", failing);
      expect(await getAskQuestions()).toEqual(OK.suggestions);
    }
  });

  it("has none to give without an API, or when it never answered", async () => {
    vi.stubGlobal("fetch", respond({}, 500));
    expect(await getAskQuestions()).toEqual({});
    resetAskQuestions();
    vi.stubEnv("API_INTERNAL_BASE_URL", "");
    expect(await getAskQuestions()).toEqual({});
  });
});
