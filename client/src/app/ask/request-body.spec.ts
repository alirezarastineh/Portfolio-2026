import { describe, expect, it } from "vitest";

import type { AskMessage } from "./ask-types";
import { pagePath, requestBody } from "./request-body";
import { forRequest } from "./sent-messages";

const MESSAGES: AskMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "What was the hardest part here?" }] },
];

const input = (over: Partial<Parameters<typeof requestBody>[0]> = {}) => ({
  sessionId: "tab-session-0000000001",
  locale: "en" as const,
  deep: false,
  turnstileToken: "",
  url: "/en/work/atlas",
  messages: MESSAGES,
  ...over,
});

describe("pagePath (visitor plan V8)", () => {
  it("is the router's URL without its query or hash", () => {
    expect(pagePath("/en/work/atlas")).toBe("/en/work/atlas");
    expect(pagePath("/en/writing/evals?tag=ai")).toBe("/en/writing/evals");
    expect(pagePath("/de/work/atlas#architektur")).toBe("/de/work/atlas");
    expect(pagePath("/en#projects")).toBe("/en");
  });

  it("is nothing for what is not a path, or longer than the server takes", () => {
    expect(pagePath("")).toBeNull();
    expect(pagePath("?x=1")).toBeNull();
    expect(pagePath("https://example.com/en")).toBeNull();
    expect(pagePath(`/en/writing/${"a".repeat(148)}`)).toHaveLength(160);
    expect(pagePath(`/en/writing/${"a".repeat(149)}`)).toBeNull();
  });
});

describe("requestBody", () => {
  it("carries the page with the question, and the conversation as the terminal sends it", () => {
    expect(requestBody(input())).toEqual({
      sessionId: "tab-session-0000000001",
      locale: "en",
      page: "/en/work/atlas",
      messages: forRequest(MESSAGES),
    });
  });

  it("adds deep and Turnstile's token only when they apply, and no page without a path", () => {
    const body = requestBody(input({ deep: true, turnstileToken: "token", url: "" }));
    expect(body).toMatchObject({ deep: true, turnstileToken: "token" });
    expect(body).not.toHaveProperty("page");
    expect(requestBody(input())).not.toHaveProperty("deep");
    expect(requestBody(input())).not.toHaveProperty("turnstileToken");
  });
});
