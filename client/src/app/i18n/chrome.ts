import type { Locale } from "../content/locale";

/**
 * Interface chrome: landmark names, control labels, screen-reader text. Not
 * content, so not in the CMS, and kept here in one place rather than per
 * component. (A new `ui` key would also break the live content until the next
 * publish — see the Phase 5 handoff — so words a visitor reads as content
 * belong in the CMS, and only these stay in code.)
 */
export interface ChromeLabels {
  header: {
    home: string;
    primary: string;
    mobile: string;
    menu: string;
    /** The other language's name, for the switch. */
    switchTo: string;
    skip: string;
    toLight: string;
    toDark: string;
    search: string;
    /** The header's call to action, to the contact section. */
    talk: string;
    language: string;
    theme: string;
    dark: string;
    light: string;
  };
  hero: {
    /** Read before the visitor's local time in the status line. */
    localTime: string;
    shippedAt: string;
  };
  palette: {
    title: string;
    placeholder: string;
    empty: string;
    hint: string;
    sections: string;
    work: string;
    actions: string;
    home: string;
    ask: string;
    close: string;
  };
  breadcrumb: string;
  gallery: { open: string; close: string; previous: string; next: string };
  share: { share: string; copy: string; copied: string; on: string };
  contact: {
    sendAnother: string;
    email: string;
    /** Read after the copy button's visible "Copy". */
    copyWhat: string;
    elsewhere: string;
    localTime: string;
    /** The opt-in after the assistant's hand-off: off unless ticked. */
    attach: string;
    attachHint: string;
  };
  about: {
    skip: string;
    skipLabel: string;
    /** The terminal's title bar, once the assistant's state is known. */
    online: string;
    resting: string;
    based: string;
    since: string;
    status: string;
  };
  /** A timeline entry's highlights past the third, `{n}` how many. */
  experience: { more: string };
  footer: {
    /** A shell comment after `exit`. */
    signOff: string;
    elsewhere: string;
    /** `{angular}` is the framework's major version. */
    colophon: string;
    build: string;
  };
  notFound: { command: string; didYouMean: string };
  projectCard: { details: string; links: string };
  caseStudy: {
    /** The end block's action, `{name}` the project's. */
    ask: string;
    /** What that action asks the assistant. */
    question: string;
  };
  /** A post's footer action (pages/[locale]/writing/[slug].page.ts). */
  post: {
    ask: string;
    /** What it asks the assistant, `{title}` the post's. */
    question: string;
  };
  /** A code block's copy button (components/prose-body.component.ts). */
  code: { copy: string; copied: string };
}

export const CHROME: Record<Locale, ChromeLabels> = {
  en: {
    header: {
      home: "Home",
      primary: "Primary",
      mobile: "Mobile",
      menu: "Toggle navigation",
      switchTo: "Deutsch",
      skip: "Skip to content",
      toLight: "Switch to the light theme",
      toDark: "Switch to the dark theme",
      search: "Search the site",
      talk: "Let's talk",
      language: "Language",
      theme: "Theme",
      dark: "Dark",
      light: "Light",
    },
    hero: { localTime: "local time", shippedAt: "Shipped at" },
    palette: {
      title: "Command palette",
      placeholder: "Search pages, or run a command…",
      empty: "Nothing matches.",
      hint: "↑↓ to move · ↵ to open · esc to close",
      sections: "Sections",
      work: "Case studies",
      actions: "Actions",
      home: "Home",
      ask: "Ask AI…",
      close: "Close",
    },
    breadcrumb: "Breadcrumb",
    gallery: {
      open: "Open image {i} of {n}",
      close: "Close",
      previous: "Previous image",
      next: "Next image",
    },
    share: { share: "Share", copy: "Copy link", copied: "Link copied", on: "Share on {site}" },
    contact: {
      sendAnother: "Send another message",
      email: "Email",
      copyWhat: "the email address",
      elsewhere: "Elsewhere",
      localTime: "local time",
      attach: "Attach my conversation with the assistant",
      attachHint:
        "Your questions and its answers go with your message, with email addresses and phone numbers removed.",
    },
    about: {
      skip: "skip",
      skipLabel: "show the whole text",
      online: "online",
      resting: "resting",
      based: "Based in",
      since: "Shipping since",
      status: "Status",
    },
    experience: { more: "{n} more" },
    footer: {
      signOff: "thanks for reading",
      elsewhere: "Elsewhere",
      colophon:
        "Built with Angular {angular}, Analog and Hono. Server-rendered, fonts self-hosted.",
      build: "build",
    },
    notFound: { command: "command not found", didYouMean: "Did you mean" },
    projectCard: { details: "Details", links: "Project links" },
    caseStudy: { ask: "Ask about {name}", question: "What did he build in {name}, and how?" },
    post: {
      ask: "Ask the assistant about this post",
      question: "What is the post “{title}” about, in short?",
    },
    code: { copy: "Copy", copied: "Copied" },
  },
  de: {
    header: {
      home: "Startseite",
      primary: "Hauptnavigation",
      mobile: "Mobil",
      menu: "Navigation umschalten",
      switchTo: "English",
      skip: "Zum Inhalt springen",
      toLight: "Zum hellen Design wechseln",
      toDark: "Zum dunklen Design wechseln",
      search: "Website durchsuchen",
      talk: "Lass uns reden",
      language: "Sprache",
      theme: "Design",
      dark: "Dunkel",
      light: "Hell",
    },
    hero: { localTime: "Ortszeit", shippedAt: "Gearbeitet bei" },
    palette: {
      title: "Befehlspalette",
      placeholder: "Seiten suchen oder Befehl ausführen…",
      empty: "Keine Treffer.",
      hint: "↑↓ wählen · ↵ öffnen · esc schließen",
      sections: "Bereiche",
      work: "Fallstudien",
      actions: "Aktionen",
      home: "Startseite",
      ask: "KI fragen…",
      close: "Schließen",
    },
    breadcrumb: "Brotkrümelnavigation",
    gallery: {
      open: "Bild {i} von {n} öffnen",
      close: "Schließen",
      previous: "Vorheriges Bild",
      next: "Nächstes Bild",
    },
    share: {
      share: "Teilen",
      copy: "Link kopieren",
      copied: "Link kopiert",
      on: "Auf {site} teilen",
    },
    contact: {
      sendAnother: "Weitere Nachricht senden",
      email: "E-Mail",
      copyWhat: "die E-Mail-Adresse",
      elsewhere: "Im Netz",
      localTime: "Ortszeit",
      attach: "Mein Gespräch mit dem Assistenten anhängen",
      attachHint:
        "Deine Fragen und seine Antworten gehen mit deiner Nachricht mit, ohne E-Mail-Adressen und Telefonnummern.",
    },
    about: {
      skip: "überspringen",
      skipLabel: "ganzen Text anzeigen",
      online: "online",
      resting: "pausiert",
      based: "Standort",
      since: "Im Beruf seit",
      status: "Status",
    },
    experience: { more: "{n} weitere" },
    footer: {
      signOff: "danke fürs Lesen",
      elsewhere: "Im Netz",
      colophon:
        "Gebaut mit Angular {angular}, Analog und Hono. Serverseitig gerendert, Schriften selbst gehostet.",
      build: "Build",
    },
    notFound: { command: "Befehl nicht gefunden", didYouMean: "Meinten Sie" },
    projectCard: { details: "Details", links: "Projektlinks" },
    caseStudy: { ask: "Zu {name} fragen", question: "Was hat er bei {name} gebaut – und wie?" },
    post: {
      ask: "Den Assistenten zu diesem Artikel fragen",
      question: "Worum geht es im Artikel „{title}“, kurz gesagt?",
    },
    code: { copy: "Kopieren", copied: "Kopiert" },
  },
};
