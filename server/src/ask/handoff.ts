/**
 * A hand-off to the contact form (plan phase 11): the conversation it came
 * from goes with the message only when the visitor ticks "attach". It holds
 * what the log already keeps (the redacted question and the answer excerpt)
 * for that one session, oldest first, up to the answer the offer came with.
 */

/** At most this many turns: the end of a conversation is what the reply needs. */
export const TRANSCRIPT_TURNS = 10;

export interface AskTranscript {
  v: 1;
  turns: { question: string; answer: string; cited: string[]; at: string }[];
}

export function buildTranscript(
  rows: readonly { question: string; answer: string; cited: string[]; createdAt: Date }[],
): AskTranscript {
  const recent = [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-TRANSCRIPT_TURNS);
  return {
    v: 1,
    turns: recent.map((row) => ({
      question: row.question,
      answer: row.answer,
      cited: row.cited,
      at: row.createdAt.toISOString(),
    })),
  };
}
