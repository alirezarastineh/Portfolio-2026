import { asc, eq } from "drizzle-orm";

import type { DbExecutor } from "../content/build.js";
import { LOCALES, type Locale } from "../content/schema.js";
import { getDb } from "../db/client.js";
import { aiFaq, aiFaqTranslations, aiSettings } from "../db/schema.js";
import {
  DEFAULT_PUBLIC_RESERVE,
  FENCED_FEATURES,
  SWITCH_DEFAULTS,
  SWITCHED_FEATURES,
  type FencedFeature,
  type SwitchedFeature,
} from "./features.js";
import { PRIMARY_METRICS, type PrimaryMetric } from "./outcomes.js";

/**
 * The admin's side of the assistant: the settings row and the FAQ. Both are
 * read on every question, so they are held for a few seconds; the admin's
 * saves clear that at once (same process).
 */

export interface AiSettings {
  enabled: boolean;
  dailyBudgetUsd: number | null;
  deepEnabled: boolean;
  suggestedQuestions: Record<Locale, string[]>;
  systemCard: Record<Locale, string>;
  /** The outcome metric watched first (`outcomes.ts`), rotated when it goes flat. */
  primaryMetric: PrimaryMetric;
  /** The share of the daily budget kept for visitors (`features.ts`). */
  publicReserve: number;
  /** Each fenced feature's own daily cap in USD; null = only the reserve line. */
  featureCaps: Record<FencedFeature, number | null>;
  /** The admin's switch for each feature that has one. */
  featureSwitches: Record<SwitchedFeature, boolean>;
  updatedAt: string | null;
}

export interface FaqEntry {
  id: string;
  position: number;
  isVisible: boolean;
  translations: Partial<Record<Locale, { question: string; answer: string }>>;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: AiSettings = {
  enabled: true,
  dailyBudgetUsd: null,
  deepEnabled: true,
  suggestedQuestions: { en: [], de: [] },
  systemCard: { en: "", de: "" },
  primaryMetric: "helpfulRate",
  publicReserve: DEFAULT_PUBLIC_RESERVE,
  featureCaps: capsFrom({}),
  featureSwitches: switchesFrom({}),
  updatedAt: null,
};

const TTL_MS = 10_000;
let cache: { at: number; value: Promise<{ settings: AiSettings; faq: FaqEntry[] }> } | undefined;

export function invalidateAssistantCache(): void {
  cache = undefined;
}

/** The stored caps, each a positive number or null; a key no feature has is ignored. */
function capsFrom(stored: Partial<Record<string, unknown>>): Record<FencedFeature, number | null> {
  return Object.fromEntries(
    FENCED_FEATURES.map((f) => {
      const cap = stored[f];
      return [f, typeof cap === "number" && cap > 0 ? cap : null];
    }),
  ) as Record<FencedFeature, number | null>;
}

/** The stored switches over each feature's default. */
function switchesFrom(stored: Partial<Record<string, unknown>>): Record<SwitchedFeature, boolean> {
  return Object.fromEntries(
    SWITCHED_FEATURES.map((f) => {
      const on = stored[f];
      return [f, typeof on === "boolean" ? on : SWITCH_DEFAULTS[f]];
    }),
  ) as Record<SwitchedFeature, boolean>;
}

function perLocale<T>(value: unknown, fallback: T): Record<Locale, T> {
  const record = (value && typeof value === "object" ? value : {}) as Partial<Record<Locale, T>>;
  return Object.fromEntries(LOCALES.map((l) => [l, record[l] ?? fallback])) as Record<Locale, T>;
}

export async function readAiSettings(db: DbExecutor = getDb()): Promise<AiSettings> {
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.id, 1)).limit(1);
  if (!row) return DEFAULT_SETTINGS;
  return {
    enabled: row.enabled,
    dailyBudgetUsd: row.dailyBudgetUsd,
    deepEnabled: row.deepEnabled,
    suggestedQuestions: perLocale(row.suggestedQuestions, [] as string[]),
    systemCard: perLocale(row.systemCard, ""),
    primaryMetric: PRIMARY_METRICS.find((m) => m === row.primaryMetric) ?? "helpfulRate",
    publicReserve: row.publicReserve,
    featureCaps: capsFrom(row.featureCaps),
    featureSwitches: switchesFrom(row.featureSwitches),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function readFaq(
  db: DbExecutor = getDb(),
  options: { visibleOnly?: boolean } = {},
): Promise<FaqEntry[]> {
  const rows = await db.select().from(aiFaq).orderBy(asc(aiFaq.position), asc(aiFaq.id));
  const translations = await db.select().from(aiFaqTranslations);
  return rows
    .filter((r) => !options.visibleOnly || r.isVisible)
    .map((r) => {
      const own = translations.filter((t) => t.faqId === r.id);
      const latest = own.reduce((max, t) => (t.updatedAt > max ? t.updatedAt : max), r.updatedAt);
      return {
        id: r.id,
        position: r.position,
        isVisible: r.isVisible,
        translations: Object.fromEntries(
          own.map((t) => [t.locale, { question: t.question, answer: t.answer }]),
        ),
        updatedAt: latest.toISOString(),
      };
    });
}

/** Settings and visible FAQ entries, as of at most a few seconds ago. */
export function assistantState(
  now = Date.now(),
): Promise<{ settings: AiSettings; faq: FaqEntry[] }> {
  if (!cache || now - cache.at > TTL_MS) {
    const value = Promise.all([readAiSettings(), readFaq(getDb(), { visibleOnly: true })]).then(
      ([settings, faq]) => ({ settings, faq }),
    );
    cache = { at: now, value };
    value.catch(() => {
      if (cache?.value === value) cache = undefined;
    });
  }
  return cache.value;
}
