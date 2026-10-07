/**
 * How far the judge can be trusted, measured against people: agreement
 * between the judge's faithfulness score (faithful at 0.8 and above, the
 * eval graders' line) and the reviewers' "grounded" verdict on the same
 * answers. Below 80 % agreement the admin shows the judge as uncalibrated;
 * under ten pairs there is not enough to say either way.
 */

/** The faithfulness at which the eval graders pass an answer. */
export const FAITHFUL_AT = 0.8;
/** The agreement at which the judge counts as calibrated. */
export const CALIBRATED_AT = 0.8;
/** Fewer pairs than this say nothing yet. */
export const MIN_PAIRS = 10;

/** A judge's verdict on a visitor answer, as `ai_messages.judge` stores it. */
export interface AnswerJudgment {
  v: 1;
  model: string;
  faithfulness: number;
  helpfulness: number;
  unsupported: string[];
  at: string;
  /** Which run judged it (plan phase 26); absent on older verdicts. */
  source?: "calibration" | "nightly";
  /** Why the nightly run picked it: the random sample, or flagged (not counted toward demotion). */
  pick?: NightlyPick;
}

export type NightlyPick = "sample" | "flagged";

export interface CalibrationPair {
  faithfulness: number;
  grounded: boolean;
}

export interface Calibration {
  pairs: number;
  agree: number;
  /** Null without any pair. */
  agreement: number | null;
  /** Null under `MIN_PAIRS` pairs. */
  calibrated: boolean | null;
  /** Disagreements: the judge passed what reviewers failed, and the reverse. */
  judgeLenient: number;
  judgeStrict: number;
}

export function calibrate(pairs: readonly CalibrationPair[]): Calibration {
  let agree = 0;
  let judgeLenient = 0;
  let judgeStrict = 0;
  for (const pair of pairs) {
    const faithful = pair.faithfulness >= FAITHFUL_AT;
    if (faithful === pair.grounded) agree++;
    else if (faithful) judgeLenient++;
    else judgeStrict++;
  }
  const agreement = pairs.length ? agree / pairs.length : null;
  return {
    pairs: pairs.length,
    agree,
    agreement,
    calibrated: pairs.length < MIN_PAIRS || agreement === null ? null : agreement >= CALIBRATED_AT,
    judgeLenient,
    judgeStrict,
  };
}
