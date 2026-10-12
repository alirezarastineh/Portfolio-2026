import { inject, Injectable, signal } from "@angular/core";

import { AdminApiService } from "./admin-api.service";
import type { DraftVerdict } from "./copilot-skills";

/**
 * What became of the copilot's drafts (plan phase 27). A draft lands in a
 * field; when the editor saves, discards or closes, the draft is judged
 * against what the field holds and the verdict goes to the API, which keeps
 * ids and word counts, never the texts (the server's `ai_skill_uses`).
 */

/** Words as the server counts them: split on whitespace. */
export function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Above this many word pairs (2,000 words against 2,000), the shared words are
 * counted as a multiset, an upper bound of those shared in order: no field the
 * admin edits comes near it.
 */
export const MAX_WORD_PAIRS = 4_000_000;

/** How many words two texts share in order: their longest common subsequence. */
export function sharedWords(a: readonly string[], b: readonly string[]): number {
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
  let previous = new Uint32Array(b.length + 1);
  let row = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, row[j - 1]!);
    }
    [previous, row] = [row, previous];
  }
  return previous[b.length]!;
}

const sameWords = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((word, i) => word === b[i]);

/**
 * A draft judged by what was saved: **kept**, the same words (whitespace
 * aside); **discarded** when the field holds again what it held `before` the
 * draft (a discard put it back, or the admin typed it back), however close
 * the draft was to it; **edited**, at least half of the draft's words survive
 * in order; otherwise **discarded** (an emptied field too). The distance is a
 * diff's size in words: inserted plus deleted.
 */
export function classify(
  draft: string,
  saved: string,
  before?: string,
): { outcome: "kept" | "edited" | "discarded"; distance: number } {
  const a = wordsOf(draft);
  const b = wordsOf(saved);
  if (sameWords(a, b)) return { outcome: "kept", distance: 0 };
  const shared = sharedWords(a, b);
  // At least 1: the multiset bound can match a reordered text word for word.
  const distance = Math.max(1, a.length + b.length - 2 * shared);
  if (before !== undefined && sameWords(wordsOf(before), b)) {
    return { outcome: "discarded", distance };
  }
  return { outcome: a.length && shared * 2 >= a.length ? "edited" : "discarded", distance };
}

interface Waiting {
  id: string;
  text: string;
  /** The field's value now. */
  read: () => string;
  /** What the field held before the draft landed. */
  before?: string;
  /** Every draft offered for the field, the top pick first (plan phase 28), when several were. */
  offered?: readonly string[];
  /** Which of them is in the field. */
  pick?: number;
}

/** The API takes at most this many verdicts a request. */
const BATCH = 50;

/**
 * The drafts waiting for a verdict, by field. Provided with the admin's API
 * client (`pages/admin.page.ts`). A field is a target string the caller
 * chooses (`faq:en`, `media:alt:<id>:de`); a prefix abandons a group. A field
 * pair settles when its control is saved; the other editors wrap their save
 * in `beginSave`.
 */
@Injectable()
export class CopilotLedger {
  private readonly api = inject(AdminApiService);
  private readonly waiting = new Map<string, Waiting>();
  private queue: DraftVerdict[] = [];
  private scheduled = false;
  private readonly revision = signal(0);

  /**
   * A draft landed in a field: `read` gives the field's value when the editor
   * saves or discards, `before` what it held until the draft came. One still
   * waiting there was replaced unsaved: discarded. A draft without an id (an
   * older API, or nothing to keep) is not tracked.
   */
  propose(
    target: string,
    draft: { suggestionId?: string; text: string; alternatives?: readonly { text: string }[] },
    field: { read: () => string; before?: string },
  ): void {
    this.abandon(target);
    if (draft.suggestionId) {
      const offered = draft.alternatives?.length
        ? [draft.text, ...draft.alternatives.map((alt) => alt.text)]
        : undefined;
      this.waiting.set(target, {
        id: draft.suggestionId,
        text: draft.text,
        ...field,
        ...(offered ? { offered, pick: 0 } : {}),
      });
      this.revision.update((n) => n + 1);
    }
  }

  /**
   * The admin chose another of the drafts offered: it is in the field now,
   * and the one judged at the save, with its place as the pick.
   */
  use(target: string, pick: number): void {
    const draft = this.waiting.get(target);
    const text = draft?.offered?.[pick];
    if (!draft || text === undefined) return;
    this.waiting.set(target, { ...draft, text, pick });
    this.revision.update((n) => n + 1);
  }

  /** Whether a field's draft still waits, read reactively (a signal), for what the editor shows. */
  waits(target: string): boolean {
    this.revision();
    return this.waiting.has(target);
  }

  /** Judges the field's draft by what the field holds now (a field pair's save). */
  settle(target: string): void {
    const draft = this.take(target);
    if (draft) this.judge(draft, draft.read());
  }

  /**
   * A save of these fields has started, with the values it sends, by target.
   * Their drafts leave the waiting list, so closing or leaving the editor
   * meanwhile cannot abandon them; the returned function ends the save: on
   * success each draft is judged against what was sent (not what the field
   * holds by then), on failure it waits again (or, when a newer draft took its
   * field meanwhile, it was replaced unsaved: discarded).
   */
  beginSave(sent: Readonly<Record<string, string>>): (saved: boolean) => void {
    const sending = new Map<string, Waiting & { sent: string }>();
    for (const [target, value] of Object.entries(sent)) {
      const draft = this.take(target);
      if (draft) sending.set(target, { ...draft, sent: value });
    }
    return (saved) => {
      for (const [target, draft] of sending) {
        if (saved) this.judge(draft, draft.sent);
        else if (this.waiting.has(target)) this.discard(draft);
        else this.waiting.set(target, draft);
      }
      if (sending.size) this.revision.update((n) => n + 1);
      sending.clear();
    };
  }

  /**
   * A draft that came back after its editor closed, or its form moved on (another
   * file, another entry): it never lands, and was not kept.
   */
  drop(draft: { suggestionId?: string }): void {
    if (draft.suggestionId)
      this.report({ id: draft.suggestionId, outcome: "discarded", distance: null });
  }

  /** The field's draft was never saved: the editor closed, or the form it sat in went. */
  abandon(target: string): void {
    const draft = this.take(target);
    if (draft) this.discard(draft);
  }

  abandonPrefix(prefix: string): void {
    for (const target of this.targets(prefix)) this.abandon(target);
  }

  /** Whether a field holds a draft still waiting for its verdict. */
  has(target: string): boolean {
    return this.waiting.has(target);
  }

  private take(target: string): Waiting | undefined {
    const draft = this.waiting.get(target);
    if (this.waiting.delete(target)) this.revision.update((n) => n + 1);
    return draft;
  }

  private judge(draft: Waiting, saved: string): void {
    const { outcome, distance } = classify(draft.text, saved, draft.before);
    // Which draft was kept, when several were offered.
    const pick = draft.offered && outcome !== "discarded" ? { pick: draft.pick ?? 0 } : {};
    if (outcome === "kept") {
      this.report({ id: draft.id, outcome, ...pick });
      return;
    }
    if (outcome === "edited") {
      this.report({ id: draft.id, outcome, distance, ...pick });
      return;
    }
    this.report({ id: draft.id, outcome, distance });
  }

  private discard(draft: Waiting): void {
    this.report({ id: draft.id, outcome: "discarded", distance: null });
  }

  private targets(prefix: string): string[] {
    return [...this.waiting.keys()].filter((target) => target.startsWith(prefix));
  }

  /** One request for every verdict of the same tick (a save settles each field at once). */
  private report(verdict: DraftVerdict): void {
    this.queue.push(verdict);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => void this.flush());
  }

  private async flush(): Promise<void> {
    this.scheduled = false;
    const verdicts = this.queue;
    this.queue = [];
    const batches = Array.from({ length: Math.ceil(verdicts.length / BATCH) }, (_, n) =>
      verdicts.slice(n * BATCH, (n + 1) * BATCH),
    );
    const results = await Promise.all(batches.map((batch) => this.api.reportDrafts(batch)));
    for (const result of results) {
      // Never in the admin's way: an older API (404) or the network loses a verdict, no more.
      if (!result.ok) console.warn("[copilot] verdicts not recorded", result.error);
    }
  }
}
