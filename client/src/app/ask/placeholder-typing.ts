/** How the ask bar's placeholder types, in ms. */
export const TYPING = { type: 40, hold: 2400, erase: 20, gap: 400 } as const;

/** One step of the placeholder: what it shows, and for how long. */
export interface PlaceholderStep {
  text: string;
  wait: number;
}

/**
 * The starter questions, typed into the placeholder one after another, held,
 * and erased, forever. It starts with the first one already written out, as
 * the server rendered it.
 */
export function* placeholderSteps(
  starters: readonly string[],
  timing: typeof TYPING = TYPING,
): Generator<PlaceholderStep, void, undefined> {
  if (!starters.length) return;
  let i = 0;
  for (;;) {
    const text = starters[i]!;
    yield { text, wait: timing.hold };
    if (starters.length === 1) continue;
    for (let n = text.length - 1; n > 0; n--) {
      yield { text: text.slice(0, n), wait: timing.erase };
    }
    yield { text: "", wait: timing.gap };
    i = (i + 1) % starters.length;
    const next = starters[i]!;
    for (let n = 1; n < next.length; n++) {
      yield { text: next.slice(0, n), wait: timing.type };
    }
  }
}
