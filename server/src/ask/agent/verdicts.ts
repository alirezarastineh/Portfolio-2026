import type { SkillRun } from "../skills/run.js";
import { decideUses, type SkillOutcome } from "../skills/uses.js";

/**
 * What became of an agent's drafts (plan phases 30–31), decided when the
 * admin decides a proposal, as the editors' ledger decides the copilot's: the
 * skills' table counts them apart (`source: "agent"`). Shared by the content
 * agent's apply (apply.ts) and the FAQ proposals' accept (faq-decide.ts).
 */

/** A draft's verdict, as the skills' table takes it (`SkillOutcome` without its id). */
export type Verdict =
  | { outcome: "kept" }
  | { outcome: "edited"; distance: number }
  | { outcome: "discarded"; distance?: number | null };

/** Words as the editors' ledger counts them (client `copilot-ledger.ts`). */
const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** Above this many word pairs, shared words are counted as a multiset (an upper bound). */
const MAX_WORD_PAIRS = 4_000_000;

function sharedWords(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  if (a.length * b.length > MAX_WORD_PAIRS) {
    const left = new Map<string, number>();
    for (const word of a) left.set(word, (left.get(word) ?? 0) + 1);
    let shared = 0;
    for (const word of b) {
      const n = left.get(word) ?? 0;
      if (n) {
        shared++;
        left.set(word, n - 1);
      }
    }
    return shared;
  }
  let previous = Array.from({ length: b.length + 1 }, () => 0);
  for (const word of a) {
    const row = Array.from({ length: b.length + 1 }, () => 0);
    for (let j = 0; j < b.length; j++) {
      row[j + 1] = word === b[j] ? previous[j]! + 1 : Math.max(previous[j + 1]!, row[j]!);
    }
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * The verdict on a draft from what was kept, as the editors' ledger reads it:
 * the same words kept; edited when at least half the draft's words survive in
 * order; otherwise discarded (the admin wrote their own).
 */
export function verdictOn(draft: string, kept: string): Verdict {
  const a = wordsOf(draft);
  const b = wordsOf(kept);
  if (a.length === b.length && a.every((w, i) => w === b[i])) return { outcome: "kept" };
  const shared = sharedWords(a, b);
  const distance = Math.max(1, a.length + b.length - 2 * shared);
  return a.length && shared * 2 >= a.length
    ? { outcome: "edited", distance }
    : { outcome: "discarded", distance };
}

/** A draft's skill use decided, once (a failure is logged: the decision stands). */
export async function decideUse(useId: string | null | undefined, verdict: Verdict): Promise<void> {
  if (!useId) return;
  await decideUses([{ id: useId, ...verdict } as SkillOutcome]).catch((error) =>
    console.error("[agent] a proposal's skill use not decided", error),
  );
}

/** What a second reading said about a draft, as a proposal's note. */
export function criticNotes(critic: SkillRun["critic"]): string[] {
  if (!critic?.notes.length) return [];
  return [
    critic.result === "revised"
      ? `A second reading changed it: ${critic.notes.join(" ")}`
      : `A second reading found: ${critic.notes.join(" ")} Its revision was not kept.`,
  ];
}
