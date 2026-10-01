import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../../test/ask-fixtures.js";
import { productionJudging } from "./production-cli.js";

const judgeIds = (judging: ReturnType<typeof productionJudging>) =>
  judging.chain("judge").map((e) => e.id);

describe("the production suite's judge", () => {
  const base = fixtureConfig();
  const withOpenRouter = { ...base, openrouter: { ...base.openrouter, apiKey: "test-key" } };

  it("is a model that already answers visitors, whatever SERVER_AI_JUDGE_MODELS lists first", () => {
    const judging = productionJudging(
      { ...withOpenRouter, judgeModels: ["vendor/judge:free", "gemini-3.5-flash-lite"] },
      true,
    );
    expect(judging.judge).toBe(true);
    expect(judgeIds(judging)).toEqual(["gemini-3.5-flash-lite"]);
    expect(judging.label).toBe("judged by gemini-3.5-flash-lite");
  });

  it("is none with --no-judge, or when no listed judge answers visitors", () => {
    expect(productionJudging(base, false)).toMatchObject({
      judge: false,
      label: "without a judge",
    });
    const outsider = productionJudging(
      { ...withOpenRouter, judgeModels: ["vendor/judge:free"] },
      true,
    );
    expect(outsider.judge).toBe(false);
    expect(judgeIds(outsider)).toEqual([]);
  });
});
