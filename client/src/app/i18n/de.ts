import type { AppTranslations } from "./en";

export const de: AppTranslations = {
  profile: {
    role: "Fullstack-KI-Softwareingenieur",
    heroHeadline: "Fullstack-Engineering trifft künstliche Intelligenz.",
    heroSubheadline:
      "Verbindung von zuverlässiger Cloud-Infrastruktur und modernsten Machine-Learning-Methoden für produktionsreife Anwendungen.",
    primaryCta: "Projekte ansehen",
    secondaryCta: "Kontakt aufnehmen",
  },
  nav: {
    skills: "fähigkeiten",
    projects: "projekte",
    about: "über mich",
    contact: "kontakt",
  },
  skills: {
    heading: "// fähigkeiten",
    subtitle: "fähigkeiten · stack",
    cards: [
      {
        title: "Kernarchitektur",
        caption: "// frontend + backend + KI",
        narrative:
          "Ich entwickle reaktive Benutzeroberflächen in Angular und React, die leistungsstarke Python-FastAPI-Backends konsumieren und komplexe Nutzeranfragen nahtlos an fein abgestimmte Sprachmodelle weiterleiten.",
      },
      {
        title: "KI / ML Stack",
        caption: "// datenbank + API + KI",
        narrative:
          "Ich setze PostgreSQL mit pgvector-Erweiterungen und Node.js ein, um blitzschnelle Retrieval-Augmented-Generation-Architekturen zu schaffen, die dem Client präzise, kontextbewusste Daten liefern.",
      },
      {
        title: "DevOps & Cloud",
        caption: "// data + ML + cloud",
        narrative:
          "Durch die Orchestrierung von PyTorch-Modell-Trainingspipelines via Docker und GitHub Actions stelle ich sicher, dass Machine-Learning-Dienste sauber in skalierbare, hochverfügbare Cloud-Umgebungen deployt werden.",
      },
      {
        title: "Datenpipelines",
        caption: "// speicher + streams",
        narrative:
          "Typisierte Schemata, Vektorindizes und asynchrone Queues sorgen dafür, dass Inferenzjobs, Embeddings und Nutzerdaten ohne Engpässe fließen.",
      },
    ],
  },
  about: {
    heading: "// über mich",
    subtitle: "philosophie.txt",
    philosophy:
      "KI-Anwendungen in einem Jupyter-Notebook zu bauen ist einfach – sie in der Produktion stabil zu halten ist schwer. Meine Engineering-Philosophie konzentriert sich auf defensive KI-Integration. Ich behandle Sprachmodelle als leistungsstarke, aber unberechenbare Microservices. Durch strikte semantische Routing-Regeln, Output-Parsing und automatisierte Fallback-Mechanismen bekämpfe ich aktiv Halluzinationen und erzwinge zuverlässige Datenstrukturen. Ich priorisiere die Nutzererfahrung, indem ich Token zum Frontend streame, um Latenz zu kaschieren, und optimiere gleichzeitig Prompt-Payloads sowie semantisches Caching, um die API-Inferenzkosten strikt im Griff zu behalten. Ich schreibe keine Prompts – ich entwickle resiliente Fullstack-Systeme um sie herum.",
    terminalOutputWhoami: "Alireza Rastineh — Fullstack-KI-Softwareingenieur",
    terminalOutputLs: "kernarchitektur/   ki-ml-stack/   devops/   datenpipelines/",
    terminalOutputContact:
      "Offen für Senior-Fullstack- und KI-Engineering-Rollen. Kontaktaufnahme über das Kontaktformular oder direkt per E-Mail.",
  },
  projects: {
    heading: "// projekte",
    subtitle: "fallstudien",
  },
  contact: {
    heading: "// kontakt",
    subtitle: "nachricht_senden()",
    labelName: "name",
    labelEmail: "e-mail",
    labelMessage: "nachricht",
    placeholderName: "Max Mustermann",
    placeholderEmail: "max@beispiel.de",
    placeholderMessage:
      "Erzählen Sie mir vom Projekt, dem Zeitplan und wie 'fertig' aussieht.",
    submit: "> nachricht_senden()",
    sending: "senden…",
    successLine1: "> nachricht_gesendet.",
    successLine2: "antwort innerhalb 24h erwartet. oder per E-Mail",
    errorRequired: "Pflichtfeld.",
    errorEmail: "Ungültige E-Mail-Adresse.",
    errorMinlength: (n: number) => `Mindestens ${n} Zeichen.`,
    errorMaxlength: (n: number) => `Maximal ${n} Zeichen.`,
    errorInvalid: "Ungültig.",
    errorFixFields: "Bitte die markierten Felder korrigieren.",
    errorRateLimited: "Zu viele Anfragen. Bitte in einigen Minuten erneut versuchen.",
    errorInvalidInput: "Formulardaten wurden vom Server abgelehnt.",
    errorMailerUnavailable:
      "E-Mail-Dienst nicht verfügbar. Bitte direkt per E-Mail kontaktieren.",
    errorSendFailed: "Senden fehlgeschlagen. Bitte direkt per E-Mail kontaktieren.",
    errorNetwork: "Netzwerkfehler. Bitte erneut versuchen.",
  },
  projectCard: {
    problem: "PROBLEM",
    arch: "ARCHITEKTUR",
    infra: "INFRASTRUKTUR",
    outcomes: "ERGEBNISSE",
    caseLabel: (i: number) => `fall · 0${i}`,
    live: "live",
    repo: "repo",
    caseStudy: "fallstudie",
    techStackAriaLabel: "Tech-Stack",
  },
};
