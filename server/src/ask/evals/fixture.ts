import type { AskConfig } from "../config.js";
import type { Corpus, CorpusDocument } from "../corpus/build.js";
import { assembleCorpus, type AskCorpus } from "../corpus/index.js";
import { DEFAULT_SETTINGS, type FaqEntry } from "../settings.js";

/**
 * The frozen corpus the evals run against: a small sample portfolio with
 * fixed facts, so a prompt or model change is measured on the same ground
 * every time. Employers and numbers here are fixtures, not claims about
 * anyone; cases that depend on them are marked `fixtureOnly` and skipped
 * when the suite runs against the live corpus (`--corpus live`).
 */

const doc = (d: CorpusDocument) => d;

const documents: CorpusDocument[] = [
  doc({
    id: "profile@en",
    kind: "profile",
    locale: "en",
    title: "Alireza Rastineh",
    url: "/en",
    text: [
      "Alireza Rastineh (@alirezarastineh) — Senior AI / Full-Stack Engineer",
      "I ship AI systems that survive production.",
      "Eight years building products end to end; the last four on LLM features that real users depend on.",
      "Defensive AI: evaluations before prompts ship, streaming everywhere, caching and fallbacks by default.",
      "Availability: open",
      "Location: Berlin, DE",
      "Time zone: Europe/Berlin",
      "Contact: hello@alirezarastineh.me",
      "GitHub: https://github.com/alirezarastineh",
    ].join("\n"),
  }),
  doc({
    id: "experience:northwind@en",
    kind: "experience",
    locale: "en",
    title: "Senior AI Engineer — Northwind Labs",
    url: "/en#experience",
    text: [
      "Senior AI Engineer, Northwind Labs (work)",
      "2023-03 – Present",
      "Berlin",
      "Leads the three-person LLM platform team behind Northwind's customer-support products.",
      "- Built the evaluation pipeline that gates every prompt and model change",
      "- Cut model spend by 42 % with routing between a small and a large model plus prompt caching",
      "- Introduced streaming responses, reducing perceived latency from 6 s to under 1 s",
      "Skills: Python, TypeScript, Gemini, pgvector, Kubernetes",
    ].join("\n"),
  }),
  doc({
    id: "experience:contoso@en",
    kind: "experience",
    locale: "en",
    title: "Full-Stack Engineer — Contoso Mobility",
    url: "/en#experience",
    text: [
      "Full-Stack Engineer, Contoso Mobility (work)",
      "2019-09 – 2023-02",
      "Munich",
      "Built the booking platform's Angular front end and its Node.js APIs.",
      "- Moved the monolith's search to Postgres full-text search, 5x faster",
      "Skills: Angular, TypeScript, Node.js, PostgreSQL, AWS",
    ].join("\n"),
  }),
  doc({
    id: "experience:tum@en",
    kind: "experience",
    locale: "en",
    title: "M.Sc. Computer Science — Technical University of Munich",
    url: "/en#experience",
    text: [
      "M.Sc. Computer Science, Technical University of Munich (education)",
      "2017-10 – 2019-08",
      "Thesis on retrieval for question answering over technical manuals.",
    ].join("\n"),
  }),
  doc({
    id: "project:atlas@en",
    kind: "project",
    locale: "en",
    title: "Atlas",
    url: "/en/work/atlas",
    text: [
      "Atlas — retrieval-augmented support assistant",
      "Answers support agents' questions from 40,000 internal documents, with citations.",
      "Role: Lead engineer",
      "Period: 2024-01 – Present",
      "Category: AI product",
      "Stack: Python, FastAPI, pgvector, Gemini, Angular",
      "Metric: 38% fewer escalations (first six months)",
      "Metric: 1.4 s p95 time to first token",
      "Problem: Agents spent a third of each ticket searching three wikis.",
      "AI architecture: Hybrid retrieval (BM25 + pgvector) with a reranker, grounded generation with mandatory citations, and an eval suite of 300 real questions run on every change.",
      "Infra: Kubernetes on GCP; the model call goes through a fallback chain with a circuit breaker.",
      "- Adopted by 120 support agents",
    ].join("\n"),
  }),
  doc({
    id: "project:atlas@de",
    kind: "project",
    locale: "de",
    title: "Atlas",
    url: "/de/work/atlas",
    text: [
      "Atlas — Support-Assistent mit Retrieval-Augmented Generation",
      "Beantwortet Fragen von Support-Mitarbeitenden aus 40.000 internen Dokumenten, mit Quellen.",
      "Rolle: Lead Engineer",
      "Stack: Python, FastAPI, pgvector, Gemini, Angular",
      "Kennzahl: 38 % weniger Eskalationen (erste sechs Monate)",
    ].join("\n"),
  }),
  doc({
    id: "project:borealis@en",
    kind: "project",
    locale: "en",
    title: "Borealis",
    url: "/en/work/borealis",
    text: [
      "Borealis — document extraction pipeline",
      "Turns scanned freight documents into structured data.",
      "Role: Backend and ML engineer",
      "Period: 2022-02 – 2023-01",
      "Category: Data pipeline",
      "Stack: TypeScript, Node.js, AWS Step Functions, Tesseract, Gemini",
      "Metric: 1.2 million documents per month",
      "Metric: 96.4% field-level accuracy",
      "Problem: Manual data entry took four people full time.",
      "AI architecture: OCR, then an LLM extracts fields into a JSON schema; low-confidence fields go to a human review queue.",
      "Infra: Serverless on AWS; retries and dead-letter queues per stage.",
    ].join("\n"),
  }),
  doc({
    id: "post:evals-first@en",
    kind: "post",
    locale: "en",
    title: "Evals first: how I ship prompt changes",
    url: "/en/writing/evals-first",
    text: [
      "Evals first: how I ship prompt changes",
      "Published: 2025-11-04",
      "A prompt change is a code change, so it gets tests: a set of real questions with expected facts, citations and refusals.",
      "Every change runs the set; a lower pass rate blocks the merge. An LLM judge scores faithfulness, but deterministic checks come first.",
    ].join("\n"),
  }),
  doc({
    id: "skills@en",
    kind: "skills",
    locale: "en",
    title: "Capabilities",
    url: "/en#skills",
    text: [
      "AI engineering: RAG, agents, evaluations, prompt design, Gemini, OpenAI, Claude",
      "Backend: Python, FastAPI, Node.js, Hono, PostgreSQL, pgvector",
      "Frontend: Angular, TypeScript, Tailwind",
      "Infrastructure: Docker, Kubernetes, AWS, GCP, Hetzner, Terraform",
    ].join("\n"),
  }),
  doc({
    id: "profile@de",
    kind: "profile",
    locale: "de",
    title: "Alireza Rastineh",
    url: "/de",
    text: [
      "Alireza Rastineh (@alirezarastineh) — Senior AI / Full-Stack Engineer",
      "Ich baue KI-Systeme, die im Produktivbetrieb bestehen.",
      "Verfügbarkeit: offen",
      "Standort: Berlin, DE",
      "Zeitzone: Europe/Berlin",
    ].join("\n"),
  }),
  doc({
    id: "skills@de",
    kind: "skills",
    locale: "de",
    title: "Fähigkeiten",
    url: "/de#skills",
    text: [
      "KI-Entwicklung: RAG, Agenten, Evaluierung, Prompt-Design",
      "Backend: Python, FastAPI, Node.js, PostgreSQL",
      "Frontend: Angular, TypeScript",
    ].join("\n"),
  }),
  doc({
    id: "cv@en",
    kind: "cv",
    locale: "en",
    title: "CV (en)",
    url: "/media/cv-en.pdf",
    text: [
      "Alireza Rastineh — Senior AI / Full-Stack Engineer — Berlin",
      "Experience: Northwind Labs (2023–), Contoso Mobility (2019–2023)",
      "Education: M.Sc. Computer Science, TU Munich (2019)",
      "Languages: English (fluent), German (professional), Persian (native)",
    ].join("\n"),
  }),
];

const base: Corpus = {
  key: "eval-fixture-1",
  documents,
  text: "",
  projects: [
    {
      id: "project:atlas@en",
      slug: "atlas",
      locale: "en",
      name: "Atlas",
      descriptor: "retrieval-augmented support assistant",
      role: "Lead engineer",
      period: "2024-01 – Present",
      category: "AI product",
      stack: ["Python", "FastAPI", "pgvector", "Gemini", "Angular"],
      tags: ["rag"],
      metrics: ["38% fewer escalations", "1.4 s p95 time to first token"],
      url: "/en/work/atlas",
      hasCaseStudy: true,
    },
    {
      id: "project:borealis@en",
      slug: "borealis",
      locale: "en",
      name: "Borealis",
      descriptor: "document extraction pipeline",
      role: "Backend and ML engineer",
      period: "2022-02 – 2023-01",
      category: "Data pipeline",
      stack: ["TypeScript", "Node.js", "AWS Step Functions", "Tesseract", "Gemini"],
      tags: ["ocr"],
      metrics: ["1.2 million documents per month", "96.4% field-level accuracy"],
      url: "/en/work/borealis",
      hasCaseStudy: true,
    },
    {
      id: "project:atlas@de",
      slug: "atlas",
      locale: "de",
      name: "Atlas",
      descriptor: "Support-Assistent mit RAG",
      role: "Lead Engineer",
      period: "2024-01 – Heute",
      category: "KI-Produkt",
      stack: ["Python", "FastAPI", "pgvector", "Gemini", "Angular"],
      tags: ["rag"],
      metrics: ["38 % weniger Eskalationen"],
      url: "/de/work/atlas",
      hasCaseStudy: true,
    },
  ],
  posts: [
    { slug: "evals-first", locale: "en", title: "Evals first", url: "/en/writing/evals-first" },
  ],
};

const faq: FaqEntry[] = [
  {
    id: "a1c2e3f4-0000-4000-8000-000000000001",
    position: 0,
    isVisible: true,
    translations: {
      en: {
        question: "What is his notice period?",
        answer: "One month from signing.",
      },
      de: {
        question: "Wie lang ist seine Kündigungsfrist?",
        answer: "Ein Monat ab Unterschrift.",
      },
    },
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "b5d6e7f8-0000-4000-8000-000000000002",
    position: 1,
    isVisible: true,
    translations: {
      en: {
        question: "Would he relocate?",
        answer: "Within the EU, yes; he prefers remote-first teams.",
      },
    },
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
];

export function fixtureAskCorpus(config: AskConfig): AskCorpus {
  return assembleCorpus(base, DEFAULT_SETTINGS, faq, config);
}
