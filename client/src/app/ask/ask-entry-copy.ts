import type { Locale } from "../content/locale";

/**
 * Under the prompt, each a button that runs it; `help` lists the rest (plan 4 U11). `evals` shows
 * while the scorecard is published or unknown, as in `help`: unpublished, it has nothing to show.
 */
export function commandRow(scorecard: boolean | null): string[] {
  const row = ["help", "inspect", "evals", "tour", "match"];
  return scorecard === false ? row.filter((command) => command !== "evals") : row;
}

/**
 * The words the hero's stage prints before the console's code loads. Loaded with the page, unlike
 * `ask-copy.ts`, which comes with the console and would otherwise put all of its copy into the
 * first load.
 */
export interface AskEntryCopy {
  /** Suggested first questions. */
  starters: string[];
  /** The suggestions' group. */
  suggestions: string;
  /** The prompt's send button. */
  send: string;
  /** The row of commands, for screen readers. */
  commands: string;
  /** The stage while the panel holds the conversation. */
  continuing: string;
  /** Before the last question, on a phone's stage, for screen readers. */
  resume: string;
  /** The way out when the assistant cannot help (plan 4 U12). */
  contact: string;
}

export const ASK_ENTRY_COPY: Record<Locale, AskEntryCopy> = {
  en: {
    starters: [
      "What has he shipped with RAG?",
      "How does he test AI features?",
      "Which stack does he reach for, and why?",
    ],
    suggestions: "Suggested questions",
    send: "Ask",
    commands: "Commands",
    continuing: "Continuing in the panel",
    resume: "Continue your conversation",
    contact: "Write to him",
  },
  de: {
    starters: [
      "Was hat er mit RAG gebaut?",
      "Wie testet er KI-Funktionen?",
      "Welchen Stack nutzt er – und warum?",
    ],
    suggestions: "Vorgeschlagene Fragen",
    send: "Fragen",
    commands: "Befehle",
    continuing: "Weiter im Fenster",
    resume: "Unterhaltung fortsetzen",
    contact: "Ihm schreiben",
  },
};
