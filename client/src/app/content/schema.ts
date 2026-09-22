/**
 * MIRRORED COPY — do not edit.
 *
 * Generated from `server/src/content/schema.ts` by `pnpm content:sync`.
 * Edit the canonical file there and re-run the sync; `schema-parity.spec.ts`
 * fails the test suite if these two drift apart.
 */
// ─── SHARED CONTENT SCHEMA — everything below this line is mirrored verbatim ───
import { z } from "zod";

const nonEmpty = z.string().min(1);

/** Guards an interpolation token against being deleted by an editor. */
const withToken = (token: string) =>
  z.string().min(1).refine((s) => s.includes(token), `must contain ${token}`);

/**
 * Sanitized HTML from the Tiptap editor. Kept as a distinct alias so the
 * templates that render it with `[innerHTML]` are greppable, and so the write
 * path knows which fields to run through the sanitizer.
 *
 * Sanitizing happens on write (see `sanitizeRichText`), not only at render —
 * the content endpoint is public, and anything could consume it.
 */
export const richText = z.string().max(20000);

export const LOCALES = ["en", "de"] as const;
export const localeSchema = z.enum(LOCALES);

export const socialIconSchema = z.enum(["github", "linkedin", "mail", "twitter"]);
export const skillIconSchema = z.enum(["cpu", "brain-circuit", "container", "database"]);
export const bentoSpanSchema = z.enum(["lg", "tall", "sm"]);

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
});

/** Locale-invariant identity. Every display string belongs in `ui` instead. */
export const identitySchema = z.object({
  name: nonEmpty,
  handle: nonEmpty,
  contactEmail: z.email(),
  primaryCtaHref: nonEmpty,
  secondaryCtaHref: nonEmpty,
});

export const socialSchema = z.object({
  label: nonEmpty,
  href: nonEmpty,
  icon: socialIconSchema,
});

export const skillSchema = z.object({
  id: nonEmpty,
  icon: skillIconSchema,
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
  /** Absolute media URL, or a legacy `/projects/*.svg` path. */
  image: z.string(),
  links: projectLinksSchema,
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

/** One published snapshot for one locale. */
export const appContentSchema = z.object({
  version: z.literal(1),
  locale: localeSchema,
  ui: uiSchema,
  identity: identitySchema,
  socials: z.array(socialSchema),
  skills: z.array(skillSchema),
  projects: z.array(projectSchema),
  seo: seoSchema,
});

export type Locale = z.infer<typeof localeSchema>;
export type SocialIcon = z.infer<typeof socialIconSchema>;
export type SkillIcon = z.infer<typeof skillIconSchema>;
export type BentoSpan = z.infer<typeof bentoSpanSchema>;
export type Social = z.infer<typeof socialSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectLinks = z.infer<typeof projectLinksSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type Seo = z.infer<typeof seoSchema>;
export type AppContent = z.infer<typeof appContentSchema>;
/** Replaces the old `typeof en`, so templates and the DB share one type. */
export type AppTranslations = AppContent["ui"];
