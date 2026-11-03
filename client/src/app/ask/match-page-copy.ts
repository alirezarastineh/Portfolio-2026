import type { Locale } from "../content/locale";
import type { MatchKind } from "./match";

/**
 * The match page's words (plan 3 W3). They live here, not in `i18n/chrome.ts`,
 * so only the page's chunk carries them. German uses "du", as the terminal does.
 */
export interface MatchPageCopy {
  /** The page's heading, and its title. */
  heading: string;
  eyebrow: string;
  /** What the page does: server-rendered, and the search result's description. */
  intro: string;
  legend: string;
  kinds: Record<MatchKind, string>;
  /** The table's name, for screen readers. */
  caption: string;
  columns: { status: string; item: Record<MatchKind, string>; shows: string; evidence: string };
  handoff: string;
  print: string;
  /** Takes the rows, and the marks they put on his pages, out of this tab (plan 3 W4). */
  clear: string;
  /** Said once cleared: the button goes with the table. */
  cleared: string;
  /** On paper only, the AI disclosure: `{date}`, the match's day; `{url}`, the page. */
  printed: string;
  /** After match's "off" line, to the contact section. */
  contact: string;
}

export const MATCH_PAGE_COPY: Record<Locale, MatchPageCopy> = {
  en: {
    heading: "Check the fit",
    eyebrow: "match a brief",
    intro:
      "Paste a role, or describe a project or a problem. The site's AI assistant checks each point against Alireza's published work, and every row shows the pages it rests on.",
    legend: "What are you checking?",
    kinds: { role: "A role", project: "A project", problem: "A problem" },
    caption: "Each point of the brief, with what his work shows",
    columns: {
      status: "Status",
      item: { role: "Requirement", project: "Need", problem: "Aspect" },
      shows: "What his work shows",
      evidence: "Evidence",
    },
    handoff: "Hand this to the contact form",
    print: "Print or save as PDF",
    clear: "Clear",
    cleared: "Cleared: the rows and the marks on his pages are gone.",
    printed:
      "Checked on {date} by the AI assistant on Alireza's portfolio; each row cites a published page. {url}",
    contact: "Write to him instead",
  },
  de: {
    heading: "Prüf, ob es passt",
    eyebrow: "Beschreibung abgleichen",
    intro:
      "Füge eine Stelle ein oder beschreibe ein Projekt oder ein Problem. Der KI-Assistent der Website gleicht jeden Punkt mit Alirezas veröffentlichter Arbeit ab, und jede Zeile zeigt die Seiten, auf denen sie beruht.",
    legend: "Was möchtest du prüfen?",
    kinds: { role: "Eine Stelle", project: "Ein Projekt", problem: "Ein Problem" },
    caption: "Jeder Punkt der Beschreibung und was seine Arbeit zeigt",
    columns: {
      status: "Status",
      item: { role: "Anforderung", project: "Punkt", problem: "Aspekt" },
      shows: "Was seine Arbeit zeigt",
      evidence: "Belege",
    },
    handoff: "An das Kontaktformular übergeben",
    print: "Drucken oder als PDF speichern",
    clear: "Löschen",
    cleared: "Gelöscht: Die Zeilen und die Markierungen auf seinen Seiten sind weg.",
    printed:
      "Am {date} geprüft vom KI-Assistenten auf Alirezas Portfolio; jede Zeile nennt eine veröffentlichte Seite. {url}",
    contact: "Schreib ihm stattdessen",
  },
};
