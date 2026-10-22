import type { Locale } from "../content/locale";

/** A count in words: none, one, and `{n}` of them. */
export interface Counted {
  none: string;
  one: string;
  many: string;
}

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
  /** Why a 👎 (visitor plan V2): the question, and one button per reason. */
  downReason: { ask: string; wrong: string; unanswered: string; length: string };
  copy: string;
  copied: string;
  /** A source chip's date (visitor plan V12): `{date}`, its month. */
  updated: string;
  /** While a failover keeps the visitor waiting (visitor plan V12): `{position}` of `{of}`. */
  failover: { first: string; next: string };
  /** The answer's receipt (visitor plan V12): counts in three forms, `{n}` the number. */
  receipt: {
    toggle: string;
    inspect: string;
    fast: string;
    thorough: string;
    /** `{why}`: one of `escalation`. */
    escalated: string;
    escalation: { "projects-fetched": string; "search-spans-projects": string };
    lookups: Counted;
    sources: Counted;
    removed: Counted;
    careful: string;
    /** `{title}`: the case study's or post's. */
    page: string;
    /** `{label}`: what the visitor pointed at, as their question showed it. */
    focus: { section: string; code: string; selection: string };
    focusMissing: { section: string; code: string; selection: string };
    /** `{level}`: plain or expert. */
    level: string;
    repair: {
      "no-words": string;
      "handoff-without-words": string;
      echo: string;
      stub: string;
      fixed: string;
    };
  };
  /** `inspect` (visitor plan V12): what the log keeps of an answer, as a timeline. */
  inspect: {
    noAnswer: string;
    missing: string;
    failed: string;
    /** `{id}`, `{at}`, `{prompt}`. */
    head: string;
    labels: {
      route: string;
      careful: string;
      page: string;
      focus: string;
      level: string;
      /** `{n}`: the step's number. */
      step: string;
      cited: string;
      removed: string;
      guard: string;
      checks: string;
      repair: string;
      time: string;
    };
    /** `{reason}`: the router's codes. */
    reason: string;
    /** `{step}`, `{why}`. */
    moved: string;
    /** `{model}`, `{ttft}`, `{input}`, `{cached}`, `{output}`. */
    model: string;
    noModel: string;
    /** `{model}`, `{outcome}`, `{ms}`. */
    passedOver: string;
    /** `{label}`, `{outcome}`, `{chars}`. */
    tool: string;
    promoted: string;
    found: string;
    notFound: string;
    /** `{reason}`. */
    byModel: string;
    byLine: string;
    /** `{total}`, `{ttft}`. */
    time: string;
    nothing: string;
    none: string;
  };
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
    /** What `level <name>` says once it is set (visitor plan V10). */
    levelSet: { plain: string; standard: string; expert: string };
    /** `{level}`: the level kept now. */
    levelUsage: string;
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
        ["level plain|standard|expert", "how technical answers are"],
        ["deep <question>", "ask the slower, more thorough model"],
        ["stats", "show model, latency and cache under answers"],
        ["inspect", "how the last answer was made: its steps and checks"],
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
    downReason: {
      ask: "What was wrong?",
      wrong: "wrong or made up",
      unanswered: "didn't answer my question",
      length: "too long or too short",
    },
    copy: "copy",
    copied: "copied",
    updated: "updated {date}",
    failover: {
      first: "the first model is busy, trying another ({position} of {of})",
      next: "that one is busy too, trying another ({position} of {of})",
    },
    receipt: {
      toggle: "how was this answered?",
      inspect: "inspect",
      fast: "fast model",
      thorough: "thorough model",
      escalated: "moved to the thorough model: {why}",
      escalation: {
        "projects-fetched": "it read two projects",
        "search-spans-projects": "the search spans two projects",
      },
      lookups: { none: "no lookups", one: "1 lookup", many: "{n} lookups" },
      sources: { none: "nothing cited", one: "1 source checked", many: "{n} sources checked" },
      removed: {
        none: "",
        one: "1 invented reference removed",
        many: "{n} invented references removed",
      },
      careful: "careful topic: published facts only",
      page: "page: {title}",
      focus: {
        section: "section: {label}",
        code: "code block: {label}",
        selection: "selection quoted from the page",
      },
      focusMissing: {
        section: "section not found on the page",
        code: "code block not found on the page",
        selection: "selection not found on the page: read as your words",
      },
      level: "level: {level}",
      repair: {
        "no-words": "repaired: the first try had no words",
        "handoff-without-words": "repaired: the first try offered the hand-off without words",
        echo: "repaired: the first try only repeated the question",
        stub: "repaired: the first try stopped after a word or two",
        fixed: "closed with a fixed line: no model had words",
      },
    },
    inspect: {
      noAnswer: "No answer to inspect yet.",
      missing: "Nothing is kept for that answer: it may be older than 90 days, or deleted.",
      failed: "Could not load how that answer was made just now.",
      head: "inspect {id} · {at} · prompt {prompt}",
      labels: {
        route: "route",
        careful: "careful",
        page: "page",
        focus: "focus",
        level: "level",
        step: "step {n}",
        cited: "cited",
        removed: "removed",
        guard: "guard",
        checks: "checks",
        repair: "repair",
        time: "time",
      },
      reason: "reason: {reason}",
      moved: "moved to the thorough model at step {step}: {why}",
      model: "{model} · first token {ttft} · {input} in ({cached} cached) · {output} out",
      noModel: "no model could answer",
      passedOver: "↳ passed over {model}: {outcome} after {ms}",
      tool: "↳ {label} → {outcome} · {chars} chars",
      promoted: "its text came with the question",
      found: "found on the page",
      notFound: "not found on the page",
      byModel: "{reason} · words by the model",
      byLine: "{reason} · a fixed closing line",
      time: "{total} · first token {ttft}",
      nothing: "nothing removed",
      none: "none",
    },
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
      levelSet: {
        plain: "level plain: answers without jargon, each term explained, short.",
        standard: "level standard: answers as usual.",
        expert: "level expert: answers with technical depth: trade-offs, design choices, numbers.",
      },
      levelUsage: "usage: level plain|standard|expert (now: {level})",
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
        ["level plain|standard|expert", "wie technisch Antworten sind"],
        ["deep <frage>", "das langsamere, gründlichere Modell fragen"],
        ["stats", "Modell, Latenz und Cache unter Antworten zeigen"],
        ["inspect", "wie die letzte Antwort entstand: Schritte und Prüfungen"],
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
    downReason: {
      ask: "Was war falsch?",
      wrong: "falsch oder erfunden",
      unanswered: "hat meine Frage nicht beantwortet",
      length: "zu lang oder zu kurz",
    },
    copy: "kopieren",
    copied: "kopiert",
    updated: "aktualisiert {date}",
    failover: {
      first: "das erste Modell ist ausgelastet, ich versuche ein anderes ({position} von {of})",
      next: "auch dieses ist ausgelastet, ich versuche ein anderes ({position} von {of})",
    },
    receipt: {
      toggle: "wie entstand diese Antwort?",
      inspect: "inspect",
      fast: "schnelles Modell",
      thorough: "gründliches Modell",
      escalated: "zum gründlichen Modell gewechselt: {why}",
      escalation: {
        "projects-fetched": "es hat zwei Projekte gelesen",
        "search-spans-projects": "die Suche betrifft zwei Projekte",
      },
      lookups: { none: "keine Abfragen", one: "1 Abfrage", many: "{n} Abfragen" },
      sources: { none: "nichts zitiert", one: "1 Quelle geprüft", many: "{n} Quellen geprüft" },
      removed: {
        none: "",
        one: "1 erfundener Verweis entfernt",
        many: "{n} erfundene Verweise entfernt",
      },
      careful: "heikles Thema: nur veröffentlichte Fakten",
      page: "Seite: {title}",
      focus: {
        section: "Abschnitt: {label}",
        code: "Codeblock: {label}",
        selection: "Auswahl aus der Seite zitiert",
      },
      focusMissing: {
        section: "Abschnitt nicht auf der Seite gefunden",
        code: "Codeblock nicht auf der Seite gefunden",
        selection: "Auswahl nicht auf der Seite gefunden: als deine Worte gelesen",
      },
      level: "level: {level}",
      repair: {
        "no-words": "repariert: der erste Versuch blieb ohne Text",
        "handoff-without-words": "repariert: der erste Versuch bot die Übergabe ohne Text an",
        echo: "repariert: der erste Versuch wiederholte nur die Frage",
        stub: "repariert: der erste Versuch brach nach ein, zwei Wörtern ab",
        fixed: "mit einer festen Zeile beendet: kein Modell hatte Text",
      },
    },
    inspect: {
      noAnswer: "Noch keine Antwort zum Untersuchen.",
      missing:
        "Zu dieser Antwort ist nichts gespeichert: Sie ist vielleicht älter als 90 Tage oder gelöscht.",
      failed: "Wie diese Antwort entstand, ließ sich gerade nicht laden.",
      head: "inspect {id} · {at} · Prompt {prompt}",
      labels: {
        route: "Route",
        careful: "heikel",
        page: "Seite",
        focus: "Fokus",
        level: "level",
        step: "Schritt {n}",
        cited: "zitiert",
        removed: "entfernt",
        guard: "Ausgabefilter",
        checks: "Prüfungen",
        repair: "Reparatur",
        time: "Zeit",
      },
      reason: "Grund: {reason}",
      moved: "in Schritt {step} zum gründlichen Modell gewechselt: {why}",
      model:
        "{model} · erstes Token {ttft} · {input} rein ({cached} aus dem Cache) · {output} raus",
      noModel: "kein Modell konnte antworten",
      passedOver: "↳ übersprungen {model}: {outcome} nach {ms}",
      tool: "↳ {label} → {outcome} · {chars} Zeichen",
      promoted: "ihr Text kam mit der Frage",
      found: "auf der Seite gefunden",
      notFound: "nicht auf der Seite gefunden",
      byModel: "{reason} · Text vom Modell",
      byLine: "{reason} · eine feste Schlusszeile",
      time: "{total} · erstes Token {ttft}",
      nothing: "nichts entfernt",
      none: "keine",
    },
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
      levelSet: {
        plain: "level plain: Antworten ohne Fachjargon, jeder Begriff erklärt, kurz.",
        standard: "level standard: Antworten wie gewohnt.",
        expert:
          "level expert: Antworten mit technischer Tiefe: Abwägungen, Designentscheidungen, Zahlen.",
      },
      levelUsage: "Verwendung: level plain|standard|expert (jetzt: {level})",
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
