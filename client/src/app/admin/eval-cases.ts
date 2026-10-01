/**
 * Eval cases frozen from visitor answers, as the admin lists them. The shape
 * mirrors `GET /admin/assistant/eval-cases` (`server/src/ask/evals/production.ts`).
 */

export interface EvalCaseRow {
  id: string;
  question: string;
  locale: "en" | "de";
  snapshotKey: string;
  mustCite: string[];
  mustInclude: string[];
  status: "active" | "retired";
  fromMessageId: string | null;
  createdAt: string;
  /** Against the live corpus: a cited document gone or changed since the snapshot. */
  stale: "gone" | "changed" | null;
}

export const STALE_LABELS: Record<NonNullable<EvalCaseRow["stale"]>, string> = {
  gone: "a document it cites is gone",
  changed: "a document it cites has changed",
};

/** Comma- or line-separated input as a clean list: trimmed, no blanks, no repeats. */
export function listInput(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

/** What "Freeze as eval case" sends (`POST /admin/assistant/eval-cases`, besides the answer's id). */
export interface FreezeBody {
  /** Only when the admin rewrote it: the server keeps the redacted question otherwise. */
  question?: string;
  mustCite: string[];
  mustInclude: string[];
  /** The admin's word that nothing personal is left: the server refuses a case without it. */
  personalChecked: true;
}

/** The freeze form as a request, or why it cannot be sent yet. */
export function freezeRequest(
  original: string,
  form: { question: string; mustCite: string; mustInclude: string; personalChecked: boolean },
): { ok: true; body: FreezeBody } | { ok: false; error: string } {
  const question = form.question.trim();
  if (question.length < 3) return { ok: false, error: "The question needs at least 3 characters" };
  if (!form.personalChecked) {
    return { ok: false, error: "Confirm that nothing personal is left in the question" };
  }
  return {
    ok: true,
    body: {
      ...(question !== original.trim() ? { question } : {}),
      mustCite: listInput(form.mustCite),
      mustInclude: listInput(form.mustInclude),
      personalChecked: true,
    },
  };
}

/** The stale ones first, then the newest. */
export function sortCases(rows: readonly EvalCaseRow[]): EvalCaseRow[] {
  return [...rows].sort(
    (a, b) => Number(!!b.stale) - Number(!!a.stale) || b.createdAt.localeCompare(a.createdAt),
  );
}
