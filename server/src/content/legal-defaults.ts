import type { LegalDoc, Locale } from "./schema.js";

/**
 * The first Impressum and Datenschutzerklärung, as sanitized rich text. A DRAFT
 * written from what this site actually does (hosting, logs, contact form,
 * Umami, Sentry, the AI assistant, one cookie): the operator must review it, and it is not legal
 * advice. It seeds the editable `imprint`/`privacy` documents once; after that
 * the admin's legal editor owns the text.
 *
 * Also what a snapshot published before v2 shows for its legal pages, which
 * v1 did not carry — a rollback must never take the imprint offline.
 *
 * § 5 DDG requires a postal address at which the operator can be served; add
 * it in the admin (Legal → Imprint) before relying on this.
 */

const OPERATOR = "Alireza Rastineh";
const EMAIL = "contact@alirezarastineh.me";

interface Section {
  heading: string;
  paragraphs: string[];
}

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function html(sections: Section[]): string {
  return sections
    .map((s) => {
      const paragraphs = s.paragraphs.map((p) => `<p>${escape(p)}</p>`).join("");
      return `<h2>${escape(s.heading)}</h2>${paragraphs}`;
    })
    .join("");
}

export interface LegalDefault {
  title: string;
  body: string;
}

export const LEGAL_DEFAULTS: Record<Locale, Record<LegalDoc, LegalDefault>> = {
  de: {
    imprint: {
      title: "Impressum",
      body: html([
        { heading: "Angaben gemäß § 5 DDG", paragraphs: [OPERATOR] },
        { heading: "Kontakt", paragraphs: [`E-Mail: ${EMAIL}`] },
        { heading: "Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV", paragraphs: [OPERATOR] },
      ]),
    },
    privacy: {
      title: "Datenschutzerklärung",
      body: html([
        {
          heading: "Verantwortlicher",
          paragraphs: [
            `Verantwortlich für die Datenverarbeitung auf dieser Website ist ${OPERATOR}, E-Mail: ${EMAIL}.`,
          ],
        },
        {
          heading: "Hosting und Server-Logfiles",
          paragraphs: [
            "Diese Website läuft auf einem Server der Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, in einem Rechenzentrum in Nürnberg.",
            "Bei jedem Aufruf speichert der Webserver automatisch: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Referrer, Browser und Betriebssystem (User-Agent) sowie den Statuscode der Antwort. Diese Daten dienen dem sicheren Betrieb und der Fehlersuche und werden nach 14 Tagen gelöscht.",
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; mein berechtigtes Interesse ist ein sicherer und funktionierender Betrieb der Website.",
          ],
        },
        {
          heading: "Kontaktformular",
          paragraphs: [
            "Wenn Sie mir über das Kontaktformular schreiben, speichere ich Ihren Namen, Ihre E-Mail-Adresse, Ihre Nachricht und die Sprache der Seite, um Ihre Anfrage zu beantworten. Zum Schutz vor Missbrauch speichere ich außerdem einen gesalzenen Hashwert Ihrer IP-Adresse, aus dem sich die Adresse nicht zurückrechnen lässt – nicht die Adresse selbst.",
            "Die Nachricht wird mir über den E-Mail-Dienst Resend (Resend, Inc., USA) zugestellt. Dabei werden Name, E-Mail-Adresse und Nachricht in die USA übermittelt; die Übermittlung ist durch die Standardvertragsklauseln der EU-Kommission abgesichert.",
            "Gespeicherte Nachrichten werden nach spätestens 180 Tagen gelöscht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, soweit Ihre Anfrage auf einen Vertrag zielt, im Übrigen Art. 6 Abs. 1 lit. f DSGVO.",
          ],
        },
        {
          heading: "Portfolio-Assistent (KI)",
          paragraphs: [
            "Im Bereich „Über mich“ können Sie einem KI-Assistenten Fragen zu meiner Arbeit stellen. Die Antworten werden von einem Sprachmodell aus den Inhalten dieser Website erzeugt; sie können Fehler enthalten. Bitte geben Sie dort keine personenbezogenen Daten ein.",
            "Für eine Antwort werden Ihre Frage, die vorigen Fragen und Antworten desselben Gesprächs und die Sprache der Seite an Google (Gemini API; Google Ireland Ltd. bzw. Google LLC, USA) übermittelt; ist Google nicht erreichbar, an OpenRouter (OpenRouter, Inc., USA) und den dort ausgewählten Modellanbieter. Eine Übermittlung in die USA ist dabei möglich; sie ist durch die Standardvertragsklauseln der EU-Kommission bzw. das EU-US Data Privacy Framework abgesichert.",
            "Ich speichere Frage und Antwort 90 Tage, um den Assistenten zu verbessern – vorher werden E-Mail-Adressen, Telefonnummern und lange Ziffernfolgen entfernt. IP-Adressen speichere ich nicht; zur Begrenzung der Anfragen dient ein gesalzener Hashwert, der nach einem Tag gelöscht wird. Das Gespräch selbst liegt nur im Sitzungsspeicher Ihres Browsers (sessionStorage) und wird gelöscht, wenn Sie den Tab schließen; das ist für die von Ihnen genutzte Funktion erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).",
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; mein berechtigtes Interesse ist, Fragen zu meiner Arbeit direkt beantworten zu können. Übergeben Sie ein Gespräch an das Kontaktformular, gilt der Abschnitt „Kontaktformular“.",
          ],
        },
        {
          heading: "Reichweitenmessung mit Umami",
          paragraphs: [
            "Um zu verstehen, welche Seiten gelesen werden, nutze ich Umami. Es läuft auf meinem eigenen Server; es werden keine Daten an Dritte weitergegeben. Umami setzt keine Cookies und speichert keine IP-Adressen. Erfasst werden nur zusammengefasste Angaben: aufgerufene Seite, Referrer, Browser, Betriebssystem, Gerätetyp und Land.",
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; mein berechtigtes Interesse ist, die Website anhand ihrer Nutzung zu verbessern.",
          ],
        },
        {
          heading: "Fehlerüberwachung mit Sentry",
          paragraphs: [
            "Tritt ein technischer Fehler auf, wird ein Fehlerbericht an Sentry (Functional Software, Inc., USA) gesendet und in der EU (Frankfurt) gespeichert. Er enthält die Fehlermeldung, die betroffene Seite sowie Browser und Betriebssystem; IP-Adressen werden nicht gespeichert. Da Sentry ein US-Unternehmen ist, ist ein Zugriff aus den USA nicht ausgeschlossen; er ist durch die Standardvertragsklauseln der EU-Kommission abgesichert.",
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; mein berechtigtes Interesse ist eine fehlerfreie Website.",
          ],
        },
        {
          heading: "Cookies",
          paragraphs: [
            "Wechseln Sie die Sprache, setzt diese Website ein Cookie namens „portfolio-lang“. Es speichert nur die gewählte Sprache, damit Sie beim nächsten Besuch die passende Sprachversion sehen, und läuft nach einem Jahr ab. Es ist für diese von Ihnen gewünschte Funktion erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Weitere Cookies setzt nur der Verwaltungsbereich, und nur für den Betreiber.",
          ],
        },
        {
          heading: "Ihre Rechte",
          paragraphs: [
            `Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20) sowie das Recht, einer Verarbeitung auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO zu widersprechen (Art. 21). Schreiben Sie dazu an ${EMAIL}.`,
            "Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren, etwa bei der Behörde Ihres Wohnorts.",
          ],
        },
      ]),
    },
  },
  en: {
    imprint: {
      title: "Imprint",
      body: html([
        {
          heading: "Information under § 5 DDG (German Digital Services Act)",
          paragraphs: [OPERATOR],
        },
        { heading: "Contact", paragraphs: [`Email: ${EMAIL}`] },
        { heading: "Responsible for content under § 18(2) MStV", paragraphs: [OPERATOR] },
      ]),
    },
    privacy: {
      title: "Privacy policy",
      body: html([
        {
          heading: "Controller",
          paragraphs: [
            `The controller for data processing on this website is ${OPERATOR}, email: ${EMAIL}.`,
          ],
        },
        {
          heading: "Hosting and server logs",
          paragraphs: [
            "This website runs on a server of Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Germany, in a data centre in Nuremberg.",
            "For every request the web server automatically records: IP address, date and time, the address requested, the referrer, browser and operating system (user agent) and the response status. This is used to keep the site secure and to fix faults, and is deleted after 14 days.",
            "The legal basis is Art. 6(1)(f) GDPR; my legitimate interest is operating the website securely and reliably.",
          ],
        },
        {
          heading: "Contact form",
          paragraphs: [
            "When you write to me through the contact form, I store your name, email address, message and the page language in order to reply. To prevent abuse I also store a salted hash of your IP address, from which the address cannot be recovered — not the address itself.",
            "The message is delivered to me by the email service Resend (Resend, Inc., USA), which transfers your name, email address and message to the USA. The transfer is safeguarded by the European Commission's standard contractual clauses.",
            "Stored messages are deleted after 180 days at the latest. The legal basis is Art. 6(1)(b) GDPR where your enquiry concerns a contract, otherwise Art. 6(1)(f) GDPR.",
          ],
        },
        {
          heading: "Portfolio assistant (AI)",
          paragraphs: [
            "In the About section you can ask an AI assistant about my work. Its answers are generated by a language model from the content of this website and may contain mistakes. Please do not enter personal data there.",
            "To answer, your question, the earlier questions and answers of the same conversation and the page language are sent to Google (Gemini API; Google Ireland Ltd. or Google LLC, USA); if Google is unavailable, to OpenRouter (OpenRouter, Inc., USA) and the model provider it selects. This may involve a transfer to the USA, safeguarded by the European Commission's standard contractual clauses or the EU-US Data Privacy Framework.",
            "I keep the question and answer for 90 days to improve the assistant, with email addresses, phone numbers and long digit sequences removed first. I do not store IP addresses; requests are limited using a salted hash that is deleted after one day. The conversation itself stays in your browser's session storage and is deleted when you close the tab; this is required for the function you are using (§ 25(2) no. 2 TDDDG).",
            "The legal basis is Art. 6(1)(f) GDPR; my legitimate interest is answering questions about my work directly. If you hand a conversation to the contact form, the section on the contact form applies.",
          ],
        },
        {
          heading: "Analytics with Umami",
          paragraphs: [
            "To understand which pages are read, I use Umami. It runs on my own server; no data is shared with third parties. Umami sets no cookies and stores no IP addresses. It records only aggregate information: the page visited, referrer, browser, operating system, device type and country.",
            "The legal basis is Art. 6(1)(f) GDPR; my legitimate interest is improving the website based on how it is used.",
          ],
        },
        {
          heading: "Error monitoring with Sentry",
          paragraphs: [
            "If a technical error occurs, an error report is sent to Sentry (Functional Software, Inc., USA) and stored in the EU (Frankfurt). It contains the error message, the page concerned, and the browser and operating system; IP addresses are not stored. As Sentry is a US company, access from the USA cannot be ruled out; it is safeguarded by the European Commission's standard contractual clauses.",
            "The legal basis is Art. 6(1)(f) GDPR; my legitimate interest is a website that works.",
          ],
        },
        {
          heading: "Cookies",
          paragraphs: [
            "When you switch language, this website sets one cookie, “portfolio-lang”. It stores only the language you chose, so your next visit opens in that language, and expires after one year. It is required for this function you asked for (§ 25(2) no. 2 TDDDG). Other cookies are set only by the admin area, and only for the site owner.",
          ],
        },
        {
          heading: "Your rights",
          paragraphs: [
            `You have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18) and data portability (Art. 20), and the right to object to processing based on Art. 6(1)(f) GDPR (Art. 21). Write to ${EMAIL} to exercise them.`,
            "You may also lodge a complaint with a data protection supervisory authority, for example the one where you live.",
          ],
        },
      ]),
    },
  },
};

/** When the bundled draft was written; the "last updated" of a v1 snapshot's legal pages. */
export const LEGAL_DEFAULTS_UPDATED_AT = "2026-09-22T00:00:00.000Z";
