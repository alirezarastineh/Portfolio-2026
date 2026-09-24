import { sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiUsage } from "../db/schema.js";
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

/** Adds an answer's calls to today's per-model totals (the budget reads these). */
export async function recordUsage(calls: readonly ModelCall[], at = new Date()): Promise<void> {
  const { perModel } = summarizeCalls(calls, at);
  const day = utcDay(at);
  for (const [model, row] of perModel) {
    await getDb()
      .insert(aiUsage)
      .values({
        day,
        model,
        requests: row.requests,
        inputTokens: row.tokens.input,
        cachedInputTokens: row.tokens.cached,
        outputTokens: row.tokens.output,
        thoughtTokens: row.tokens.thoughts,
        usd: row.usd,
      })
      .onConflictDoUpdate({
        target: [aiUsage.day, aiUsage.model],
        set: {
          requests: sql`${aiUsage.requests} + excluded.requests`,
          inputTokens: sql`${aiUsage.inputTokens} + excluded.input_tokens`,
          cachedInputTokens: sql`${aiUsage.cachedInputTokens} + excluded.cached_input_tokens`,
          outputTokens: sql`${aiUsage.outputTokens} + excluded.output_tokens`,
          thoughtTokens: sql`${aiUsage.thoughtTokens} + excluded.thought_tokens`,
          usd: sql`${aiUsage.usd} + excluded.usd`,
        },
      });
  }
}
