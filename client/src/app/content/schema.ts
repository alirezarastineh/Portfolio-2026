/**
 * MIRRORED COPY — do not edit.
 *
 * Generated from `server/src/content/schema.ts` by `pnpm content:sync`.
 * Edit the canonical file there and re-run the sync; `schema-parity.spec.ts`
 * fails the test suite if these two drift apart.
 */
// ─── SHARED CONTENT SCHEMA — everything below this line is mirrored verbatim ───
import { z } from "zod";

/** The `version` of every payload written with this schema. */
export const CONTENT_SCHEMA_VERSION = 2;

const nonEmpty = z.string().min(1);

/** Guards an interpolation token against being deleted by an editor. */
const withToken = (token: string) =>
  z
    .string()
    .min(1)
    .refine((s) => s.includes(token), `must contain ${token}`);

/**
 * Sanitized HTML from the Tiptap editor. Kept as a distinct alias so the
 * templates that render it with `[innerHTML]` are greppable, and so the write
 * path knows which fields to run through the sanitizer.
 *
 * Sanitizing happens on write (see `sanitizeRichText`), not only at render —
 * the content endpoint is public, and anything could consume it.
 */
export const richText = z.string().max(20000);
/** Long-form bodies: case studies, posts, legal pages. */
export const richTextLong = z.string().max(200_000);

export const LOCALES = ["en", "de"] as const;
export const localeSchema = z.enum(LOCALES);

/**
 * A key into the client's icon registry (`github`, `brain-circuit`, …). The
 * registry owns the list of known icons; an unknown key renders a neutral
 * fallback, so adding an icon never needs a schema change.
 */
export const iconKeySchema = z.string().regex(/^[a-z0-9-]{1,40}$/);
export const bentoSpanSchema = z.enum(["lg", "tall", "sm"]);

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const availabilitySchema = z.enum(["open", "limited", "closed"]);
export const experienceKindSchema = z.enum(["work", "education", "certification"]);
export const employmentTypeSchema = z.enum([
  "",
  "full-time",
  "part-time",
  "contract",
  "freelance",
  "internship",
]);
export const datePrecisionSchema = z.enum(["month", "year"]);
export const legalDocSchema = z.enum(["imprint", "privacy"]);

/** `end: null` means ongoing / present. */
export const periodSchema = z.object({ start: isoDateSchema, end: isoDateSchema.nullable() });

/**
 * An image as published: a relative `src` (`/media/…`, or a legacy bundled
 * `/projects/*.svg`), resized WebP/AVIF variants for `<picture>`, intrinsic
 * size against layout shift, and a tiny blurred placeholder.
 */
export const imageSourceSchema = z.object({
  type: z.enum(["image/avif", "image/webp"]),
  srcset: z.string(),
});
export const imageSchema = z.object({
  src: nonEmpty,
  /** WebP widths, `"/media/x-480w.webp 480w, …"`; empty when there are none. */
  srcset: z.string(),
  /** AVIF first, then WebP — the order `<picture>` tries them in. */
  sources: z.array(imageSourceSchema),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  alt: z.string(),
  blur: z.string().max(2048).nullable(),
});

/** One big number on a case study: `{ value: "40%", label: "less latency" }`. */
export const metricSchema = z.object({
  value: nonEmpty,
  label: nonEmpty,
  context: z.string().optional(),
});

/**
 * Where the same page lives in each language, as a path (`/de/writing/foo`),
 * or null where it does not exist.
 */
export const alternatesSchema = z.record(localeSchema, z.string().nullable());

/**
 * The localized string tree. This is what `LanguageService.t()` returns, so its
 * shape is load-bearing for every template in the app.
 */
export const uiSchema = z.object({
  profile: z.object({
    role: nonEmpty,
    heroHeadline: nonEmpty,
    heroSubheadline: nonEmpty,
    primaryCta: nonEmpty,
    secondaryCta: nonEmpty,
    /** Moved out of profile.data.ts — it is display text, so it is localized. */
    location: nonEmpty,
  }),
  nav: z.object({
    skills: nonEmpty,
    projects: nonEmpty,
    about: nonEmpty,
    contact: nonEmpty,
    work: nonEmpty,
    experience: nonEmpty,
    writing: nonEmpty,
  }),
  hero: z.object({
    availabilityOpen: nonEmpty,
    availabilityLimited: nonEmpty,
    availabilityClosed: nonEmpty,
    downloadCv: nonEmpty,
    askCta: nonEmpty,
  }),
  /** Per-card copy lives on the `skills` array, keyed by id rather than index. */
  skills: z.object({
    heading: nonEmpty,
    subtitle: nonEmpty,
  }),
  about: z.object({
    heading: nonEmpty,
    subtitle: nonEmpty,
    philosophy: nonEmpty,
    terminalTitle: nonEmpty,
    terminalPrompt: nonEmpty,
    terminalOutputWhoami: nonEmpty,
    terminalOutputLs: nonEmpty,
    terminalOutputContact: nonEmpty,
  }),
  projects: z.object({
    heading: nonEmpty,
    subtitle: nonEmpty,
  }),
  experience: z.object({
    heading: nonEmpty,
    subtitle: nonEmpty,
    work: nonEmpty,
    education: nonEmpty,
    certifications: nonEmpty,
    present: nonEmpty,
    credential: nonEmpty,
    years: withToken("{n}"),
    months: withToken("{n}"),
    fullTime: nonEmpty,
    partTime: nonEmpty,
    contract: nonEmpty,
    freelance: nonEmpty,
    internship: nonEmpty,
  }),
  writing: z.object({
    heading: nonEmpty,
    subtitle: nonEmpty,
    readingTime: withToken("{n}"),
    allPosts: nonEmpty,
    empty: nonEmpty,
    rss: nonEmpty,
    published: nonEmpty,
    updated: nonEmpty,
    tags: nonEmpty,
  }),
  caseStudy: z.object({
    allWork: nonEmpty,
    readCaseStudy: nonEmpty,
    role: nonEmpty,
    period: nonEmpty,
    category: nonEmpty,
    metrics: nonEmpty,
    gallery: nonEmpty,
    toc: nonEmpty,
    previous: nonEmpty,
    next: nonEmpty,
    ctaHeading: nonEmpty,
    ctaBody: nonEmpty,
    ctaButton: nonEmpty,
  }),
  contact: z.object({
    heading: nonEmpty,
    subtitle: nonEmpty,
    labelName: nonEmpty,
    labelEmail: nonEmpty,
    labelMessage: nonEmpty,
    placeholderName: nonEmpty,
    placeholderEmail: nonEmpty,
    placeholderMessage: nonEmpty,
    submit: nonEmpty,
    sending: nonEmpty,
    successLine1: nonEmpty,
    successLine2: nonEmpty,
    errorRequired: nonEmpty,
    errorEmail: nonEmpty,
    /** Was a `(n: number) => string` function before the content moved to the DB. */
    errorMinlength: withToken("{n}"),
    errorMaxlength: withToken("{n}"),
    errorInvalid: nonEmpty,
    errorFixFields: nonEmpty,
    errorRateLimited: nonEmpty,
    errorInvalidInput: nonEmpty,
    errorMailerUnavailable: nonEmpty,
    errorSendFailed: nonEmpty,
    errorNetwork: nonEmpty,
  }),
  projectCard: z.object({
    problem: nonEmpty,
    arch: nonEmpty,
    infra: nonEmpty,
    outcomes: nonEmpty,
    /** Zero-padding moved to the caller, so this survives German and i > 9. */
    caseLabel: withToken("{i}"),
    live: nonEmpty,
    repo: nonEmpty,
    caseStudy: nonEmpty,
    techStackAriaLabel: nonEmpty,
  }),
  legal: z.object({
    nav: nonEmpty,
    imprint: nonEmpty,
    privacy: nonEmpty,
    updated: nonEmpty,
  }),
  notFound: z.object({
    title: nonEmpty,
    body: nonEmpty,
    home: nonEmpty,
  }),
  /** The About terminal as an assistant (Phase 7); copy only until then. */
  ask: z.object({
    title: nonEmpty,
    hint: nonEmpty,
    placeholder: nonEmpty,
    disclosure: nonEmpty,
    offline: nonEmpty,
  }),
});

/** Locale-invariant identity. Every display string belongs in `ui` instead. */
export const identitySchema = z.object({
  name: nonEmpty,
  handle: nonEmpty,
  contactEmail: z.email(),
  primaryCtaHref: nonEmpty,
  secondaryCtaHref: nonEmpty,
  /** The public origin, e.g. `https://alirezarastineh.me`; absolute URLs start here. */
  siteUrl: z.string(),
  availability: availabilitySchema,
  location: z.object({ city: z.string(), country: z.string() }),
  /** IANA zone, e.g. `Europe/Berlin`; empty when unset. */
  timezone: z.string(),
  avatar: imageSchema.nullable(),
  /** This locale's CV; null when none is set. */
  resume: z.object({ href: nonEmpty, bytes: z.number().int().nonnegative() }).nullable(),
});

export const socialSchema = z.object({
  label: nonEmpty,
  href: nonEmpty,
  icon: iconKeySchema,
});

export const skillSchema = z.object({
  id: nonEmpty,
  icon: iconKeySchema,
  span: bentoSpanSchema,
  items: z.array(nonEmpty),
  title: nonEmpty,
  caption: z.string(),
  narrative: z.string(),
});

export const projectLinksSchema = z.object({
  live: z.string(),
  repo: z.string(),
  caseStudy: z.string(),
});

/** A project as every page lists it; the case-study body is a separate doc. */
export const projectSchema = z.object({
  slug: nonEmpty,
  name: nonEmpty,
  descriptor: z.string(),
  hook: z.string(),
  // Rich text. `about.philosophy` deliberately stays plain: the terminal types
  // it out one character at a time and would render the tags literally.
  problem: richText,
  aiArchitecture: richText,
  fullStackInfra: richText,
  outcomes: z.array(z.string()),
  stack: z.array(z.string()),
  links: projectLinksSchema,
  cover: imageSchema.nullable(),
  featured: z.boolean(),
  period: periodSchema.nullable(),
  role: z.string(),
  category: z.object({ key: nonEmpty, label: z.string() }).nullable(),
  tags: z.array(z.string()),
  metrics: z.array(metricSchema),
  /** True when a case-study body exists, i.e. `/work/<slug>` has a page. */
  hasCaseStudy: z.boolean(),
  updatedAt: isoDateTimeSchema,
});

export const experienceSchema = z.object({
  id: nonEmpty,
  kind: experienceKindSchema,
  org: z.object({ name: nonEmpty, url: z.string(), logo: imageSchema.nullable() }),
  title: nonEmpty,
  summary: z.string(),
  highlights: z.array(z.string()),
  location: z.string(),
  employmentType: employmentTypeSchema,
  period: periodSchema.extend({ precision: datePrecisionSchema }),
  credential: z.object({ id: z.string(), url: z.string() }).nullable(),
  skills: z.array(z.string()),
});

export const postSummarySchema = z.object({
  slug: nonEmpty,
  title: nonEmpty,
  excerpt: z.string(),
  publishedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  tags: z.array(z.string()),
  cover: imageSchema.nullable(),
  /** Computed on the server from the body, so the core never carries it. */
  readingMinutes: z.number().int().positive(),
  alternates: alternatesSchema,
});

export const legalSummarySchema = z.object({
  doc: legalDocSchema,
  title: nonEmpty,
  updatedAt: isoDateTimeSchema,
});

export const seoSchema = z.object({
  title: nonEmpty,
  description: nonEmpty,
  author: nonEmpty,
  siteName: nonEmpty,
  canonical: nonEmpty,
  themeColor: nonEmpty,
  ogTitle: nonEmpty,
  ogDescription: nonEmpty,
  ogImage: nonEmpty,
  ogUrl: nonEmpty,
  ogLocale: nonEmpty,
  twitterCard: nonEmpty,
  twitterTitle: nonEmpty,
  twitterDescription: nonEmpty,
  twitterImage: nonEmpty,
});

/** Per-page overrides; empty strings fall back to the page's own title/summary. */
export const pageSeoSchema = z.object({
  title: z.string(),
  description: z.string(),
});

/** An `h2`/`h3` of a body, with the id the build gave it. */
export const tocEntrySchema = z.object({
  id: nonEmpty,
  text: nonEmpty,
  level: z.union([z.literal(2), z.literal(3)]),
});

export const galleryImageSchema = imageSchema.extend({ caption: z.string() });

export const projectDocSchema = z.object({
  kind: z.literal("project"),
  slug: nonEmpty,
  body: richTextLong,
  toc: z.array(tocEntrySchema),
  gallery: z.array(galleryImageSchema),
  seo: pageSeoSchema,
  alternates: alternatesSchema,
  updatedAt: isoDateTimeSchema,
});

export const postDocSchema = postSummarySchema.extend({
  kind: z.literal("post"),
  body: richTextLong,
  toc: z.array(tocEntrySchema),
  seo: pageSeoSchema,
  /** Where the post first appeared, when it did elsewhere. */
  canonicalUrl: z.string().nullable(),
});

export const legalDocPayloadSchema = z.object({
  kind: z.literal("legal"),
  doc: legalDocSchema,
  title: nonEmpty,
  body: richTextLong,
  updatedAt: isoDateTimeSchema,
});

/** A long-form body, served by `/v2/content/:locale/:kind/:slug`. */
export const docSchema = z.discriminatedUnion("kind", [
  projectDocSchema,
  postDocSchema,
  legalDocPayloadSchema,
]);

/** The URL segment for each kind of doc, and the key prefix it is stored under. */
export const DOC_KINDS = { projects: "project", posts: "post", legal: "legal" } as const;
export type DocKind = keyof typeof DOC_KINDS;

export function isDocKind(value: unknown): value is DocKind {
  return typeof value === "string" && Object.hasOwn(DOC_KINDS, value);
}

/** `project:atlas`, `post:hello`, `legal:imprint`. */
export function docKey(kind: DocKind, slug: string): string {
  return `${DOC_KINDS[kind]}:${slug}`;
}

/**
 * One published snapshot for one locale: everything home and the index pages
 * need. Bodies are docs, fetched per page.
 */
export const appContentSchema = z.object({
  version: z.literal(CONTENT_SCHEMA_VERSION),
  locale: localeSchema,
  ui: uiSchema,
  identity: identitySchema,
  socials: z.array(socialSchema),
  skills: z.array(skillSchema),
  projects: z.array(projectSchema),
  experiences: z.array(experienceSchema),
  posts: z.array(postSummarySchema),
  legal: z.array(legalSummarySchema),
  seo: seoSchema,
});

export type Locale = z.infer<typeof localeSchema>;
export type IconKey = z.infer<typeof iconKeySchema>;
export type BentoSpan = z.infer<typeof bentoSpanSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type ExperienceKind = z.infer<typeof experienceKindSchema>;
export type EmploymentType = z.infer<typeof employmentTypeSchema>;
export type LegalDoc = z.infer<typeof legalDocSchema>;
export type Period = z.infer<typeof periodSchema>;
export type Image = z.infer<typeof imageSchema>;
export type Metric = z.infer<typeof metricSchema>;
export type Alternates = z.infer<typeof alternatesSchema>;
export type Social = z.infer<typeof socialSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectLinks = z.infer<typeof projectLinksSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type PostSummary = z.infer<typeof postSummarySchema>;
export type LegalSummary = z.infer<typeof legalSummarySchema>;
export type Identity = z.infer<typeof identitySchema>;
export type Seo = z.infer<typeof seoSchema>;
export type PageSeo = z.infer<typeof pageSeoSchema>;
export type TocEntry = z.infer<typeof tocEntrySchema>;
export type GalleryImage = z.infer<typeof galleryImageSchema>;
export type ProjectDoc = z.infer<typeof projectDocSchema>;
export type PostDoc = z.infer<typeof postDocSchema>;
export type LegalDocPayload = z.infer<typeof legalDocPayloadSchema>;
export type Doc = z.infer<typeof docSchema>;
export type AppContent = z.infer<typeof appContentSchema>;
/** Replaces the old `typeof en`, so templates and the DB share one type. */
export type AppTranslations = AppContent["ui"];
