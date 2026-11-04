import type { AppTranslations, Locale } from "./schema.js";

/**
 * The copy content model v2 added to the `ui` tree, in both languages, and
 * the optional keys added since.
 *
 * Two jobs: the boot backfill merges it into the stored `ui` documents (filling
 * only keys that are missing, so nothing edited in the admin is overwritten),
 * and `upcast` merges it into v1 snapshots so they parse as v2.
 */
type Additions = Pick<
  AppTranslations,
  "hero" | "experience" | "writing" | "caseStudy" | "legal" | "notFound" | "ask"
> & {
  nav: Pick<AppTranslations["nav"], "work" | "experience" | "writing">;
  about: Required<Pick<AppTranslations["about"], "bio">>;
  contact: Required<Pick<AppTranslations["contact"], "replyTime">>;
};

export const UI_V2_ADDITIONS: Record<Locale, Additions> = {
  en: {
    nav: { work: "Work", experience: "Experience", writing: "Writing" },
    // Empty until written in the admin: a bio is the owner's own words.
    about: { bio: "" },
    // The same promise as `caseStudy.ctaBody`.
    contact: { replyTime: "I reply within 24 hours." },
    hero: {
      availabilityOpen: "Open to senior AI / full-stack roles",
      availabilityLimited: "Limited availability",
      availabilityClosed: "Not available for new work",
      downloadCv: "Download CV",
      askCta: "Ask about my work",
    },
    experience: {
      heading: "Experience",
      subtitle: "Work, education, certifications",
      work: "Work",
      education: "Education",
      certifications: "Certifications",
      present: "Present",
      credential: "Show credential",
      years: "{n} yr",
      months: "{n} mo",
      fullTime: "Full-time",
      partTime: "Part-time",
      contract: "Contract",
      freelance: "Freelance",
      internship: "Internship",
    },
    writing: {
      heading: "Writing",
      subtitle: "Notes from production",
      readingTime: "{n} min read",
      allPosts: "All posts",
      empty: "Nothing published yet.",
      rss: "RSS feed",
      published: "Published",
      updated: "Updated",
      tags: "Tags",
    },
    caseStudy: {
      allWork: "All work",
      readCaseStudy: "Read case study",
      role: "Role",
      period: "Period",
      category: "Category",
      metrics: "Results",
      gallery: "Gallery",
      toc: "On this page",
      previous: "Previous project",
      next: "Next project",
      ctaHeading: "Building something similar?",
      ctaBody: "Tell me what you are working on — I reply within 24 hours.",
      ctaButton: "Discuss a similar project",
    },
    legal: { nav: "Legal", imprint: "Imprint", privacy: "Privacy", updated: "Last updated" },
    notFound: {
      title: "This page isn’t here.",
      body: "It may have moved, or the link is wrong.",
      home: "Back to the homepage",
    },
    ask: {
      title: "Ask about my work",
      hint: "Best for questions about projects, experience, skills and availability.",
      placeholder: "Ask a question…",
      disclosure: "Answers come from an AI, using this site’s content.",
      offline: "The assistant is resting. Please use the contact form.",
    },
  },
  de: {
    nav: { work: "Projekte", experience: "Werdegang", writing: "Artikel" },
    about: { bio: "" },
    contact: { replyTime: "Ich antworte innerhalb von 24 Stunden." },
    hero: {
      availabilityOpen: "Offen für Senior-Rollen in AI / Full-Stack",
      availabilityLimited: "Eingeschränkt verfügbar",
      availabilityClosed: "Derzeit keine neuen Projekte",
      downloadCv: "Lebenslauf herunterladen",
      askCta: "Fragen zu meiner Arbeit",
    },
    experience: {
      heading: "Werdegang",
      subtitle: "Beruf, Ausbildung, Zertifikate",
      work: "Beruf",
      education: "Ausbildung",
      certifications: "Zertifikate",
      present: "Heute",
      credential: "Nachweis ansehen",
      years: "{n} J.",
      months: "{n} Mon.",
      fullTime: "Vollzeit",
      partTime: "Teilzeit",
      contract: "Vertrag",
      freelance: "Freiberuflich",
      internship: "Praktikum",
    },
    writing: {
      heading: "Artikel",
      subtitle: "Notizen aus der Praxis",
      readingTime: "{n} Min. Lesezeit",
      allPosts: "Alle Artikel",
      empty: "Noch nichts veröffentlicht.",
      rss: "RSS-Feed",
      published: "Veröffentlicht",
      updated: "Aktualisiert",
      tags: "Themen",
    },
    caseStudy: {
      allWork: "Alle Projekte",
      readCaseStudy: "Fallstudie lesen",
      role: "Rolle",
      period: "Zeitraum",
      category: "Kategorie",
      metrics: "Ergebnisse",
      gallery: "Galerie",
      toc: "Auf dieser Seite",
      previous: "Vorheriges Projekt",
      next: "Nächstes Projekt",
      ctaHeading: "Sie planen etwas Ähnliches?",
      ctaBody: "Erzählen Sie mir, woran Sie arbeiten — ich antworte innerhalb von 24 Stunden.",
      ctaButton: "Ähnliches Projekt besprechen",
    },
    legal: { nav: "Rechtliches", imprint: "Impressum", privacy: "Datenschutz", updated: "Stand" },
    notFound: {
      title: "Diese Seite gibt es nicht.",
      body: "Vielleicht ist sie umgezogen, oder der Link stimmt nicht.",
      home: "Zur Startseite",
    },
    ask: {
      title: "Fragen zu meiner Arbeit",
      hint: "Am besten für Fragen zu Projekten, Erfahrung, Fähigkeiten und Verfügbarkeit.",
      placeholder: "Eine Frage stellen…",
      disclosure: "Die Antworten erzeugt eine KI aus den Inhalten dieser Website.",
      offline: "Der Assistent pausiert. Bitte nutzen Sie das Kontaktformular.",
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `defaults` under `value`: every key `value` already has wins, at any depth;
 * only missing keys are filled. A non-object `value` is replaced wholesale.
 */
export function fillMissing(value: unknown, defaults: unknown): unknown {
  if (!isRecord(defaults)) return value === undefined ? defaults : value;
  if (!isRecord(value)) return structuredClone(defaults);

  const out: Record<string, unknown> = { ...value };
  for (const [key, fallback] of Object.entries(defaults)) {
    out[key] = fillMissing(value[key], fallback);
  }
  return out;
}

/** A stored or v1 `ui` tree with every v2 key present. */
export function withUiDefaults(ui: unknown, locale: Locale): unknown {
  return fillMissing(ui, UI_V2_ADDITIONS[locale]);
}
