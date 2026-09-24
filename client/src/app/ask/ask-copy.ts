import type { Locale } from "../content/locale";

/**
 * The terminal's own words: command output, states, controls. Loaded with the
 * terminal, not the page. The visitor-facing sentences that belong to the site
 * (title, hint, placeholder, AI disclosure, the "resting" line) come from the
 * CMS (`ui.ask`); these are shell chrome, like `i18n/chrome.ts`.
 */
export interface AskCopy {
  inputLabel: string;
  help: { title: string; rows: [string, string][]; footer: string };
  thinking: string;
  stopHint: string;
  interrupted: string;
  retry: string;
  errors: {
    unavailable: string;
    timeout: string;
    error: string;
    blocked: string;
    rateLimited: string;
    busy: string;
    offline: string;
    invalid: string;
    tooLong: string;
  };
  offlineIntro: string;
  offlineContact: string;
  fallback: string;
  cached: string;
  sources: string;
  followups: string;
  helpful: string;
  notHelpful: string;
  thanks: string;
  copy: string;
  copied: string;
  handoff: { ask: string; yes: string; no: string; done: string; declined: string };
  opening: string;
  tool: {
    search_portfolio: string;
    get_document: string;
    list_projects: string;
    get_resume: string;
    navigate: string;
  };
  cmd: {
    unknownProject: string;
    noProjects: string;
    noSkills: string;
    noCv: string;
    cv: string;
    contact: string;
    lang: string;
    langUsage: string;
    statsOn: string;
    statsOff: string;
    reset: string;
    historyEmpty: string;
    deepUsage: string;
    openUsage: string;
    notFound: string;
    caseStudy: string;
    stack: string;
    location: string;
    availability: string;
    sudo: string[];
  };
  close: string;
  you: string;
  assistant: string;
}

export const ASK_COPY: Record<Locale, AskCopy> = {
  en: {
    inputLabel: "Ask the portfolio assistant",
    help: {
      title: "Commands:",
      rows: [
        ["help", "this list"],
        ["whoami", "who Alireza is"],
        ["ls projects", "his projects"],
        ["cat <project>", "one project in detail"],
        ["ls skills", "what he works with"],
        ["open <page>", "go to a project, post or section"],
        ["cv", "download his CV"],
        ["contact", "write to him"],
        ["lang en|de", "switch the language"],
        ["deep <question>", "ask the slower, more thorough model"],
        ["stats", "show model, latency and cache under answers"],
        ["history · clear · reset", "as in any shell"],
      ],
      footer: "Anything else is a question for the AI assistant.",
    },
    thinking: "thinking…",
    stopHint: "ctrl+c to stop",
    interrupted: "(answer interrupted)",
    retry: "retry",
    errors: {
      unavailable: "No model could answer just now.",
      timeout: "That took too long to answer.",
      error: "Something went wrong with that answer.",
      blocked: "I can't help with that one — ask me about Alireza's work instead.",
      rateLimited: "That's a lot of questions — try again in {s}s.",
      busy: "The assistant is busy — try again in a moment.",
      offline: "You seem to be offline.",
      invalid: "That message could not be sent.",
      tooLong: "Keep questions under {n} characters.",
    },
    offlineIntro: "Without the AI, here's what I can show you:",
    offlineContact: "For anything else, type `contact`.",
    fallback: "answered by a fallback model",
    cached: "{p}% cached",
    sources: "sources",
    followups: "try",
    helpful: "Helpful",
    notHelpful: "Not helpful",
    thanks: "thanks for the feedback",
    copy: "copy",
    copied: "copied",
    handoff: {
      ask: "Hand this conversation to the contact form?",
      yes: "yes",
      no: "no",
      done: "Done — your summary is in the contact form. Add your name and email there.",
      declined: "OK, nothing was shared.",
    },
    opening: "opening {path}…",
    tool: {
      search_portfolio: 'search "{q}"',
      get_document: "cat {id}",
      list_projects: "ls projects {q}",
      get_resume: "cat cv",
      navigate: "open {to}",
    },
    cmd: {
      unknownProject: "No project called “{x}”. Try `ls projects`.",
      noProjects: "No projects are published yet.",
      noSkills: "No skills are published yet.",
      noCv: "No CV is published yet.",
      cv: "Downloading the CV…",
      contact: "Taking you to the contact form…",
      lang: "Switching to {lang}…",
      langUsage: "usage: lang en|de",
      statsOn: "stats on: model, latency and cache under each answer.",
      statsOff: "stats off.",
      reset: "New session. The assistant has forgotten this conversation.",
      historyEmpty: "No history yet.",
      deepUsage: "usage: deep <question>",
      openUsage: "usage: open <project|post|section>",
      notFound: "Nothing called “{x}” here. Try `ls projects`.",
      caseStudy: "case study",
      stack: "stack",
      location: "location",
      availability: "availability",
      sudo: ["[sudo] password for visitor: ********", "Access granted. Opening a line to Alireza…"],
    },
    close: "Close the assistant",
    you: "You asked",
    assistant: "The assistant answered",
  },
  de: {
    inputLabel: "Frag den Portfolio-Assistenten",
    help: {
      title: "Befehle:",
      rows: [
        ["help", "diese Liste"],
        ["whoami", "wer Alireza ist"],
        ["ls projects", "seine Projekte"],
        ["cat <projekt>", "ein Projekt im Detail"],
        ["ls skills", "womit er arbeitet"],
        ["open <seite>", "zu einem Projekt, Artikel oder Bereich"],
        ["cv", "Lebenslauf herunterladen"],
        ["contact", "ihm schreiben"],
        ["lang en|de", "Sprache wechseln"],
        ["deep <frage>", "das langsamere, gründlichere Modell fragen"],
        ["stats", "Modell, Latenz und Cache unter Antworten zeigen"],
        ["history · clear · reset", "wie in jeder Shell"],
      ],
      footer: "Alles andere ist eine Frage an den KI-Assistenten.",
    },
    thinking: "denkt nach…",
    stopHint: "Strg+C zum Abbrechen",
    interrupted: "(Antwort unterbrochen)",
    retry: "erneut versuchen",
    errors: {
      unavailable: "Gerade konnte kein Modell antworten.",
      timeout: "Die Antwort hat zu lange gedauert.",
      error: "Bei dieser Antwort ist etwas schiefgegangen.",
      blocked: "Dabei kann ich nicht helfen – frag mich lieber zu Alirezas Arbeit.",
      rateLimited: "Das waren viele Fragen – versuch es in {s} s noch einmal.",
      busy: "Der Assistent ist ausgelastet – versuch es gleich noch einmal.",
      offline: "Du scheinst offline zu sein.",
      invalid: "Diese Nachricht konnte nicht gesendet werden.",
      tooLong: "Fragen bitte unter {n} Zeichen.",
    },
    offlineIntro: "Ohne KI kann ich dir Folgendes zeigen:",
    offlineContact: "Für alles andere: `contact`.",
    fallback: "beantwortet von einem Ausweichmodell",
    cached: "{p} % aus dem Cache",
    sources: "Quellen",
    followups: "Vorschläge",
    helpful: "Hilfreich",
    notHelpful: "Nicht hilfreich",
    thanks: "danke für die Rückmeldung",
    copy: "kopieren",
    copied: "kopiert",
    handoff: {
      ask: "Dieses Gespräch an das Kontaktformular übergeben?",
      yes: "ja",
      no: "nein",
      done: "Erledigt – deine Zusammenfassung steht im Kontaktformular. Ergänze dort Name und E-Mail.",
      declined: "Okay, nichts wurde übergeben.",
    },
    opening: "öffne {path}…",
    tool: {
      search_portfolio: 'suche "{q}"',
      get_document: "cat {id}",
      list_projects: "ls projects {q}",
      get_resume: "cat cv",
      navigate: "open {to}",
    },
    cmd: {
      unknownProject: "Kein Projekt namens „{x}“. Versuch `ls projects`.",
      noProjects: "Noch keine Projekte veröffentlicht.",
      noSkills: "Noch keine Fähigkeiten veröffentlicht.",
      noCv: "Noch kein Lebenslauf veröffentlicht.",
      cv: "Lebenslauf wird heruntergeladen…",
      contact: "Zum Kontaktformular…",
      lang: "Wechsle zu {lang}…",
      langUsage: "Verwendung: lang en|de",
      statsOn: "stats an: Modell, Latenz und Cache unter jeder Antwort.",
      statsOff: "stats aus.",
      reset: "Neue Sitzung. Der Assistent hat dieses Gespräch vergessen.",
      historyEmpty: "Noch kein Verlauf.",
      deepUsage: "Verwendung: deep <frage>",
      openUsage: "Verwendung: open <projekt|artikel|bereich>",
      notFound: "Hier gibt es nichts namens „{x}“. Versuch `ls projects`.",
      caseStudy: "Fallstudie",
      stack: "Stack",
      location: "Standort",
      availability: "Verfügbarkeit",
      sudo: ["[sudo] Passwort für visitor: ********", "Zugriff gewährt. Verbinde mit Alireza…"],
    },
    close: "Assistenten schließen",
    you: "Deine Frage",
    assistant: "Antwort des Assistenten",
  },
};
