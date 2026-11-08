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
    hint: string;
    sections: string;
    work: string;
    actions: string;
    home: string;
    /** Before what was typed, in the first row: "Ask: …". */
    ask: string;
    /** What changed since the last visit (visitor plan V15). */
    news: string;
    /** The guided tour (visitor plan V16). */
    tour: string;
    close: string;
  };
  breadcrumb: string;
  gallery: { open: string; close: string; previous: string; next: string };
  share: { share: string; copy: string; copied: string; failed: string; idle: ""; on: string };
  contact: {
    sendAnother: string;
    /** Read after the copy button's visible "Copy". */
    copyWhat: string;
    localTime: string;
    /** The opt-in after the assistant's hand-off: off unless ticked. */
    attach: string;
    attachHint: string;
  };
  about: {
    /** The assistant's title bar, once its state is known. */
    online: string;
    resting: string;
    based: string;
    since: string;
    status: string;
  };
  /** A timeline entry's highlights past the third, `{n}` how many. */
  experience: { more: string };
  footer: {
    /** The match page's name, in the footer and the palette. */
    match: string;
    elsewhere: string;
    /** `{angular}` is the framework's major version. */
    colophon: string;
    build: string;
  };
  notFound: { didYouMean: string };
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
  code: { copy: string; copied: string; failed: string; idle: "" };
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
      search: "Ask or search",
      talk: "Let’s talk",
      language: "Language",
      theme: "Theme",
      dark: "Dark",
      light: "Light",
    },
    hero: { localTime: "local time", shippedAt: "Shipped at" },
    palette: {
      title: "Command palette",
      placeholder: "Ask a question or search…",
      hint: "↑↓ to move, Enter to open, Esc to close",
      sections: "Sections",
      work: "Case studies",
      actions: "Actions",
      home: "Home",
      ask: "Ask",
      news: "What's new",
      tour: "Take the tour",
      close: "Close",
    },
    breadcrumb: "Breadcrumb",
    gallery: {
      open: "Open image {i} of {n}",
      close: "Close",
      previous: "Previous image",
      next: "Next image",
    },
    share: {
      share: "Share",
      copy: "Copy link",
      copied: "Link copied",
      failed: "Couldn’t copy",
      idle: "",
      on: "Share on {site}",
    },
    contact: {
      sendAnother: "Send another message",
      copyWhat: "the email address",
      localTime: "local time",
      attach: "Attach my conversation with the assistant",
      attachHint:
        "Your questions and its answers go with your message, with email addresses and phone numbers removed.",
    },
    about: {
      online: "online",
      resting: "resting",
      based: "Based in",
      since: "Shipping since",
      status: "Status",
    },
    experience: { more: "{n} more" },
    footer: {
      match: "Check the fit",
      elsewhere: "Elsewhere",
      colophon:
        "Built with Angular {angular}, Analog and Hono. Server-rendered, fonts self-hosted.",
      build: "Build",
    },
    notFound: { didYouMean: "Did you mean" },
    projectCard: { details: "Details", links: "Project links" },
    caseStudy: { ask: "Ask about {name}", question: "What did he build in {name}, and how?" },
    post: {
      ask: "Ask the assistant about this post",
      question: "What is the post “{title}” about, in short?",
    },
    code: { copy: "Copy", copied: "Copied", failed: "Couldn’t copy", idle: "" },
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
      search: "Fragen oder suchen",
      talk: "Kontakt",
      language: "Sprache",
      theme: "Design",
      dark: "Dunkel",
      light: "Hell",
    },
    hero: { localTime: "Ortszeit", shippedAt: "Gearbeitet bei" },
    palette: {
      title: "Befehlspalette",
      placeholder: "Frage stellen oder suchen…",
      hint: "↑↓ wählen, Enter öffnen, Esc schließen",
      sections: "Bereiche",
      work: "Fallstudien",
      actions: "Aktionen",
      home: "Startseite",
      ask: "Fragen",
      news: "Was ist neu",
      tour: "Führung starten",
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
      failed: "Nicht kopiert",
      idle: "",
      on: "Auf {site} teilen",
    },
    contact: {
      sendAnother: "Weitere Nachricht senden",
      copyWhat: "die E-Mail-Adresse",
      localTime: "Ortszeit",
      attach: "Mein Gespräch mit dem Assistenten anhängen",
      attachHint:
        "Ihre Fragen und seine Antworten werden mit Ihrer Nachricht gesendet, ohne E-Mail-Adressen und Telefonnummern.",
    },
    about: {
      online: "online",
      resting: "pausiert",
      based: "Standort",
      since: "Im Beruf seit",
      status: "Status",
    },
    experience: { more: "{n} weitere" },
    footer: {
      match: "Passt es?",
      elsewhere: "Im Netz",
      colophon:
        "Gebaut mit Angular {angular}, Analog und Hono. Serverseitig gerendert, Schriften selbst gehostet.",
      build: "Build",
    },
    notFound: { didYouMean: "Meinten Sie" },
    projectCard: { details: "Details", links: "Projektlinks" },
    caseStudy: { ask: "Zu {name} fragen", question: "Was hat er bei {name} gebaut – und wie?" },
    post: {
      ask: "Den Assistenten zu diesem Artikel fragen",
      question: "Worum geht es im Artikel „{title}“, kurz gesagt?",
    },
    code: { copy: "Kopieren", copied: "Kopiert", failed: "Nicht kopiert", idle: "" },
  },
};
