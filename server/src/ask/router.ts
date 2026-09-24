/**
 * Lite or deep. Most questions go to the fast, cheap primary model; the deep
 * model takes comparisons, "why" and "how would" questions, architecture, and
 * questions that span several projects — or anything after the `deep` command.
 * Cheap and deterministic; every decision is logged, so it can be tuned on real
 * questions.
 */

export type Route = "lite" | "deep";

export interface RouteDecision {
  route: Route;
  reason: string;
}

const DEEP_PATTERNS: [RegExp, string][] = [
  [/\b(compare|comparison|versus|vs\.?|difference between|differ)\b/i, "compare"],
  [/\b(vergleich\w*|unterschied\w*|gegenüber)\b/i, "compare"],
  [/\b(why|how would|how did he (?:design|architect|decide)|trade-?offs?)\b/i, "why"],
  [/\b(warum|wieso|weshalb|wie würde|abwägung\w*)\b/i, "why"],
  [
    /\b(architect\w*|system design|design decisions?|scal\w+ (?:to|up)|infrastructure)\b/i,
    "architecture",
  ],
  [/\b(architektur\w*|systemdesign|designentscheidung\w*|infrastruktur)\b/i, "architecture"],
];

export function routeQuestion(
  text: string,
  options: { forceDeep: boolean; deepAllowed: boolean; projectNames: readonly string[] },
): RouteDecision {
  if (!options.deepAllowed)
    return { route: "lite", reason: options.forceDeep ? "deep-off" : "default" };
  if (options.forceDeep) return { route: "deep", reason: "command" };

  for (const [pattern, reason] of DEEP_PATTERNS) {
    if (pattern.test(text)) return { route: "deep", reason };
  }

  const lower = text.toLowerCase();
  const named = options.projectNames.filter(
    (name) => name.length > 2 && lower.includes(name.toLowerCase()),
  );
  if (new Set(named.map((n) => n.toLowerCase())).size >= 2) {
    return { route: "deep", reason: "multi-project" };
  }
  return { route: "lite", reason: "default" };
}
