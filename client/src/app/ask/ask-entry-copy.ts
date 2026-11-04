import type { Locale } from "../content/locale";

/** Under the prompt, each a button that runs it; `help` lists the rest (plan 4 U11). */
export const COMMAND_ROW = ["help", "inspect", "evals", "tour", "match"];

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
  },
};
