import type { LanguageModelV4Usage } from "@ai-sdk/provider";

/**
 * USD per million tokens, with the date each price applies from. Dated so a
 * known change (Flash's 2027 price) applies itself on the day. Read from the
 * providers' price pages on 2026-09-22.
 */
export interface Price {
  from: string;
  input: number;
  cachedInput: number;
  output: number;
}

const FREE: Price[] = [{ from: "2000-01-01", input: 0, cachedInput: 0, output: 0 }];

const PRICES: Record<string, Price[]> = {
  "gemini-3.5-flash-lite": [{ from: "2026-01-01", input: 0.3, cachedInput: 0.03, output: 2.5 }],
  "gemini-3.7-flash": [
    { from: "2026-01-01", input: 0.75, cachedInput: 0.075, output: 3.75 },
    { from: "2027-01-01", input: 1.5, cachedInput: 0.15, output: 7.5 },
  ],
  // Free tier only (see the plan's privacy notes).
  "gemma-4-31b-it": FREE,
};

/**
 * An unknown paid model is charged like the dearest known one, so the daily
 * budget errs on the safe side until its price is added here.
 */
const UNKNOWN: Price = { from: "2000-01-01", input: 1.5, cachedInput: 0.15, output: 7.5 };

const warned = new Set<string>();

export function priceOf(model: string, at: Date): Price {
  // OpenRouter's free variants carry the suffix in their id.
  if (model.endsWith(":free")) return FREE[0]!;
  const table = PRICES[model];
  if (!table) {
    if (!warned.has(model)) {
      warned.add(model);
      console.warn(`[ask] no price for ${model}; counting it at the highest known price`);
    }
    return UNKNOWN;
  }
  const day = at.toISOString().slice(0, 10);
  let current = table[0]!;
  for (const price of table) if (price.from <= day) current = price;
  return current;
}

export interface TokenCounts {
  input: number;
  cached: number;
  output: number;
  thoughts: number;
}

export function tokenCounts(usage: LanguageModelV4Usage | null | undefined): TokenCounts {
  if (!usage) return { input: 0, cached: 0, output: 0, thoughts: 0 };
  const thoughts = usage.outputTokens.reasoning ?? 0;
  return {
    input: usage.inputTokens.total ?? 0,
    cached: usage.inputTokens.cacheRead ?? 0,
    // Thoughts are billed as output; `total` includes them where it is set.
    output: usage.outputTokens.total ?? (usage.outputTokens.text ?? 0) + thoughts,
    thoughts,
  };
}

export function costUsd(model: string, tokens: TokenCounts, at: Date): number {
  const price = priceOf(model, at);
  const cached = Math.min(tokens.cached, tokens.input);
  return (
    ((tokens.input - cached) * price.input +
      cached * price.cachedInput +
      tokens.output * price.output) /
    1_000_000
  );
}

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    cached: a.cached + b.cached,
    output: a.output + b.output,
    thoughts: a.thoughts + b.thoughts,
  };
}
