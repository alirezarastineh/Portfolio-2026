import type { Locale } from "../content/locale";

/**
 * The words around the assistant's entry points on the page itself: the
 * hero's ask bar and its starter questions, and the trace panel. Loaded with
 * the page, unlike `ask-copy.ts`, which comes with the terminal and would
 * otherwise put all of the terminal's copy into the first load.
 */
export interface AskEntryCopy {
  /** Suggested first questions: typed into the bar's placeholder, and chips below it. */
  starters: string[];
  /** Before the chips. */
  try: string;
  /** The chips' group. */
  suggestions: string;
  /** The bar's send button. */
  send: string;
  trace: {
    title: string;
    example: string;
    /** `{s}`: how long the answer took. */
    last: string;
    /** The panel for screen readers; `{model}` and `{s}` for a real answer. */
    summary: string;
    lastSummary: string;
    /** The example's values. */
    model: string;
    tools: string;
    sources: string;
    /** For a real answer. */
    noTools: string;
    noSources: string;
    /** `{n}` sources, `{p}` percent. */
    sourcesCount: string;
    cached: string;
    fallback: string;
  };
}

export const ASK_ENTRY_COPY: Record<Locale, AskEntryCopy> = {
  en: {
    starters: [
      "What has he shipped with RAG?",
      "How does he test AI features?",
      "Which stack does he reach for, and why?",
    ],
    try: "try",
    suggestions: "Suggested questions",
    send: "Ask",
    trace: {
      title: "trace · ask_portfolio",
      example: "example trace",
      last: "your last question · {s}",
      summary:
        "How the assistant answers: it routes a question to a fast or a thorough model, looks things up in this site's content, writes the answer, and checks that every source it cites exists. The timings shown are an example.",
      lastSummary: "Your last question was answered by {model} in {s}.",
      model: "gemini-3.5-flash-lite",
      tools: "search_portfolio",
      sources: "2 verified",
      noTools: "context only",
      noSources: "none",
      sourcesCount: "{n} verified",
      cached: "{p}% cached",
      fallback: "fallback",
    },
  },
  de: {
    starters: [
      "Was hat er mit RAG gebaut?",
      "Wie testet er KI-Funktionen?",
      "Welchen Stack nutzt er – und warum?",
    ],
    try: "z. B.",
    suggestions: "Vorgeschlagene Fragen",
    send: "Fragen",
    trace: {
      title: "trace · ask_portfolio",
      example: "Beispiel-Trace",
      last: "deine letzte Frage · {s}",
      summary:
        "So antwortet der Assistent: Er leitet eine Frage an ein schnelles oder ein gründliches Modell, schlägt im Inhalt dieser Website nach, schreibt die Antwort und prüft, dass jede zitierte Quelle existiert. Die gezeigten Zeiten sind ein Beispiel.",
      lastSummary: "Deine letzte Frage hat {model} in {s} beantwortet.",
      model: "gemini-3.5-flash-lite",
      tools: "search_portfolio",
      sources: "2 geprüft",
      noTools: "nur Kontext",
      noSources: "keine",
      sourcesCount: "{n} geprüft",
      cached: "{p} % gecacht",
      fallback: "Ausweichmodell",
    },
  },
};
