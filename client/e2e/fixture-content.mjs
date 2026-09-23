// Test content for the e2e suite and Lighthouse: the bundled fallback, plus
// what the fallback has none of — case studies, experience, posts and a CV —
// so every public page renders. Deliberately uneven, the way real content is:
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
  '<span class="shd-a5d6ff shl-0a3069">"query"</span><span class="shd-e6edf3 shl-1f2328">);</span></span></code></pre>';

const COPY = {
  en: {
    role: "Lead engineer",
    category: "AI platform",
    metrics: [
      { value: "−42%", label: "p95 latency", context: "after response caching" },
      { value: "3.1×", label: "throughput per node" },
      { value: "99.95%", label: "uptime over 12 months" },
    ],
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
        highlights: ["Cut p95 latency by 42%", "Introduced evals as a release gate"],
      },
      fullStack: {
        title: "Full-stack Engineer",
        summary: "Shipped the customer portal and its API.",
        highlights: ["Moved deploys from weekly to daily"],
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
    role: "Leitender Engineer",
    category: "KI-Plattform",
    metrics: [
      { value: "−42 %", label: "p95-Latenz", context: "nach Response-Caching" },
      { value: "3,1×", label: "Durchsatz pro Node" },
      { value: "99,95 %", label: "Verfügbarkeit über 12 Monate" },
    ],
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
        highlights: ["p95-Latenz um 42 % gesenkt", "Evals als Release-Gate eingeführt"],
      },
      fullStack: {
        title: "Full-Stack-Engineer",
        summary: "Kundenportal und API ausgeliefert.",
        highlights: ["Deploys von wöchentlich auf täglich umgestellt"],
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

/** The core payload `/v2/content/:locale` serves. */
export function fixtureCore(locale) {
  const base = read(`fallback.${locale}.json`);
  const copy = COPY[locale];
  const [one, two, ...rest] = base.projects;
  return {
    ...base,
    identity: { ...base.identity, resume: { href: "/media/fixture-cv.pdf", bytes: 48_213 } },
    projects: [
      {
        ...one,
        hasCaseStudy: true,
        featured: true,
        period: { start: "2025-02-01", end: null },
        role: copy.role,
        category: { key: "ai-platform", label: copy.category },
        tags: ["rag", "evals"],
        metrics: copy.metrics,
        updatedAt: UPDATED,
      },
      { ...two, hasCaseStudy: locale === "en", updatedAt: UPDATED },
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
    docs["project:project-two"] = {
      kind: "project",
      slug: "project-two",
      body: "<p>An English-only case study.</p>",
      toc: [],
      gallery: [],
      seo: { title: "", description: "" },
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
