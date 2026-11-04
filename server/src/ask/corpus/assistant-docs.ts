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

/**
 * The day the default card's words last changed (visitor plan V21): what it is
 * true as of. `assistant-docs.spec.ts` pins its text, so new words need a new day.
 */
export const SYSTEM_CARD_UPDATED = "2026-11-04";

export function defaultSystemCard(locale: Locale, config: AskConfig): string {
  const primary = config.gemini.model;
  const deep = config.gemini.deepModel;
  const fallbacks = [
    ...(config.gemini.fallbackModel ? [config.gemini.fallbackModel] : []),
    ...config.openrouter.models,
  ].map(shortName);
  const fallbackList = fallbacks.length ? ` (${fallbacks.join(", ")})` : "";

  // Plan phase 33: what Parts C–G added, and the visitor plan's V22: what holds whatever the
  // switches say. No tool name and no line of the instructions belongs here: an answer quoting
  // the card would read as repeating them (answer-patterns.ts). Nor a claim a switch decides
  // (search by meaning, match, the scorecard): the card would say it while it is off, and the
  // eval fixture's card would change with the deploy's environment.
  if (locale === "de") {
    const deepNote = deep ? `; Vergleiche und Architekturfragen gehen an ${deep}` : "";
    return [
      "Dieser Assistent ist in Alireza Rastinehs Portfolio eingebaut. Er beantwortet Fragen zu seiner Arbeit aus den auf dieser Website veröffentlichten Inhalten und nennt zu jeder Aussage die Seite, von der sie stammt.",
      "So funktioniert er:",
      `- Modell: Google Gemini (${primary})${deepNote}. Ist Gemini ausgelastet oder nicht erreichbar, übernimmt ein Ausweichmodell${fallbackList}, bevor Text angezeigt wird.`,
      "- Grundlage: Das veröffentlichte Portfolio (Profil, Werdegang, Projekte, Artikel, Fähigkeiten, Lebenslauf und ein gepflegtes FAQ) geht mit jeder Frage als gleichbleibender Präfix mit, den ein Anbieter zwischenspeichern kann; Such- und Dokument-Werkzeuge liefern Details. Die meisten Dokumente tragen das Datum ihrer letzten Änderung, damit eine Antwort sagen kann, wie aktuell etwas ist.",
      "- Heikle Themen (Gehalt, Visa, Verträge, Gesundheit, Familie, Politik, persönliche Daten) beantwortet er nur mit veröffentlichten Fakten, nie mit Schätzungen; steht nichts dazu im Portfolio, sagt er das und bietet das Kontaktformular an.",
      "- Prüfungen, bevor eine Antwort ankommt: Quellenangaben werden gegen die Inhalte geprüft, und Verweise, die es nicht gibt, werden entfernt; ein Schutz entfernt Passagen, die aus seinen eigenen Anweisungen kopiert sind, und API-Schlüssel der Art, die er selbst nutzt. Kommt eine Antwort ohne eigene Worte zurück, bekommt sie einen zweiten Versuch mit dem, was schon nachgeschlagen wurde; hat auch der keine Worte, sagt eine feste Zeile das. Zahlen in einer Antwort werden mit den zitierten Quellen abgeglichen, und eine, die dort nicht steht, wird für den Betreiber zur Prüfung markiert.",
      "- Schutz: Text von Besuchern gilt als Daten, nie als Anweisung. Die Werkzeuge lesen nur; die einzige Aktion – das Gespräch an das Kontaktformular übergeben – braucht deine Bestätigung, und das Gespräch wird nur angehängt, wenn du das Häkchen setzt. Ratenlimits, ein tägliches Kostenlimit und ein Notschalter begrenzen den Betrieb.",
      "- Qualität: Ein fester Satz von Evaluationsfragen misst jede Version seiner Anweisungen; eine Änderung daran lässt den Build scheitern, bis sie gemessen oder ein Grund festgehalten ist. Automatische Prüfungen laufen bei jeder Antwort. Jede Woche wird eine Zufallsstichprobe der Antworten gezogen, um sie von Hand zu lesen; zusätzlich kann ein Modell jede Nacht eine Stichprobe bewerten. Fehler werden in einem Journal untersucht; Fragen ohne Antwort können zu FAQ-Entwürfen werden, und keiner geht ohne Alirezas Freigabe online.",
      "- Datenschutz: Fragen und die Schritte zu ihrer Beantwortung werden 90 Tage ohne E-Mail-Adressen, Telefonnummern und lange Zahlen protokolliert; IP-Adressen werden nicht gespeichert. Einzelne Fragen kann der Betreiber als Testfall behalten, erst nachdem er bestätigt hat, dass nichts Persönliches mehr darin steht.",
      "- Mitlesen: Auf einer Fallstudie oder einem Artikel weiß er, welche Seite du liest, und kann sie heranziehen. „fragen“ neben einer Überschrift und „Erklären“ neben einem Codeblock schicken diesen Teil mit deiner Frage, genommen aus der veröffentlichten Seite, nie aus deinem Browser; markierter Text zählt nur dann als Teil der Seite, wenn die Seite ihn enthält, sonst als deine eigenen Worte. `level plain|standard|expert` legt fest, wie technisch die Antworten sind, und dein Browser merkt sich die gewählte Stufe.",
      "- Entdecken: `tour` plant eine kurze Führung durch die veröffentlichten Seiten, auf Wunsch zu einem Interesse, das du nennst, und jede Station öffnest du selbst; wo du gerade bist, bleibt nur in diesem Tab. „Weiterlesen“ unter einer Fallstudie oder einem Artikel nennt verwandte Seiten, ermittelt aus den Verweisen zwischen den Seiten, ohne Modell. `news` zeigt, sobald du es einschaltest, was sich seit deinem letzten Besuch geändert hat; das Datum dieses Besuchs kennt nur dein Browser. „teilen“ unter einer Antwort kopiert einen Link mit ihrer Frage: Wer ihn öffnet, findet die Frage in der Eingabe, noch nicht gesendet.",
      "- Was du siehst und steuerst: Unter jeder Antwort steht auf Wunsch, wie sie entstand (welches Modell, wie viele Abfragen, wie viele Quellen geprüft, was entfernt wurde); `inspect` zeigt die Schritte, die das Protokoll von einer deiner Antworten aufbewahrt, ohne Gedanken des Modells und ohne Anweisungstext. Mit `forget` löschst du, was das Protokoll von deinem Gespräch in diesem Tab aufbewahrt, samt deinen Bewertungen; eine Nachricht, die du über das Kontaktformular geschickt hast, behält ihre Kopie, und ein daraus entstandener Testfall bleibt.",
      "- Für KI-Agenten: /llms.txt und die Agent Card unter /.well-known/agent-card.json verweisen andere KI-Werkzeuge auf dieselben veröffentlichten Inhalte; was sie anbieten, liest nur und ruft kein KI-Modell auf.",
      "- Gebaut mit dem Vercel AI SDK auf einer Hono-API, gestreamt in ein Angular-Panel.",
    ].join("\n");
  }

  const deepNote = deep ? `; comparisons and architecture questions go to ${deep}` : "";
  return [
    "This assistant is built into Alireza Rastineh's portfolio. It answers questions about his work from the content published on this site and cites the page each fact comes from.",
    "How it works:",
    `- Model: Google Gemini (${primary})${deepNote}. If Gemini is rate-limited or down, a fallback model${fallbackList} takes over before any text is shown.`,
    "- Grounding: the published portfolio (profile, experience, projects, posts, skills, CV and a curated FAQ) goes with every question as one fixed prefix, the same each time so that a provider can cache it; search and document tools fetch detail. Most documents carry the date they last changed, so an answer can say how current a fact is.",
    "- Sensitive topics (pay, visas, contracts, health, family, politics, personal details) get published facts only, never estimates; when nothing is published, it says so and offers the contact form.",
    "- Checks before an answer reaches you: citations are matched against the content, and references that do not exist are removed; a guard removes passages copied from its own instructions, and API keys of the kinds it uses. An answer that comes back without words of its own gets a second try with what was already looked up; if that has none either, a fixed line says so. Figures in an answer are matched against the sources it cites, and one that is not in them is flagged for the owner to review.",
    "- Guardrails: visitor text is treated as data, never as instructions. The tools only read; the one action, handing the conversation to the contact form, needs your confirmation, and the conversation is attached only if you tick the box. Rate limits, a daily cost cap and a kill switch keep it bounded.",
    "- Quality: a fixed set of evaluation questions measures each version of its instructions, and a change to them fails the build until it is measured or a reason is recorded; automatic checks run on every answer. Each week a random sample of answers is drawn to be read by hand, and a model can also score a nightly sample. Failures are diagnosed in a journal; unanswered questions can become FAQ drafts, and none goes live without Alireza's approval.",
    "- Privacy: questions and the steps taken to answer them are logged for 90 days with emails, phone numbers and long numbers removed; IP addresses are not stored. The owner may keep a question as a test case, only after confirming that nothing personal is left in it.",
    "- Reading with you: on a case study or a post, it knows which page you are reading and can draw on it. “ask” beside a heading and “Explain” beside a code block send that part with your question, taken from the published page, never from your browser; text you select counts as the page's only where the page holds it, otherwise as your own words. `level plain|standard|expert` sets how technical the answers are, and your browser remembers the level you chose.",
    "- Exploring: `tour` plans a short guided tour of the published pages, for an interest if you name one, and you open each stop yourself; where you are in it is kept in this tab only. “Read next” under a case study or a post lists related pages, worked out from the links between the pages, without a model. `news`, once you turn it on, lists what changed since your last visit, and only your browser keeps the date of that visit. “share” under an answer copies a link carrying its question: whoever opens it finds the question in the prompt, not sent.",
    "- What you can see and control: each answer can show how it was made (which model, how many lookups, how many sources checked, anything removed), and `inspect` shows the steps the log keeps of one of your answers, with no thoughts of the model and no instruction text. With `forget` you delete what the log keeps of your conversation in this tab, your ratings included; a message you sent through the contact form keeps its copy, and a test case made from it stays.",
    "- For AI agents: /llms.txt and the agent card at /.well-known/agent-card.json point other AI tools to the same published content; what they offer only reads and calls no AI model.",
    "- Built with the Vercel AI SDK on a Hono API, streamed into an Angular panel.",
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
        // When this language's words last changed (plan phase 19): what it is true as of.
        ...((t.updatedAt ?? entry.updatedAt)
          ? { updated: (t.updatedAt ?? entry.updatedAt).slice(0, 10) }
          : {}),
      });
    }
    const own = settings.systemCard[locale].trim();
    documents.push({
      id: `system-card@${locale}`,
      kind: "system-card",
      locale,
      title: locale === "de" ? "Wie dieser Assistent funktioniert" : "How this assistant works",
      url: `/${locale}#about`,
      text: own || defaultSystemCard(locale, config),
      // The admin's card is as of the save that holds it, as a publish dates the profile.
      updated: own && settings.updatedAt ? settings.updatedAt.slice(0, 10) : SYSTEM_CARD_UPDATED,
    });
  }
  return documents;
}
