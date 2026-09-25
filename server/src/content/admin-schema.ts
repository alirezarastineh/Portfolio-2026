/**
 * CANONICAL copy of the admin input schemas: what the admin API accepts.
 *
 * Mirrored into `client/src/app/admin/admin-schema.ts` by `pnpm content:sync`,
 * so the editors are typed against exactly what the server validates;
 * `schema-parity.spec.ts` fails if the copies drift. Rich-text fields are
 * plain strings here — the server sanitizes them after parsing
 * (`routes/admin-inputs.ts`), which keeps sanitize-html out of the browser.
 */
import { z } from "zod";

import {
  availabilitySchema,
  bentoSpanSchema,
  datePrecisionSchema,
  employmentTypeSchema,
  experienceKindSchema,
  iconKeySchema,
} from "./schema.js";
// ─── SHARED ADMIN INPUT SCHEMA — everything below this line is mirrored verbatim ───

const nonEmpty = z.string().min(1);
const slugSchema = nonEmpty
  .max(80)
  .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const optionalUrl = z.string().max(500).default("");

/** Rich text as the editor writes it; sanitized by the server after parsing. */
const richInput = z.string().max(20000);
const richLongInput = z.string().max(200_000);

/** Wraps a per-locale payload so every write carries both languages. */
export function perLocale<T extends z.ZodType>(schema: T) {
  return z.object({ en: schema, de: schema });
}

function isTimeZone(value: string): boolean {
  if (value === "") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The end of a period may not come before its start. */
function periodInOrder(start: string | null | undefined, end: string | null | undefined): boolean {
  return !start || !end || end >= start;
}

export const reorderInput = z.object({ ids: z.array(nonEmpty).max(200) });

export const profileInput = z.object({
  name: nonEmpty.max(120),
  handle: nonEmpty.max(80),
  contactEmail: z.email().max(200),
  primaryCtaHref: nonEmpty.max(300),
  secondaryCtaHref: nonEmpty.max(300),
  /** The public origin; empty = derived from the SEO canonical URL. */
  siteUrl: z
    .string()
    .max(200)
    .regex(/^(https?:\/\/[^/\s]+)?$/, "an origin like https://example.com, without a path")
    .default(""),
  availability: availabilitySchema.default("open"),
  locationCity: z.string().max(80).default(""),
  locationCountry: z
    .string()
    .regex(/^([A-Z]{2})?$/, "a two-letter country code like DE")
    .default(""),
  timezone: z
    .string()
    .max(64)
    .refine(isTimeZone, "an IANA time zone like Europe/Berlin")
    .default(""),
  avatarId: z.uuid().nullable().default(null),
});

export const socialInput = z.object({
  label: nonEmpty.max(60),
  href: nonEmpty.max(500),
  icon: iconKeySchema,
  isVisible: z.boolean().default(true),
});

export const skillTranslationInput = z.object({
  title: nonEmpty.max(120),
  caption: z.string().max(160),
  narrative: z.string().max(2000),
});

export const skillInput = z.object({
  id: slugSchema,
  icon: iconKeySchema,
  span: bentoSpanSchema,
  items: z.array(nonEmpty.max(60)).max(40),
  isVisible: z.boolean().default(true),
  translations: perLocale(skillTranslationInput),
});

export const metricInput = z.object({
  value: nonEmpty.max(40),
  label: nonEmpty.max(120),
  context: z.string().max(200).optional(),
});

export const projectTranslationInput = z.object({
  name: nonEmpty.max(160),
  descriptor: z.string().max(200),
  hook: z.string().max(600),
  problem: richInput,
  aiArchitecture: richInput,
  fullStackInfra: richInput,
  outcomes: z.array(z.string().max(400)).max(20),
  role: z.string().max(160).default(""),
  categoryLabel: z.string().max(80).default(""),
  metrics: z.array(metricInput).max(6).default([]),
  /** The long-form case study; empty = the project has no case-study page. */
  body: richLongInput.default(""),
  seoDescription: z.string().max(300).default(""),
});

export const galleryItemInput = z.object({
  mediaId: z.uuid(),
  caption: z.object({ en: z.string().max(300), de: z.string().max(300) }),
});

export const projectInput = z
  .object({
    slug: slugSchema,
    /** The cover from the media library. */
    coverId: z.uuid().nullable().default(null),
    stack: z.array(nonEmpty.max(60)).max(40),
    linkLive: z.string().max(500),
    linkRepo: z.string().max(500),
    linkCaseStudy: z.string().max(500),
    isVisible: z.boolean().default(true),
    featured: z.boolean().default(false),
    periodStart: isoDate.nullable().default(null),
    /** Null while ongoing. */
    periodEnd: isoDate.nullable().default(null),
    /** A stable key (`ai-platform`); its label is per locale. Empty = none. */
    category: z
      .string()
      .max(40)
      .regex(/^[a-z0-9-]*$/, "lowercase letters, digits and dashes only")
      .default(""),
    tags: z.array(nonEmpty.max(40)).max(20).default([]),
    gallery: z.array(galleryItemInput).max(30).default([]),
    translations: perLocale(projectTranslationInput),
  })
  .refine((p) => periodInOrder(p.periodStart, p.periodEnd), {
    message: "the end comes before the start",
    path: ["periodEnd"],
  })
  .refine((p) => p.periodStart !== null || p.periodEnd === null, {
    message: "an end needs a start",
    path: ["periodStart"],
  })
  .refine((p) => new Set(p.gallery.map((g) => g.mediaId)).size === p.gallery.length, {
    message: "the same image is in the gallery twice",
    path: ["gallery"],
  });

export const experienceTranslationInput = z.object({
  title: nonEmpty.max(200),
  summary: z.string().max(2000).default(""),
  highlights: z.array(z.string().max(400)).max(12).default([]),
});

export const experienceInput = z
  .object({
    kind: experienceKindSchema,
    orgName: nonEmpty.max(160),
    orgUrl: optionalUrl,
    logoId: z.uuid().nullable().default(null),
    location: z.string().max(160).default(""),
    employmentType: employmentTypeSchema.default(""),
    startDate: isoDate,
    /** Null = present. */
    endDate: isoDate.nullable().default(null),
    datePrecision: datePrecisionSchema.default("month"),
    credentialId: z.string().max(200).default(""),
    credentialUrl: optionalUrl,
    skills: z.array(nonEmpty.max(60)).max(30).default([]),
    isVisible: z.boolean().default(true),
    translations: perLocale(experienceTranslationInput),
  })
  .refine((e) => periodInOrder(e.startDate, e.endDate), {
    message: "the end comes before the start",
    path: ["endDate"],
  });

export const postTranslationInput = z.object({
  title: nonEmpty.max(200),
  excerpt: z.string().max(600).default(""),
  body: richLongInput.default(""),
  seoTitle: z.string().max(120).default(""),
  seoDescription: z.string().max(300).default(""),
});

export const postStatusSchema = z.enum(["draft", "published"]);

export const postInput = z
  .object({
    slug: slugSchema,
    status: postStatusSchema.default("draft"),
    /** When it goes (or went) live; a future time schedules it for the next publish after it. */
    publishedAt: z.iso.datetime({ offset: true }).nullable().default(null),
    coverId: z.uuid().nullable().default(null),
    tags: z.array(nonEmpty.max(40)).max(20).default([]),
    canonicalUrl: optionalUrl,
    /** Null = the post does not exist in that language. */
    translations: z.object({
      en: postTranslationInput.nullable(),
      de: postTranslationInput.nullable(),
    }),
  })
  .refine((p) => p.translations.en !== null || p.translations.de !== null, {
    message: "a post needs at least one language",
    path: ["translations"],
  })
  .refine((p) => p.status !== "published" || p.publishedAt !== null, {
    message: "a published post needs a publish date",
    path: ["publishedAt"],
  });

/** `imprint` and `privacy`, edited as one page per locale. */
export const legalSectionInput = z.object({
  title: nonEmpty.max(120),
  body: richLongInput,
});

export const resumeInput = z.object({ mediaId: z.uuid() });

export type ProfileInput = z.infer<typeof profileInput>;
export type SocialInput = z.infer<typeof socialInput>;
export type SkillInput = z.infer<typeof skillInput>;
export type SkillTranslationInput = z.infer<typeof skillTranslationInput>;
export type MetricInput = z.infer<typeof metricInput>;
export type ProjectTranslationInput = z.infer<typeof projectTranslationInput>;
export type GalleryItemInput = z.infer<typeof galleryItemInput>;
export type ProjectInput = z.infer<typeof projectInput>;
export type ExperienceTranslationInput = z.infer<typeof experienceTranslationInput>;
export type ExperienceInput = z.infer<typeof experienceInput>;
export type PostTranslationInput = z.infer<typeof postTranslationInput>;
export type PostStatus = z.infer<typeof postStatusSchema>;
export type PostInput = z.infer<typeof postInput>;
export type LegalSectionInput = z.infer<typeof legalSectionInput>;
