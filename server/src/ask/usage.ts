import { sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiUsage, aiUsageFeatures } from "../db/schema.js";
import type { Feature } from "./features.js";
import { utcDay } from "./guard.js";
import type { ModelCall } from "./models/fallback.js";
import { addTokens, costUsd, tokenCounts, type TokenCounts } from "./models/prices.js";

/** Cost and tokens of one answer: every model call it took, at today's prices. */
export function summarizeCalls(calls: readonly ModelCall[], at = new Date()) {
  let tokens: TokenCounts = { input: 0, cached: 0, output: 0, thoughts: 0 };
  let usd = 0;
  const perModel = new Map<string, { requests: number; tokens: TokenCounts; usd: number }>();
  for (const call of calls) {
    const counts = tokenCounts(call.usage);
    const cost = costUsd(call.model, counts, at);
    tokens = addTokens(tokens, counts);
    usd += cost;
    const row = perModel.get(call.model) ?? {
      requests: 0,
      tokens: { input: 0, cached: 0, output: 0, thoughts: 0 },
      usd: 0,
    };
    row.requests++;
    row.tokens = addTokens(row.tokens, counts);
    row.usd += cost;
    perModel.set(call.model, row);
  }
  return { tokens, usd, perModel };
}

/** An upsert's set that adds the incoming counters to the stored ones. */
function added(table: typeof aiUsage | typeof aiUsageFeatures) {
  return {
    requests: sql`${table.requests} + excluded.requests`,
    inputTokens: sql`${table.inputTokens} + excluded.input_tokens`,
    cachedInputTokens: sql`${table.cachedInputTokens} + excluded.cached_input_tokens`,
    outputTokens: sql`${table.outputTokens} + excluded.output_tokens`,
    thoughtTokens: sql`${table.thoughtTokens} + excluded.thought_tokens`,
    usd: sql`${table.usd} + excluded.usd`,
  };
}

/**
 * Adds one feature's calls to today's totals: the day's per model, which the
 * budget reads, then the feature's own, which its fences read. Two statements,
 * not one transaction: holding both tables at once could deadlock against
 * anything that locks them in the other order (a migration, a test's
 * truncate). The rows go in model order, so answers recording at once lock
 * them in the same order. The split is bookkeeping: if its write fails, the
 * day's total still stands and the caller's own writes go on.
 */
export async function recordUsage(
  calls: readonly ModelCall[],
  feature: Feature,
  at = new Date(),
): Promise<void> {
  const { perModel } = summarizeCalls(calls, at);
  if (!perModel.size) return;
  const day = utcDay(at);
  const rows = [...perModel]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([model, row]) => ({
      day,
      model,
      requests: row.requests,
      inputTokens: row.tokens.input,
      cachedInputTokens: row.tokens.cached,
      outputTokens: row.tokens.output,
      thoughtTokens: row.tokens.thoughts,
      usd: row.usd,
    }));
  await getDb()
    .insert(aiUsage)
    .values(rows)
    .onConflictDoUpdate({ target: [aiUsage.day, aiUsage.model], set: added(aiUsage) });
  await getDb()
    .insert(aiUsageFeatures)
    .values(rows.map((row) => ({ ...row, feature })))
    .onConflictDoUpdate({
      target: [aiUsageFeatures.day, aiUsageFeatures.feature, aiUsageFeatures.model],
      set: added(aiUsageFeatures),
    })
    .catch((error) => console.error(`[ask] ${feature} usage not split by feature`, error));
}
