import type { Locale } from "../../content/schema.js";
import { LOCALES } from "../../content/schema.js";
import type { AskConfig } from "../config.js";
import { shortName } from "../models/registry.js";
import type { AiSettings, FaqEntry } from "../settings.js";
import type { CorpusDocument } from "./build.js";

/**
 * The assistant's own documents: the curated FAQ and the "system card" that
 * answers "how do you work?". Written in the admin and live on save.
 */

/** Short and stable, so citations stay cheap: `faq:3f2a9c1b@en`. */
export function faqDocId(id: string, locale: Locale): string {
  return `faq:${id.replaceAll("-", "").slice(0, 8)}@${locale}`;
}

export function defaultSystemCard(locale: Locale, config: AskConfig): string {
  const primary = config.gemini.model;
  const deep = config.gemini.deepModel;
  const fallbacks = [
    ...(config.gemini.fallbackModel ? [config.gemini.fallbackModel] : []),
    ...config.openrouter.models,
  ].map(shortName);
  const fallbackList = fallbacks.length ? ` (${fallbacks.join(", ")})` : "";

  if (locale === "de") {
    const deepNote = deep ? `; Vergleiche und Architekturfragen gehen an ${deep}` : "";
    return [
      "Dieser Assistent ist in Alireza Rastinehs Portfolio eingebaut. Er beantwortet Fragen zu seiner Arbeit aus den auf dieser Website veröffentlichten Inhalten und nennt zu jeder Aussage die Seite, von der sie stammt.",
      "So funktioniert er:",
      `- Modell: Google Gemini (${primary})${deepNote}. Ist Gemini ausgelastet oder nicht erreichbar, übernimmt ein Ausweichmodell${fallbackList}, bevor Text angezeigt wird.`,
      "- Grundlage: Das veröffentlichte Portfolio (Profil, Werdegang, Projekte, Artikel, Fähigkeiten, Lebenslauf und ein gepflegtes FAQ) geht mit jeder Frage als gleichbleibender Präfix mit, den der Anbieter zwischenspeichert; Such- und Dokument-Werkzeuge liefern Details.",
      "- Quellenangaben werden gegen diese Inhalte geprüft; Verweise, die es nicht gibt, werden entfernt, bevor die Antwort ankommt.",
      "- Schutz: Text von Besuchern gilt als Daten, nie als Anweisung. Die Werkzeuge lesen nur; die einzige Aktion – das Gespräch an das Kontaktformular übergeben – braucht deine Bestätigung. Ratenlimits, ein tägliches Kostenlimit und ein Notschalter begrenzen den Betrieb.",
      "- Datenschutz: Fragen werden 90 Tage ohne E-Mail-Adressen und Telefonnummern protokolliert; IP-Adressen werden nicht gespeichert.",
      "- Gebaut mit dem Vercel AI SDK auf einer Hono-API, gestreamt in ein Angular-Terminal.",
    ].join("\n");
  }

  const deepNote = deep ? `; comparisons and architecture questions go to ${deep}` : "";
  return [
    "This assistant is built into Alireza Rastineh's portfolio. It answers questions about his work from the content published on this site and cites the page each fact comes from.",
    "How it works:",
    `- Model: Google Gemini (${primary})${deepNote}. If Gemini is rate-limited or down, a fallback model${fallbackList} takes over before any text is shown.`,
    "- Grounding: the published portfolio (profile, experience, projects, posts, skills, CV and a curated FAQ) goes with every question as one fixed prefix, which the provider caches; search and document tools fetch detail.",
    "- Citations are checked against that content; references that do not exist are removed before the answer reaches you.",
    "- Guardrails: visitor text is treated as data, never as instructions. The tools only read; the one action, handing the conversation to the contact form, needs your confirmation. Rate limits, a daily cost cap and a kill switch keep it bounded.",
    "- Privacy: questions are logged for 90 days with emails and phone numbers removed; IP addresses are not stored.",
    "- Built with the Vercel AI SDK on a Hono API, streamed into an Angular terminal.",
  ].join("\n");
}

export function assistantDocuments(
  settings: AiSettings,
  faq: FaqEntry[],
  config: AskConfig,
): CorpusDocument[] {
  const documents: CorpusDocument[] = [];
  for (const locale of LOCALES) {
    for (const entry of faq) {
      const t = entry.translations[locale];
      if (!t) continue;
      documents.push({
        id: faqDocId(entry.id, locale),
        kind: "faq",
        locale,
        title: t.question,
        url: `/${locale}#about`,
        text: `Q: ${t.question}\nA: ${t.answer}`,
      });
    }
    documents.push({
      id: `system-card@${locale}`,
      kind: "system-card",
      locale,
      title: locale === "de" ? "Wie dieser Assistent funktioniert" : "How this assistant works",
      url: `/${locale}#about`,
      text: settings.systemCard[locale].trim() || defaultSystemCard(locale, config),
    });
  }
  return documents;
}
