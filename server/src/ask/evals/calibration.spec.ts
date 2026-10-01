import { describe, expect, it } from "vitest";

import { calibrate, MIN_PAIRS } from "./calibration.js";

const pairs = (spec: [number, boolean][]) =>
  spec.map(([faithfulness, grounded]) => ({ faithfulness, grounded }));

describe("judge calibration", () => {
  it("agrees when faithful (≥ 0.8) matches the reviewers' grounded verdict", () => {
    const result = calibrate(
      pairs([
        [1, true],
        [0.8, true],
        [0.5, false],
        [0.9, false], // lenient: the judge passed what a reviewer failed
        [0.79, true], // strict
      ]),
    );
    expect(result).toEqual({
      pairs: 5,
      agree: 3,
      agreement: 0.6,
      calibrated: null,
      judgeLenient: 1,
      judgeStrict: 1,
    });
  });

  it("says nothing under ten pairs, then calibrated from 80 % agreement", () => {
    expect(calibrate([])).toMatchObject({ agreement: null, calibrated: null });
    const good = Array.from({ length: MIN_PAIRS - 2 }, () => [1, true] as [number, boolean]);
    expect(calibrate(pairs([...good, [0.2, true], [0.2, true]]))).toMatchObject({
      agreement: 0.8,
      calibrated: true,
    });
    expect(calibrate(pairs([...good, [0.2, true], [0.2, true], [0.2, true]]))).toMatchObject({
      calibrated: false,
    });
  });
});
