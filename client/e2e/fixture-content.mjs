// Test content for the e2e suite and Lighthouse: the bundled fallback, with
// realistic text for its placeholder projects (real-length names, metrics with
// context, a long German name), plus what the fallback has none of — case
// studies, experience, posts and a CV — so every public page renders, and
// design work sees real lengths. Deliberately uneven, the way real content is:
// `project-two` has a case study in English only, and `notes-on-evals` is an
// English-only post, which exercises hreflang and the language switch.
//
// Published bodies are shaped the way the API's build emits them: headings
// carry ids (listed in `toc`) and code is highlighted into classes.
import { readFileSync } from "node:fs";

const read = (name) =>
  JSON.parse(readFileSync(new URL(`../src/app/content/${name}`, import.meta.url), "utf8"));

const UPDATED = "2026-09-01T10:00:00.000Z";

const image = (src, alt) => ({
  src,
  srcset: "",
  sources: [],
  width: 1600,
  height: 1000,
  alt,
  blur: null,
});

// As the API's publish step writes it: a class per theme on every token
// (github-dark-default `shd-`, github-light-default `shl-`; see code.css).
const CODE =
  '<pre class="code-block code-lang-ts"><code><span class="line">' +
  '<span class="shd-ff7b72 shl-cf222e">const</span><span class="shd-e6edf3 shl-1f2328"> answer = </span>' +
  '<span class="shd-ff7b72 shl-cf222e">await</span><span class="shd-e6edf3 shl-1f2328"> </span>' +
  '<span class="shd-d2a8ff shl-8250df">retrieve</span><span class="shd-e6edf3 shl-1f2328">(</span>' +
  '<span class="shd-a5d6ff shl-0a3069">"query"</span><span class="shd-e6edf3 shl-1f2328">);</span></span>\n' +
  '<span class="line"><span class="shd-ff7b72 shl-cf222e">return</span><span class="shd-e6edf3 shl-1f2328"> answer.text;</span></span></code></pre>';

const COPY = {
  en: {
    bio: "I turn language models into products that keep working after the demo.",
    role: "Lead engineer",
    category: "AI platform",
    metrics: [
      { value: "−42%", label: "p95 latency", context: "after response caching" },
      { value: "3.1×", label: "throughput per node", context: "same hardware, with batching" },
      { value: "99.95%", label: "uptime over 12 months", context: "against a 99.9% target" },
    ],
    projects: {
      one: {
        name: "Atlas",
        descriptor: "Retrieval platform for support teams",
        hook: "Answers support agents' questions from 40,000 internal documents, with a source for every claim.",
        problem:
          "<p>Agents searched four wikis and a ticket archive by hand. A hard question took 25 minutes, and new hires escalated half of them.</p>",
        aiArchitecture:
          "<p>Hybrid retrieval, BM25 for names and embeddings for meaning, then a reranker. The answer model must cite a retrieved passage for every sentence. I rejected fine-tuning: the documents change every week.</p>",
        fullStackInfra:
          "<p>A TypeScript API beside Postgres with pgvector, ingestion on a queue with retries, and an Angular client inside the help desk, deployed on Kubernetes.</p>",
        outcomes: [
          "p95 latency down from 2.4 s to 1.4 s after response caching",
          "61% of questions answered without an escalation",
          "30% more tickets handled by the same team",
        ],
        alt: "Atlas answering a question with three cited sources",
      },
      two: {
        name: "Supplier catalogue ingestion",
        descriptor: "Streaming imports with idempotent writes",
        hook: "Brings product records from twelve suppliers into one catalogue within minutes instead of overnight.",
        problem:
          "<p>Nightly CSV imports from twelve suppliers failed silently, so prices in the shop were up to a day out of date.</p>",
        aiArchitecture:
          "<p>A small model maps each supplier's columns to the catalogue's schema. A mapping it is unsure of waits for a person before it applies.</p>",
        fullStackInfra:
          "<p>Node.js workers on a Redis stream, idempotent writes into Postgres, and an Angular screen for reviewing mappings.</p>",
        outcomes: [
          "Prices current within 5 minutes instead of 24 hours",
          "Twelve suppliers on one import path",
          "Backfills replay through the same pipeline",
        ],
        metrics: [
          { value: "5 min", label: "from supplier to shop", context: "down from 24 hours" },
        ],
        alt: "The mapping review screen, one column awaiting approval",
      },
      three: {
        name: "Release gate for prompt changes",
        descriptor: "Evals that block a worse release",
        hook: "Runs 300 graded questions against every prompt change and blocks a release that scores below the last one.",
        problem:
          "<p>Prompt edits shipped on a feeling. Twice in one quarter a change made answers worse, and customers noticed first.</p>",
        aiArchitecture:
          "<p>A fixed question set with graded reference answers, an LLM judge calibrated against human labels, and a pairwise comparison with the current release.</p>",
        fullStackInfra:
          "<p>Python runners in CI, results in Postgres, and a report linked from every pull request.</p>",
        outcomes: [
          "No regression shipped since the gate went live",
          "300 questions graded in 4 minutes",
          "The judge agrees with people on 92% of pairs",
        ],
        metrics: [
          {
            value: "300",
            label: "graded questions per change",
            context: "in 4 minutes, on every pull request",
          },
        ],
        alt: "An eval report comparing a prompt change with the current release",
      },
    },
    caseStudy: {
      toc: [
        { id: "architecture-decisions", text: "Architecture decisions", level: 2 },
        { id: "retrieval", text: "Retrieval", level: 3 },
        { id: "what-i-would-do-differently", text: "What I would do differently", level: 2 },
      ],
      body:
        '<h2 id="architecture-decisions">Architecture decisions</h2>' +
        "<p>Retrieval runs next to the API, so a request never leaves the private network.</p>" +
        '<h3 id="retrieval">Retrieval</h3>' +
        "<p>Hybrid search: BM25 for names, embeddings for meaning.</p>" +
        CODE +
        "<blockquote><p>Evals gate every prompt change.</p></blockquote>" +
        '<h2 id="what-i-would-do-differently">What I would do differently</h2>' +
        "<p>Start the eval set on day one.</p>",
      seo: "How a retrieval platform got 42% faster at the 95th percentile.",
      captions: ["The ingestion dashboard", "Latency before and after caching"],
    },
    experiences: {
      senior: {
        title: "Senior AI Engineer",
        summary: "Builds the retrieval and evaluation platform behind three products.",
        highlights: [
          "Cut p95 latency by 42%",
          "Introduced evals as a release gate",
          "Moved ingestion to a queue with retries",
          "Runs the on-call rotation",
          "Mentors two engineers",
        ],
      },
      fullStack: {
        title: "Full-stack Engineer",
        summary: "Shipped the customer portal and its API.",
        highlights: ["Moved deploys from weekly to daily"],
      },
      aiEngineer: {
        title: "AI Engineer",
        summary: "Built the first document classifier for incoming freight papers.",
        highlights: [
          "Classified 80% of documents without a manual check",
          "Moved the model from a notebook to a monitored service",
          "Cut sorting time per shipment from 6 to 2 minutes",
        ],
      },
      student: {
        title: "Working student, data engineering",
        summary: "Kept the research group's data pipelines running.",
        highlights: ["Automated 14 weekly exports"],
      },
      degree: {
        title: "M.Sc. Computer Science",
        summary: "Thesis on retrieval evaluation.",
        highlights: [],
      },
      cert: { title: "Cloud Architect", summary: "", highlights: [] },
    },
    post: {
      title: "Shipping RAG to production",
      excerpt: "What changed between the demo and the first thousand users.",
      toc: [
        { id: "the-demo-lies", text: "The demo lies", level: 2 },
        { id: "caching", text: "Caching", level: 2 },
      ],
      body:
        '<h2 id="the-demo-lies">The demo lies</h2><p>A demo has one user and no traffic.</p>' +
        '<h2 id="caching">Caching</h2><p>Cache the retrieval, not only the answer.</p>' +
        CODE,
    },
  },
  de: {
    bio: "Ich mache aus Sprachmodellen Produkte, die auch nach der Demo funktionieren.",
    role: "Leitender Engineer",
    category: "KI-Plattform",
    metrics: [
      { value: "−42 %", label: "p95-Latenz", context: "nach Response-Caching" },
      { value: "3,1×", label: "Durchsatz pro Node", context: "gleiche Hardware, mit Batching" },
      { value: "99,95 %", label: "Verfügbarkeit über 12 Monate", context: "bei 99,9 % Zielwert" },
    ],
    projects: {
      one: {
        name: "Atlas",
        descriptor: "Retrieval-Plattform für Supportteams",
        hook: "Beantwortet Fragen des Supports aus 40.000 internen Dokumenten, mit einer Quelle für jede Aussage.",
        problem:
          "<p>Der Support durchsuchte vier Wikis und ein Ticketarchiv von Hand. Eine schwierige Frage dauerte 25 Minuten, und neue Kolleginnen und Kollegen eskalierten die Hälfte.</p>",
        aiArchitecture:
          "<p>Hybride Suche, BM25 für Namen und Embeddings für Bedeutung, danach ein Reranker. Das Antwortmodell belegt jeden Satz mit einer gefundenen Passage. Fine-Tuning habe ich verworfen: Die Dokumente ändern sich jede Woche.</p>",
        fullStackInfra:
          "<p>Eine TypeScript-API neben Postgres mit pgvector, Ingestion über eine Queue mit Wiederholungen und ein Angular-Client im Helpdesk, betrieben auf Kubernetes.</p>",
        outcomes: [
          "p95-Latenz nach Response-Caching von 2,4 s auf 1,4 s gesenkt",
          "61 % der Fragen ohne Eskalation beantwortet",
          "30 % mehr Tickets mit demselben Team bearbeitet",
        ],
        alt: "Atlas beantwortet eine Frage mit drei belegten Quellen",
      },
      two: {
        // The long German name: it must wrap without pushing the page sideways.
        name: "Lieferanten-Datenintegration für den Produktkatalog",
        descriptor: "Streaming-Importe mit idempotenten Schreibvorgängen",
        hook: "Bringt Produktdaten von zwölf Lieferanten in Minuten statt über Nacht in einen gemeinsamen Katalog.",
        problem:
          "<p>Nächtliche CSV-Importe von zwölf Lieferanten scheiterten unbemerkt, deshalb waren die Preise im Shop bis zu einen Tag alt.</p>",
        aiArchitecture:
          "<p>Ein kleines Modell ordnet die Spalten jedes Lieferanten dem Katalogschema zu. Ist es unsicher, prüft ein Mensch die Zuordnung, bevor sie gilt.</p>",
        fullStackInfra:
          "<p>Node.js-Worker auf einem Redis-Stream, idempotente Schreibvorgänge in Postgres und eine Angular-Oberfläche zum Prüfen der Zuordnungen.</p>",
        outcomes: [
          "Preise nach 5 Minuten aktuell statt nach 24 Stunden",
          "Zwölf Lieferanten auf einem Importweg",
          "Nachträge laufen durch dieselbe Pipeline",
        ],
        metrics: [
          { value: "5 Min.", label: "vom Lieferanten in den Shop", context: "statt 24 Stunden" },
        ],
        alt: "Die Prüfansicht der Zuordnungen, eine Spalte wartet auf Freigabe",
      },
      three: {
        name: "Freigabeprüfung für Prompt-Änderungen",
        descriptor: "Evals, die schlechtere Releases stoppen",
        hook: "Prüft jede Prompt-Änderung mit 300 bewerteten Fragen und stoppt ein Release, das schlechter abschneidet als das letzte.",
        problem:
          "<p>Prompt-Änderungen gingen nach Gefühl live. Zweimal in einem Quartal wurden die Antworten schlechter, und die Kundschaft merkte es zuerst.</p>",
        aiArchitecture:
          "<p>Ein fester Fragensatz mit bewerteten Referenzantworten, ein LLM-Judge, kalibriert an menschlichen Bewertungen, und ein paarweiser Vergleich mit dem aktuellen Release.</p>",
        fullStackInfra:
          "<p>Python-Runner in der CI, Ergebnisse in Postgres und ein Bericht an jedem Pull Request.</p>",
        outcomes: [
          "Seit dem Start der Prüfung keine Regression ausgeliefert",
          "300 Fragen in 4 Minuten bewertet",
          "Der Judge stimmt bei 92 % der Paare mit Menschen überein",
        ],
        metrics: [
          {
            value: "300",
            label: "bewertete Fragen pro Änderung",
            context: "in 4 Minuten, bei jedem Pull Request",
          },
        ],
        alt: "Ein Eval-Bericht vergleicht eine Prompt-Änderung mit dem aktuellen Release",
      },
    },
    caseStudy: {
      toc: [
        { id: "architekturentscheidungen", text: "Architekturentscheidungen", level: 2 },
        { id: "retrieval", text: "Retrieval", level: 3 },
        { id: "was-ich-anders-machen-wurde", text: "Was ich anders machen würde", level: 2 },
      ],
      body:
        '<h2 id="architekturentscheidungen">Architekturentscheidungen</h2>' +
        "<p>Das Retrieval läuft neben der API; keine Anfrage verlässt das private Netz.</p>" +
        '<h3 id="retrieval">Retrieval</h3>' +
        "<p>Hybride Suche: BM25 für Namen, Embeddings für Bedeutung.</p>" +
        CODE +
        '<h2 id="was-ich-anders-machen-wurde">Was ich anders machen würde</h2>' +
        "<p>Das Eval-Set ab dem ersten Tag pflegen.</p>",
      seo: "Wie eine Retrieval-Plattform im 95. Perzentil 42 % schneller wurde.",
      captions: ["Das Ingestion-Dashboard", "Latenz vor und nach dem Caching"],
    },
    experiences: {
      senior: {
        title: "Senior AI Engineer",
        summary: "Baut die Retrieval- und Evaluationsplattform hinter drei Produkten.",
        highlights: [
          "p95-Latenz um 42 % gesenkt",
          "Evals als Release-Gate eingeführt",
          "Ingestion auf eine Queue mit Wiederholungen umgestellt",
          "Leitet die Rufbereitschaft",
          "Betreut zwei Engineers",
        ],
      },
      fullStack: {
        title: "Full-Stack-Engineer",
        summary: "Kundenportal und API ausgeliefert.",
        highlights: ["Deploys von wöchentlich auf täglich umgestellt"],
      },
      aiEngineer: {
        title: "AI Engineer",
        summary: "Baute den ersten Dokumentenklassifikator für eingehende Frachtpapiere.",
        highlights: [
          "80 % der Dokumente ohne manuelle Prüfung klassifiziert",
          "Das Modell vom Notebook in einen überwachten Service überführt",
          "Sortierzeit pro Sendung von 6 auf 2 Minuten gesenkt",
        ],
      },
      student: {
        title: "Werkstudent Data Engineering",
        summary: "Hielt die Datenpipelines der Forschungsgruppe am Laufen.",
        highlights: ["14 wöchentliche Exporte automatisiert"],
      },
      degree: {
        title: "M.Sc. Informatik",
        summary: "Masterarbeit zur Retrieval-Evaluation.",
        highlights: [],
      },
      cert: { title: "Cloud Architect", summary: "", highlights: [] },
    },
    post: {
      title: "RAG in Produktion bringen",
      excerpt: "Was sich zwischen Demo und den ersten tausend Nutzern geändert hat.",
      toc: [
        { id: "die-demo-lugt", text: "Die Demo lügt", level: 2 },
        { id: "caching", text: "Caching", level: 2 },
      ],
      body:
        '<h2 id="die-demo-lugt">Die Demo lügt</h2><p>Eine Demo hat einen Nutzer und keinen Traffic.</p>' +
        '<h2 id="caching">Caching</h2><p>Das Retrieval cachen, nicht nur die Antwort.</p>' +
        CODE,
    },
  },
};

const ENGLISH_ONLY_POST = {
  slug: "notes-on-evals",
  title: "Notes on evals",
  excerpt: "Small, boring, and the reason releases stopped breaking.",
  publishedAt: "2026-07-03T08:00:00.000Z",
  updatedAt: "2026-07-03T08:00:00.000Z",
  tags: ["evals"],
  cover: null,
  readingMinutes: 3,
  alternates: { en: "/en/writing/notes-on-evals", de: null },
};

function sharedPost(locale) {
  const copy = COPY[locale].post;
  return {
    slug: "shipping-rag-to-production",
    title: copy.title,
    excerpt: copy.excerpt,
    publishedAt: "2026-08-12T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z",
    tags: ["rag", "infra"],
    cover: image("/projects/project-three.svg", ""),
    readingMinutes: 6,
    alternates: {
      en: "/en/writing/shipping-rag-to-production",
      de: "/de/writing/shipping-rag-to-production",
    },
  };
}

function experiences(locale) {
  const copy = COPY[locale].experiences;
  const entry = (id, kind, text, rest) => ({
    id,
    kind,
    title: text.title,
    summary: text.summary,
    highlights: text.highlights,
    credential: null,
    skills: [],
    location: "",
    employmentType: "",
    ...rest,
  });
  return [
    entry("11111111-1111-4111-8111-111111111111", "work", copy.senior, {
      org: { name: "Example GmbH", url: "https://example.com", logo: null },
      location: "Berlin",
      employmentType: "full-time",
      period: { start: "2024-03-01", end: null, precision: "month" },
      skills: ["TypeScript", "Python", "Postgres"],
    }),
    entry("22222222-2222-4222-8222-222222222222", "work", copy.fullStack, {
      org: { name: "Sample AG", url: "", logo: null },
      employmentType: "contract",
      period: { start: "2021-01-01", end: "2024-02-01", precision: "month" },
    }),
    entry("55555555-5555-4555-8555-555555555555", "work", copy.aiEngineer, {
      org: { name: "Muster Logistik GmbH", url: "", logo: null },
      location: "Hamburg",
      employmentType: "full-time",
      period: { start: "2020-02-01", end: "2020-12-01", precision: "month" },
      skills: ["Python", "scikit-learn"],
    }),
    entry("66666666-6666-4666-8666-666666666666", "work", copy.student, {
      org: { name: "Example Research Lab", url: "", logo: null },
      employmentType: "part-time",
      period: { start: "2018-04-01", end: "2019-12-01", precision: "month" },
    }),
    entry("33333333-3333-4333-8333-333333333333", "education", copy.degree, {
      org: { name: "TU Example", url: "", logo: null },
      period: { start: "2018-01-01", end: "2020-01-01", precision: "year" },
    }),
    entry("44444444-4444-4444-8444-444444444444", "certification", copy.cert, {
      org: { name: "Cloud Co", url: "", logo: null },
      period: { start: "2023-05-01", end: null, precision: "month" },
      credential: { id: "ABC-123", url: "https://example.com/credential/abc-123" },
    }),
  ];
}

/** A fallback project with this language's realistic text in place of its placeholders. */
const realistic = (base, { alt, ...text }) => ({ ...base, ...text, cover: { ...base.cover, alt } });

/** The core payload `/v2/content/:locale` serves. */
export function fixtureCore(locale) {
  const base = read(`fallback.${locale}.json`);
  const copy = COPY[locale];
  const [one, two, three, ...rest] = base.projects;
  return {
    ...base,
    ui: { ...base.ui, about: { ...base.ui.about, bio: copy.bio } },
    identity: { ...base.identity, resume: { href: "/media/fixture-cv.pdf", bytes: 48_213 } },
    projects: [
      {
        ...realistic(one, copy.projects.one),
        hasCaseStudy: true,
        featured: true,
        period: { start: "2025-02-01", end: null },
        role: copy.role,
        category: { key: "ai-platform", label: copy.category },
        tags: ["rag", "evals"],
        metrics: copy.metrics,
        updatedAt: UPDATED,
      },
      { ...realistic(two, copy.projects.two), hasCaseStudy: locale === "en", updatedAt: UPDATED },
      realistic(three, copy.projects.three),
      ...rest,
    ],
    experiences: experiences(locale),
    posts: locale === "en" ? [sharedPost("en"), ENGLISH_ONLY_POST] : [sharedPost("de")],
  };
}

/** The docs `/v2/content/:locale/:kind/:slug` serves, by `kind:slug` key. */
export function fixtureDocs(locale) {
  const copy = COPY[locale];
  const docs = { ...read(`fallback-docs.${locale}.json`) };

  docs["project:project-one"] = {
    kind: "project",
    slug: "project-one",
    body: copy.caseStudy.body,
    toc: copy.caseStudy.toc,
    gallery: [
      {
        ...image("/projects/project-two.svg", "Ingestion dashboard"),
        caption: copy.caseStudy.captions[0],
      },
      {
        ...image("/projects/project-three.svg", "Latency chart"),
        caption: copy.caseStudy.captions[1],
      },
    ],
    seo: { title: "", description: copy.caseStudy.seo },
    alternates: { en: "/en/work/project-one", de: "/de/work/project-one" },
    updatedAt: UPDATED,
  };

  const post = sharedPost(locale);
  docs[`post:${post.slug}`] = {
    ...post,
    kind: "post",
    body: copy.post.body,
    toc: copy.post.toc,
    seo: { title: "", description: "" },
    canonicalUrl: null,
  };

  if (locale === "en") {
    // The reader aids, as a publish writes them (plan 3, W8): here, so project-one (Lighthouse's
    // and the visual baselines') stays as it was.
    docs["project:project-two"] = {
      kind: "project",
      slug: "project-two",
      body: "<p>An English-only case study.</p>",
      toc: [],
      gallery: [],
      seo: { title: "", description: "" },
      summaries: {
        plain:
          "A data platform that gathers records from many places, so teams find what they need.",
        expert:
          "Streaming ingestion with idempotent writes; backfills replay through the same path.",
      },
      glossary: [
        {
          term: "Ingestion",
          definition: "Taking data in from outside sources and storing it for use.",
        },
        {
          term: "Backfill",
          definition: "Running past data through a pipeline to fill what it missed.",
        },
      ],
      alternates: { en: "/en/work/project-two", de: null },
      updatedAt: UPDATED,
    };
    docs[`post:${ENGLISH_ONLY_POST.slug}`] = {
      ...ENGLISH_ONLY_POST,
      kind: "post",
      body: "<p>Keep them small.</p>",
      toc: [],
      seo: { title: "", description: "" },
      canonicalUrl: null,
    };
  }
  return docs;
}
