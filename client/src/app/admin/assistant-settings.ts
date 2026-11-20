import type { Locale } from "../content/schema";
import type { AssistantSettings, AssistantSettingsInput, FencedFeature } from "./assistant-types";
import { usd } from "./now";
import {
  CAPPED,
  featureLabel,
  spendDraft,
  spendInput,
  SWITCHED,
  type SpendDraft,
} from "./spending";

/**
 * Settings' form (plan 5, U19): the draft as typed, what a save sends, and what a save puts live,
 * in words, for the question before it and for the audit log after it (the server's "key before →
 * after", `fenceChanges`). Pure, so the form and Trust share it.
 */

export interface SettingsDraft {
  enabled: boolean;
  budget: string;
  deepEnabled: boolean;
  publicScorecard: boolean;
  suggestions: Record<Locale, string>;
  systemCard: Record<Locale, string>;
  spend: SpendDraft;
}

export function toDraft(s: AssistantSettings): SettingsDraft {
  return {
    enabled: s.enabled,
    budget: s.dailyBudgetUsd === null ? "" : String(s.dailyBudgetUsd),
    deepEnabled: s.deepEnabled,
    // An API from before the scorecard sends nothing: it is not published.
    publicScorecard: s.publicScorecard === true,
    suggestions: { en: s.suggestedQuestions.en.join("\n"), de: s.suggestedQuestions.de.join("\n") },
    systemCard: { ...s.systemCard },
    spend: spendDraft(s),
  };
}

const suggestionLines = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)
    .slice(0, 6);

/** The draft as a save, or why it cannot be saved. */
export function settingsInput(
  d: SettingsDraft,
): { ok: true; value: AssistantSettingsInput } | { ok: false; error: string } {
  const budget = d.budget.trim() === "" ? null : Number(d.budget);
  if (budget !== null && !(budget >= 0.01 && budget <= 100)) {
    return { ok: false, error: "The budget must be between 0.01 and 100 USD, or empty" };
  }
  const spend = spendInput(d.spend);
  if (!spend.ok) {
    return spend;
  }
  return {
    ok: true,
    value: {
      enabled: d.enabled,
      dailyBudgetUsd: budget,
      deepEnabled: d.deepEnabled,
      publicScorecard: d.publicScorecard,
      suggestedQuestions: {
        en: suggestionLines(d.suggestions.en),
        de: suggestionLines(d.suggestions.de),
      },
      systemCard: { en: d.systemCard.en.trim(), de: d.systemCard.de.trim() },
      ...spend.value,
    },
  };
}

/** What each feature spends on, in Settings' order (`CAPPED`): its row's words. */
export const FEATURE_WORDS: Record<FencedFeature, string> = {
  match:
    "Visitors paste a role, a project or a problem on the match page, and the assistant checks it against the published work: two model calls, more only to repair. It spends inside the visitors' share, up to its cap. The nightly trust check closes it when its critic takes back more than a fifth of its rows; reinstate it on Now.",
  playground: "Your questions to the draft, from the Playground panel.",
  copilot:
    "Suggestions in the editors: translate, tighten, SEO, FAQ answers, alt text, image descriptions.",
  insights: "Analysing visitor questions, when you press it in Questions.",
  autoInsights:
    "Insights run by themselves when the nightly check sees more answers failing: once per rise, shown on Now until you mark them seen.",
  eval: "The eval questions against the draft, when you run them in Quality.",
  pairwise: "Two answerers on the same questions, when you compare them in Quality.",
  judge: "Scoring reviewed visitor answers, to see how far the judge agrees with you.",
  nightlyJudge:
    "Each night at 02:30 UTC, judges a sample of the day's visitor answers and every flagged one against what they read; an unfaithful one goes to the review queue.",
  embeddings:
    "The assistant's search finds synonyms and the other language: Gemini embeds the published content and each search. The deploy needs SERVER_AI_EMBEDDINGS as well.",
  agent:
    "The content agent's runs, the journal's replays and the FAQ proposals drafted from an insight topic or a journal entry. None runs by itself.",
};

/** The switched features as a list of any fenced feature, so `includes` takes one (no cast). */
const SWITCHABLE: readonly FencedFeature[] = SWITCHED;

export const hasSwitch = (feature: FencedFeature): boolean => SWITCHABLE.includes(feature);

const onOff = (value: unknown): string => (value === false ? "off" : "on");
const dollars = (value: unknown, none: string): string =>
  typeof value === "number" ? usd(value) : none;
const percent = (value: unknown): string =>
  typeof value === "number" ? `${Math.round(value * 100)} %` : "?";

/**
 * One saved setting's change in words, by the server's key ("featureCaps.eval"), or null for a key
 * it does not know. `deployBudget` names the deploy's budget where the daily one is empty.
 */
export function changeWords(
  key: string,
  before: unknown,
  after: unknown,
  deployBudget = "the deploy's",
): string | null {
  const [head, feature] = key.split(".");
  const name = feature ? featureLabel(feature) : "";
  switch (head) {
    case "enabled": {
      return `Answer visitors: ${onOff(after)} (was ${onOff(before)})`;
    }
    case "deepEnabled": {
      return `Deep model: ${onOff(after)} (was ${onOff(before)})`;
    }
    case "publicScorecard": {
      return `Public scorecard: ${onOff(after)} (was ${onOff(before)})`;
    }
    case "dailyBudgetUsd": {
      return `Daily budget: ${dollars(after, deployBudget)} (was ${dollars(before, deployBudget)})`;
    }
    case "publicReserve": {
      return `Kept for visitors: ${percent(after)} (was ${percent(before)})`;
    }
    case "featureCaps": {
      return `Daily cap for ${name}: ${dollars(after, "none")} (was ${dollars(before, "none")})`;
    }
    case "featureSwitches": {
      return `${name}: ${onOff(after)} (was ${onOff(before)})`;
    }
    default: {
      return null;
    }
  }
}

const LANGUAGES: Record<Locale, string> = { en: "English", de: "German" };

/**
 * What a save of `draft` puts live, a line each, against what is saved; empty when nothing would
 * change (a space typed and taken out). Both must be valid (`settingsInput`).
 */
export function liveChanges(
  saved: SettingsDraft,
  draft: SettingsDraft,
  deployBudgetUsd: number | null,
): string[] {
  const before = settingsInput(saved);
  const after = settingsInput(draft);
  if (!before.ok || !after.ok) {
    return [];
  }
  const was = before.value;
  const now = after.value;
  const deployBudget =
    deployBudgetUsd === null ? "the deploy's" : `the deploy's ${usd(deployBudgetUsd)}`;
  const pairs: [string, unknown, unknown][] = [
    ["enabled", was.enabled, now.enabled],
    ["deepEnabled", was.deepEnabled, now.deepEnabled],
    ["publicScorecard", was.publicScorecard, now.publicScorecard],
    ["dailyBudgetUsd", was.dailyBudgetUsd, now.dailyBudgetUsd],
    ["publicReserve", was.publicReserve, now.publicReserve],
    ...CAPPED.map((f): [string, unknown, unknown] => [
      `featureCaps.${f}`,
      was.featureCaps[f],
      now.featureCaps[f],
    ]),
    ...SWITCHED.map((f): [string, unknown, unknown] => [
      `featureSwitches.${f}`,
      was.featureSwitches[f],
      now.featureSwitches[f],
    ]),
  ];
  const lines = pairs
    .filter(([, a, b]) => a !== b)
    .map(([key, a, b]) => changeWords(key, a, b, deployBudget) ?? key);
  for (const locale of ["en", "de"] as const) {
    if (was.suggestedQuestions[locale].join("\n") !== now.suggestedQuestions[locale].join("\n")) {
      lines.push(`Suggested questions in ${LANGUAGES[locale]}: changed`);
    }
    if (was.systemCard[locale] !== now.systemCard[locale]) {
      lines.push(`How this assistant works in ${LANGUAGES[locale]}: changed`);
    }
  }
  return lines;
}
