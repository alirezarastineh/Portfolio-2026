import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { AuditAlternative } from "../ask/audit.js";
import type { AnswerChecks } from "../ask/checks.js";
import type { CorpusDocument, PostFacts, ProjectFacts } from "../ask/corpus/build.js";
import type { AnswerJudgment } from "../ask/evals/calibration.js";
import type { AskTranscript } from "../ask/handoff.js";
import type { ReviewLabels } from "../ask/reviews.js";
import type { ToolName } from "../ask/tools.js";
import type { AnswerTrace } from "../ask/trace.js";

/* -------------------------------------------------------------------------- */
/* Custom column types                                                         */
/* -------------------------------------------------------------------------- */

/** Case-insensitive text. Requires `CREATE EXTENSION IF NOT EXISTS citext`. */
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

/** Raw bytes — used for sha256 digests so comparisons are constant-width. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const localeEnum = pgEnum("locale", ["en", "de"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  /** argon2id encoded string, including params and salt. */
  passwordHash: text("password_hash").notNull(),
  /**
   * TOTP secret, sealed with AES-GCM when TOTP_ENC_KEY is set (see
   * lib/secret-box.ts), plain base32 otherwise; null until enrolment is confirmed.
   */
  totpSecret: text("totp_secret"),
  /** Holds the secret between `setup` and `confirm`, so a failed enrolment never locks the account. */
  totpPendingSecret: text("totp_pending_secret"),
  totpEnrolledAt: timestamp("totp_enrolled_at", { withTimezone: true }),
  /** Last accepted TOTP time step; a code at or below it is a replay and is refused. */
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  /** argon2id hashes of single-use recovery codes; spliced out as they are consumed. */
  recoveryCodeHashes: jsonb("recovery_code_hashes").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const adminSessions = pgTable(
  "admin_sessions",
  {
    /** Surrogate key. Deliberately NOT the cookie value — that is only ever stored hashed. */
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    /** sha256 of the cookie token, so a DB leak does not hand over live sessions. */
    tokenHash: bytea("token_hash").notNull().unique(),
    /** Double-submit CSRF value, mirrored into a readable cookie. */
    csrfToken: text("csrf_token").notNull(),
    /** True between password verification and TOTP confirmation. Unlocks only POST /auth/totp. */
    pendingTotp: boolean("pending_totp").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("admin_sessions_user_idx")
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
    index("admin_sessions_idle_expiry_idx").on(t.idleExpiresAt),
  ],
);

/** Backs the DB-side login limiter, which unlike the in-memory one survives restarts. */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** `ip:<addr>` or `email:<lowercased>`. */
    bucket: text("bucket").notNull(),
    outcome: text("outcome").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("auth_attempts_bucket_time_idx").on(t.bucket, t.occurredAt.desc()),
    check("auth_attempts_outcome_check", sql`${t.outcome} in ('fail', 'success')`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Published snapshots — the only thing the public read path touches           */
/* -------------------------------------------------------------------------- */

/**
 * One publish (or rollback) as a unit: the versions of every locale it wrote.
 * Rolling back a publication moves all of its locales together, so English
 * and German can never be left pointing at different moments.
 */
export const contentPublications = pgTable(
  "content_publications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull().default("publish"),
    label: text("label"),
    /** appContentSchema version the payloads were written with. */
    schemaVersion: integer("schema_version").notNull().default(1),
    /** Set on a rollback: the publication whose content it restored. */
    restoredFrom: bigint("restored_from", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    index("content_publications_created_idx").on(t.createdAt.desc()),
    check("content_publications_kind_check", sql`${t.kind} in ('publish', 'rollback')`),
  ],
);

export const contentVersions = pgTable(
  "content_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    locale: localeEnum("locale").notNull(),
    /** A full AppContent payload, validated by appContentSchema before insert. */
    payload: jsonb("payload").notNull(),
    /** sha256 of the canonical JSON, so identical republishes are detectable. */
    checksum: text("checksum").notNull(),
    label: text("label"),
    /** The publish or rollback that wrote it, together with the other locales' versions. */
    publicationId: bigint("publication_id", { mode: "number" })
      .notNull()
      .references(() => contentPublications.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    index("content_versions_locale_created_idx").on(t.locale, t.createdAt.desc()),
    index("content_versions_publication_idx").on(t.publicationId),
  ],
);

/**
 * The long-form bodies of a published version (a case study, a post, a legal
 * page), kept out of `content_versions.payload` so the core every page loads
 * stays small. Keyed by the version, so a body can never be served with a
 * different version's core, and one pointer move publishes or rolls back both.
 */
export const contentVersionDocs = pgTable(
  "content_version_docs",
  {
    versionId: bigint("version_id", { mode: "number" })
      .notNull()
      .references(() => contentVersions.id, { onDelete: "cascade" }),
    /** `project:<slug>`, `post:<slug>` or `legal:<doc>`. */
    key: text("key").notNull(),
    payload: jsonb("payload").notNull(),
    checksum: text("checksum").notNull(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.key] })],
);

/** Exactly two rows — one per locale. Rollback repoints these; history is never mutated. */
export const contentPointers = pgTable("content_pointers", {
  locale: localeEnum("locale").primaryKey(),
  versionId: bigint("version_id", { mode: "number" })
    .notNull()
    .references(() => contentVersions.id),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  publishedBy: uuid("published_by").references(() => adminUsers.id, { onDelete: "set null" }),
});

/* -------------------------------------------------------------------------- */
/* Working set — this IS the draft                                             */
/* -------------------------------------------------------------------------- */

/**
 * Fixed-shape trees, one row per locale: the `ui` translation tree, `seo`
 * metadata, and the two legal pages (`imprint`, `privacy`: `{title, body}`).
 */
export const contentDocuments = pgTable(
  "content_documents",
  {
    section: text("section").notNull(),
    locale: localeEnum("locale").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => adminUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.section, t.locale] }),
    check(
      "content_documents_section_check",
      sql`${t.section} in ('ui', 'seo', 'imprint', 'privacy')`,
    ),
  ],
);

/**
 * Locale-invariant identity only. Every display string lives in the `ui` document
 * instead — which is what resolves the profile/i18n duplication.
 */
export const siteProfile = pgTable(
  "site_profile",
  {
    id: boolean("id").primaryKey().default(true),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    contactEmail: text("contact_email").notNull(),
    primaryCtaHref: text("primary_cta_href").notNull(),
    secondaryCtaHref: text("secondary_cta_href").notNull(),
    /** The public origin (`https://alirezarastineh.me`); absolute URLs are built from it. */
    siteUrl: text("site_url"),
    availability: text("availability").notNull().default("open"),
    locationCity: text("location_city").notNull().default(""),
    /** ISO 3166-1 alpha-2, or empty. */
    locationCountry: text("location_country").notNull().default(""),
    /** IANA zone, e.g. `Europe/Berlin`. */
    timezone: text("timezone").notNull().default(""),
    avatarId: uuid("avatar_id").references(() => mediaAssets.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => adminUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    check("site_profile_singleton", sql`${t.id}`),
    check(
      "site_profile_availability_check",
      sql`${t.availability} in ('open', 'limited', 'closed')`,
    ),
    check("site_profile_country_check", sql`${t.locationCountry} ~ '^([A-Z]{2})?$'`),
  ],
);

/** The CV per language: a PDF from the media library. */
export const profileResumes = pgTable("profile_resumes", {
  locale: localeEnum("locale").primaryKey(),
  mediaId: uuid("media_id")
    .notNull()
    .references(() => mediaAssets.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const socials = pgTable(
  "socials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Brand name ("GitHub"); not localized. */
    label: text("label").notNull(),
    href: text("href").notNull(),
    icon: text("icon").notNull(),
    position: integer("position").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("socials_position_idx").on(t.position, t.id),
    // A key into the client's icon registry, which owns the list of known
    // icons; an unknown key renders a neutral fallback rather than failing.
    check("socials_icon_check", sql`${t.icon} ~ '^[a-z0-9-]{1,40}$'`),
  ],
);

export const skills = pgTable(
  "skills",
  {
    /** Stable slug, e.g. 'core-architecture'. Replaces today's fragile array-index join. */
    id: text("id").primaryKey(),
    icon: text("icon").notNull(),
    span: text("span").notNull(),
    /** Ordered tech tags; not localized. */
    items: jsonb("items").$type<string[]>().notNull().default([]),
    position: integer("position").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("skills_position_idx").on(t.position, t.id),
    check("skills_icon_check", sql`${t.icon} ~ '^[a-z0-9-]{1,40}$'`),
    check("skills_span_check", sql`${t.span} in ('lg', 'tall', 'sm')`),
  ],
);

export const skillTranslations = pgTable(
  "skill_translations",
  {
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    locale: localeEnum("locale").notNull(),
    title: text("title").notNull(),
    caption: text("caption").notNull(),
    narrative: text("narrative").notNull(),
  },
  (t) => [primaryKey({ columns: [t.skillId, t.locale] })],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `<uuid>.<ext>` — derived from sniffed bytes, never from user input. */
    filename: text("filename").notNull().unique(),
    /** Display only. Never touches the filesystem. */
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Unique, so identical bytes dedupe to one asset. Taken over the uploaded bytes. */
    checksumSha256: bytea("checksum_sha256").notNull().unique(),
    /** `image` (processed, with variants) or `document` (a PDF, stored as-is). */
    kind: text("kind").notNull().default("image"),
    /** Tiny blurred WebP as a data: URI, shown while the real image loads. */
    blurDataUri: text("blur_data_uri"),
    altEn: text("alt_en"),
    altDe: text("alt_de"),
    /**
     * What a diagram or screenshot shows, for the assistant (plan phase 17):
     * its parts and how they connect. The copilot drafts it, the admin saves
     * it; the assistant reads it at once, and no page sends it to visitors.
     */
    descriptionEn: text("description_en"),
    descriptionDe: text("description_de"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    index("media_assets_created_idx").on(t.createdAt.desc()),
    check("media_assets_kind_check", sql`${t.kind} in ('image', 'document')`),
  ],
);

/** Resized WebP/AVIF copies of an image, for `srcset`. Deleted with their asset. */
export const mediaVariants = pgTable(
  "media_variants",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** `<asset uuid>-<width>w.<format>`, served by the same route as the original. */
    filename: text("filename").notNull().unique(),
    byteSize: integer("byte_size").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.format, t.width] }),
    check("media_variants_format_check", sql`${t.format} in ('webp', 'avif')`),
  ],
);

/**
 * Which media each published version uses, recorded at publish time. Deleting
 * an asset a live version points at would break the public site, and one used
 * by an older version would break a rollback to it — this is what lets the
 * media routes refuse or warn.
 */
export const versionMediaRefs = pgTable(
  "version_media_refs",
  {
    versionId: bigint("version_id", { mode: "number" })
      .notNull()
      .references(() => contentVersions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.assetId] }),
    index("version_media_refs_asset_idx").on(t.assetId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    /** The cover image, from the media library. None: the card shows no picture. */
    coverId: uuid("cover_id").references(() => mediaAssets.id, { onDelete: "restrict" }),
    stack: jsonb("stack").$type<string[]>().notNull().default([]),
    linkLive: text("link_live"),
    linkRepo: text("link_repo"),
    linkCaseStudy: text("link_case_study"),
    featured: boolean("featured").notNull().default(false),
    periodStart: date("period_start", { mode: "string" }),
    /** Null while the project is ongoing. */
    periodEnd: date("period_end", { mode: "string" }),
    /** Stable key (`ai-platform`); its label is translated per locale. */
    category: text("category"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /** Drives both render order and the GSAP sticky-stack z-index. */
    position: integer("position").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("projects_position_idx").on(t.position, t.id),
    index("projects_cover_idx").on(t.coverId),
  ],
);

export interface MetricValue {
  value: string;
  label: string;
  context?: string;
}

export const projectTranslations = pgTable(
  "project_translations",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    locale: localeEnum("locale").notNull(),
    name: text("name").notNull(),
    descriptor: text("descriptor").notNull(),
    hook: text("hook").notNull(),
    problem: text("problem").notNull(),
    aiArchitecture: text("ai_architecture").notNull(),
    fullStackInfra: text("full_stack_infra").notNull(),
    outcomes: jsonb("outcomes").$type<string[]>().notNull().default([]),
    role: text("role").notNull().default(""),
    categoryLabel: text("category_label").notNull().default(""),
    /** Per locale, since number formatting differs ("40%" vs "40 %"). */
    metrics: jsonb("metrics").$type<MetricValue[]>().notNull().default([]),
    /** The long-form case study, sanitized rich text. Empty = no case-study page. */
    body: text("body").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.locale] })],
);

/** Screenshots shown on a case study, in order. */
export const projectGallery = pgTable(
  "project_gallery",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    caption: jsonb("caption").$type<Partial<Record<"en" | "de", string>>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.mediaId] }),
    index("project_gallery_media_idx").on(t.mediaId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Experience timeline                                                         */
/* -------------------------------------------------------------------------- */

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().default("work"),
    orgName: text("org_name").notNull(),
    orgUrl: text("org_url"),
    logoId: uuid("logo_id").references(() => mediaAssets.id, { onDelete: "restrict" }),
    location: text("location").notNull().default(""),
    /** A key (`full-time`, `contract`, …) whose label is translated in `ui.experience`. */
    employmentType: text("employment_type").notNull().default(""),
    startDate: date("start_date", { mode: "string" }).notNull(),
    /** Null = present. */
    endDate: date("end_date", { mode: "string" }),
    /** Whether the dates mean a month or only a year. */
    datePrecision: text("date_precision").notNull().default("month"),
    credentialId: text("credential_id"),
    credentialUrl: text("credential_url"),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    position: integer("position").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("experiences_position_idx").on(t.position, t.id),
    index("experiences_logo_idx").on(t.logoId),
    check("experiences_kind_check", sql`${t.kind} in ('work', 'education', 'certification')`),
    check("experiences_precision_check", sql`${t.datePrecision} in ('month', 'year')`),
    check(
      "experiences_employment_type_check",
      sql`${t.employmentType} in ('', 'full-time', 'part-time', 'contract', 'freelance', 'internship')`,
    ),
    check("experiences_period_check", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);

export const experienceTranslations = pgTable(
  "experience_translations",
  {
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    locale: localeEnum("locale").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.experienceId, t.locale] })],
);

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Shared by both languages; a post may exist in only one of them. */
    slug: text("slug").notNull(),
    status: text("status").notNull().default("draft"),
    /** Published posts show only once this has passed (and after a publish). */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    coverId: uuid("cover_id").references(() => mediaAssets.id, { onDelete: "restrict" }),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /** Set when the post first appeared elsewhere; becomes its canonical URL. */
    canonicalUrl: text("canonical_url"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("posts_slug_idx").on(t.slug),
    index("posts_published_idx").on(t.publishedAt.desc()),
    index("posts_cover_idx").on(t.coverId),
    check("posts_status_check", sql`${t.status} in ('draft', 'published')`),
    check(
      "posts_published_at_check",
      sql`${t.status} <> 'published' or ${t.publishedAt} is not null`,
    ),
  ],
);

/** A missing row means the post does not exist in that language. */
export const postTranslations = pgTable(
  "post_translations",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    locale: localeEnum("locale").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    body: text("body").notNull().default(""),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.locale] })],
);

/* -------------------------------------------------------------------------- */
/* Contact form                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every message is stored before the email is attempted, so a mail outage
 * delays a message instead of losing it. Pruned after 180 days.
 */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    locale: localeEnum("locale"),
    name: text("name").notNull(),
    email: citext("email").notNull(),
    message: text("message").notNull(),
    /** Salted sha256 of the sender's IP: enough to rate-limit, not to identify. */
    ipHash: text("ip_hash").notNull(),
    status: text("status").notNull().default("new"),
    mailStatus: text("mail_status").notNull().default("pending"),
    mailError: text("mail_error"),
    /** `ask` when the assistant's hand-off wrote the draft (plan phase 11), else `form`. */
    origin: text("origin").notNull().default("form"),
    /** The answer the hand-off came from, when the visitor attached the conversation. */
    askMessageId: text("ask_message_id").references(() => aiMessages.id, {
      onDelete: "set null",
    }),
    /** That conversation (`ask/handoff.ts`), attached only with the visitor's tick. */
    askTranscript: jsonb("ask_transcript").$type<AskTranscript>(),
  },
  (t) => [
    index("contact_messages_created_idx").on(t.createdAt.desc()),
    index("contact_messages_ip_created_idx").on(t.ipHash, t.createdAt),
    check("contact_messages_status_check", sql`${t.status} in ('new', 'read', 'archived', 'spam')`),
    check(
      "contact_messages_mail_status_check",
      sql`${t.mailStatus} in ('pending', 'sent', 'failed', 'skipped')`,
    ),
    check("contact_messages_origin_check", sql`${t.origin} in ('form', 'ask')`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Portfolio assistant                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What the admin can change without a deploy. One row (id 1); a missing row
 * means the defaults below, so a fresh database needs no seed.
 */
export const aiSettings = pgTable(
  "ai_settings",
  {
    id: integer("id").primaryKey().default(1),
    /** The admin's switch; `SERVER_AI_ENABLED` is the deploy's. Both must be on. */
    enabled: boolean("enabled").notNull().default(true),
    /** Null = `SERVER_AI_DAILY_BUDGET_USD`. */
    dailyBudgetUsd: doublePrecision("daily_budget_usd"),
    deepEnabled: boolean("deep_enabled").notNull().default(true),
    suggestedQuestions: jsonb("suggested_questions")
      .$type<Record<Locale, string[]>>()
      .notNull()
      .default({ en: [], de: [] }),
    /** "How does this assistant work?", per language; empty = the built-in text. */
    systemCard: jsonb("system_card")
      .$type<Record<Locale, string>>()
      .notNull()
      .default({ en: "", de: "" }),
    /** The outcome metric watched first (`ask/outcomes.ts`); it rotates when it goes flat. */
    primaryMetric: text("primary_metric").notNull().default("helpfulRate"),
    /**
     * The share of the daily budget kept for visitors (`ask/features.ts`): the
     * admin's tools and background work stop once the day's spend reaches the rest.
     */
    publicReserve: doublePrecision("public_reserve").notNull().default(0.5),
    /** Per fenced feature, its own daily cap in USD; a missing key or null = none. */
    featureCaps: jsonb("feature_caps")
      .$type<Partial<Record<string, number | null>>>()
      .notNull()
      .default({}),
    /** Per switchable feature, the admin's switch; a missing key = the feature's default. */
    featureSwitches: jsonb("feature_switches")
      .$type<Partial<Record<string, boolean>>>()
      .notNull()
      .default({}),
    /**
     * The corpus tiers the admin applied (`ask/perception.ts` suggests them):
     * document ids held whole at the front of the core, or cut shorter.
     */
    corpusTiers: jsonb("corpus_tiers")
      .$type<{ promoted: string[]; demoted: string[] }>()
      .notNull()
      .default({ promoted: [], demoted: [] }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("ai_settings_singleton_check", sql`${t.id} = 1`),
    check(
      "ai_settings_public_reserve_check",
      sql`${t.publicReserve} >= 0 and ${t.publicReserve} <= 0.9`,
    ),
  ],
);

/** Curated answers the assistant may cite; live on save, never published. */
export const aiFaq = pgTable(
  "ai_faq",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    position: integer("position").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("ai_faq_position_idx").on(t.position, t.id)],
);

export const aiFaqTranslations = pgTable(
  "ai_faq_translations",
  {
    faqId: uuid("faq_id")
      .notNull()
      .references(() => aiFaq.id, { onDelete: "cascade" }),
    locale: localeEnum("locale").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.faqId, t.locale] })],
);

/** What a day's model calls took and cost: `ai_usage` and `ai_usage_features` share them. */
const usageCounters = {
  /** Model calls, not answers: one answer can take several steps or fallbacks. */
  requests: integer("requests").notNull().default(0),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  thoughtTokens: bigint("thought_tokens", { mode: "number" }).notNull().default(0),
  usd: doublePrecision("usd").notNull().default(0),
};

/**
 * Aggregates only (no content), per UTC day and model; kept indefinitely. The
 * day's total, which the daily budget reads.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    day: date("day", { mode: "string" }).notNull(),
    model: text("model").notNull(),
    ...usageCounters,
  },
  (t) => [primaryKey({ columns: [t.day, t.model] })],
);

/**
 * The same calls split by feature (`ask/features.ts`): the terminal, the
 * playground, the copilot, insights, each kind of run. Written right after
 * `ai_usage`, as a separate statement whose failure is logged and dropped
 * (`ask/usage.ts`): the total stays exact, a feature's own spend can only fall
 * short. The fences read each feature's own spend here. The feature is not a
 * check constraint, so a new feature needs no migration.
 */
export const aiUsageFeatures = pgTable(
  "ai_usage_features",
  {
    day: date("day", { mode: "string" }).notNull(),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    ...usageCounters,
  },
  (t) => [primaryKey({ columns: [t.day, t.feature, t.model] })],
);

/**
 * One row per answer, redacted before insert: no IPs, emails or phone numbers.
 * Pruned after 90 days.
 */
export const aiMessages = pgTable(
  "ai_messages",
  {
    /** The assistant message id the visitor's browser holds (feedback refers to it). */
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Salted hash of the tab's random session id. */
    sessionHash: text("session_hash").notNull(),
    locale: localeEnum("locale").notNull(),
    /** `terminal` (visitors), `playground` (the admin, draft content) or `eval`. */
    source: text("source").notNull().default("terminal"),
    /** `lite`, `deep`, or `answer-only` when only a model without tools was left. */
    route: text("route").notNull(),
    questionRedacted: text("question_redacted").notNull(),
    answerExcerpt: text("answer_excerpt").notNull().default(""),
    citedIds: jsonb("cited_ids").$type<string[]>().notNull().default([]),
    toolCalls: jsonb("tool_calls").$type<string[]>().notNull().default([]),
    /** The model that produced the answer; null when none did. */
    model: text("model"),
    attempts: jsonb("attempts").$type<unknown[]>().notNull().default([]),
    ttftMs: integer("ttft_ms"),
    totalMs: integer("total_ms").notNull(),
    tokens: jsonb("tokens")
      .$type<{ input: number; cached: number; output: number; thoughts: number }>()
      .notNull(),
    usd: doublePrecision("usd").notNull().default(0),
    finishReason: text("finish_reason").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** What the answer did, step by step (`ask/trace.ts`); null on rows from before traces. */
    trace: jsonb("trace").$type<AnswerTrace>(),
    /** Citation ids the model invented; removed before the visitor saw them. */
    droppedCitations: jsonb("dropped_citations").$type<string[]>().notNull().default([]),
    /** The corpus the answer was grounded in. */
    corpusKey: text("corpus_key"),
    /** The deterministic checks' flags on the finished answer (`ask/checks.ts`). */
    checks: jsonb("checks").$type<AnswerChecks>(),
    /** A judge's verdict: the calibration run (plan phase 10), the nightly judge (phase 26). */
    judge: jsonb("judge").$type<AnswerJudgment>(),
    /** When the visitor said yes to this answer's hand-off offer (the outcomes funnel). */
    handoffConfirmedAt: timestamp("handoff_confirmed_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_messages_created_idx").on(t.createdAt.desc()),
    index("ai_messages_session_idx").on(t.sessionHash, t.createdAt),
    check("ai_messages_source_check", sql`${t.source} in ('terminal', 'playground', 'eval')`),
  ],
);

/**
 * The weekly human review of visitor answers (`ask/reviews.ts`): five
 * verdicts and a note. A review goes with its answer when that is pruned.
 */
export const aiReviews = pgTable("ai_reviews", {
  messageId: text("message_id")
    .primaryKey()
    .references(() => aiMessages.id, { onDelete: "cascade" }),
  labels: jsonb("labels").$type<ReviewLabels>().notNull(),
  note: text("note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The assistant's search vectors (plan phase 18, `ask/embeddings.ts`): one per
 * chunk of the published corpus and model, keyed by a hash of the chunk's
 * text, so a changed chunk gets a new one. Written only by the API that ran
 * the migrations; a row older than 30 days whose chunk is no longer in the
 * live corpus is pruned.
 */
export const aiEmbeddings = pgTable(
  "ai_embeddings",
  {
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    dims: integer("dims").notNull(),
    vector: real("vector").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contentHash, t.model] })],
);

/**
 * The published corpus as it was, per corpus key (`ask/corpus/snapshots.ts`):
 * written with the first visitor answer on a key, kept while an answer or an
 * eval case refers to it.
 */
export const aiCorpusSnapshots = pgTable("ai_corpus_snapshots", {
  key: text("key").primaryKey(),
  documents: jsonb("documents").$type<CorpusDocument[]>().notNull(),
  projects: jsonb("projects").$type<ProjectFacts[]>().notNull(),
  posts: jsonb("posts").$type<PostFacts[]>().notNull(),
  coreTokens: integer("core_tokens").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Eval cases frozen from visitor answers (`ask/evals/production.ts`): the
 * redacted question, the snapshot it was answered from, and what a good
 * answer must do. Patterns are case-insensitive regular expressions.
 */
export const aiEvalCases = pgTable(
  "ai_eval_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suite: text("suite").notNull().default("production"),
    question: text("question").notNull(),
    locale: localeEnum("locale").notNull(),
    snapshotKey: text("snapshot_key")
      .notNull()
      .references(() => aiCorpusSnapshots.key, { onDelete: "restrict" }),
    mustCite: jsonb("must_cite").$type<string[]>().notNull().default([]),
    citeAny: jsonb("cite_any").$type<string[]>().notNull().default([]),
    mustInclude: jsonb("must_include").$type<string[]>().notNull().default([]),
    mustNotInclude: jsonb("must_not_include").$type<string[]>().notNull().default([]),
    expectTool: jsonb("expect_tool").$type<{
      name: ToolName;
      input?: Record<string, unknown>;
    }>(),
    judge: boolean("judge").notNull().default(true),
    /** The answer it was frozen from; null once that answer is pruned. */
    fromMessageId: text("from_message_id").references(() => aiMessages.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_eval_cases_suite_status_idx").on(t.suite, t.status),
    check("ai_eval_cases_status_check", sql`${t.status} in ('active', 'retired')`),
    check("ai_eval_cases_suite_check", sql`${t.suite} in ('production')`),
  ],
);

export const aiFeedback = pgTable(
  "ai_feedback",
  {
    messageId: text("message_id")
      .primaryKey()
      .references(() => aiMessages.id, { onDelete: "cascade" }),
    value: smallint("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("ai_feedback_value_check", sql`${t.value} in (-1, 1)`)],
);

/**
 * Requests the public assistant turned away, per UTC day and kind
 * (`ask/guard-events.ts`). Aggregates only, no content; kept like `ai_usage`.
 */
export const aiGuardEvents = pgTable(
  "ai_guard_events",
  {
    day: date("day", { mode: "string" }).notNull(),
    kind: text("kind").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.kind] })],
);

/**
 * Long, paid work run in the background (`ask/runs/`): the eval suite today;
 * the pairwise and nightly judges, insights and the content agent later. At
 * most one queued or running run per kind; its items are the checkpoint a
 * resumed run continues from.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    progress: jsonb("progress")
      .$type<{ total: number; done: number; failed: number; unavailable: number }>()
      .notNull()
      .default({ total: 0, done: 0, failed: 0, unavailable: 0 }),
    summary: jsonb("summary").$type<unknown>(),
    usd: doublePrecision("usd").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_runs_created_idx").on(t.createdAt.desc()),
    uniqueIndex("ai_runs_one_active_per_kind")
      .on(t.kind)
      .where(sql`${t.status} in ('queued', 'running')`),
    check(
      "ai_runs_kind_check",
      sql`${t.kind} in ('eval', 'pairwise', 'judge', 'insights', 'agent')`,
    ),
    check(
      "ai_runs_status_check",
      sql`${t.status} in ('queued', 'running', 'done', 'failed', 'cancelled', 'interrupted')`,
    ),
  ],
);

export const aiRunItems = pgTable(
  "ai_run_items",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** The order the items run in. */
    position: integer("position").notNull(),
    status: text("status").notNull().default("pending"),
    result: jsonb("result").$type<unknown>(),
    attempts: integer("attempts").notNull().default(0),
    usd: doublePrecision("usd").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.key] }),
    check(
      "ai_run_items_status_check",
      sql`${t.status} in ('pending', 'running', 'done', 'failed', 'unavailable')`,
    ),
  ],
);

/** Rate-limit events, keyed by a salted IP hash or session hash; pruned after a day. */
export const aiRateEvents = pgTable(
  "ai_rate_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    bucket: text("bucket").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_rate_events_bucket_time_idx").on(t.bucket, t.occurredAt.desc())],
);

/**
 * The governance log (plan phase 14, `ask/audit.ts`): what was done or
 * refused, by whom, on what, why, and what was considered but rejected. The
 * current demotions are read from it (the latest `demote` or `reinstate` per
 * target), so a demotion is its audit row. No visitor text: reasons are
 * numbers, flags and setting names, targets are ids. Kept indefinitely (small).
 */
export const aiAudit = pgTable(
  "ai_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    /** `trust.check`, `demote`, `reinstate`, `answer`, `run.spend`, `settings.update`. */
    action: text("action").notNull(),
    /** `model:<id>`, `route:deep`, a message or run id, `settings`. */
    target: text("target").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason").notNull().default(""),
    /** What was considered but rejected, or a check's verdicts. */
    alternatives: jsonb("alternatives").$type<AuditAlternative[]>().notNull().default([]),
    /** For a human to look at: shown on the Overview until seen. */
    alert: boolean("alert").notNull().default(false),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_audit_at_idx").on(t.at.desc()),
    index("ai_audit_state_idx")
      .on(t.target, t.at.desc())
      .where(sql`${t.action} in ('demote', 'reinstate')`),
    index("ai_audit_open_alerts_idx")
      .on(t.at.desc())
      .where(sql`${t.alert} and ${t.seenAt} is null`),
    check("ai_audit_actor_check", sql`${t.actor} in ('admin', 'agent', 'system')`),
    check("ai_audit_decision_check", sql`${t.decision} in ('allowed', 'denied', 'asked')`),
  ],
);

export type Locale = (typeof localeEnum.enumValues)[number];
