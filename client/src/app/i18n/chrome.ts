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
  contact: { sendAnother: string };
  about: { skip: string; skipLabel: string };
  projectCard: { details: string; links: string };
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
    },
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
    contact: { sendAnother: "Send another message" },
    about: { skip: "skip", skipLabel: "show the whole text" },
    projectCard: { details: "Details", links: "Project links" },
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
    },
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
    contact: { sendAnother: "Weitere Nachricht senden" },
    about: { skip: "überspringen", skipLabel: "ganzen Text anzeigen" },
    projectCard: { details: "Details", links: "Projektlinks" },
  },
};
