import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
    index("admin_sessions_user_idx").on(t.userId).where(sql`${t.revokedAt} is null`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
  },
  (t) => [index("content_versions_locale_created_idx").on(t.locale, t.createdAt.desc())],
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

/** Fixed-shape string trees: the `ui` translation tree and `seo` metadata. */
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
    check("content_documents_section_check", sql`${t.section} in ('ui', 'seo')`),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => adminUsers.id, { onDelete: "set null" }),
  },
  (t) => [check("site_profile_singleton", sql`${t.id}`)],
);

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
    check("socials_icon_check", sql`${t.icon} in ('github', 'linkedin', 'mail', 'twitter')`),
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
    check("skills_icon_check", sql`${t.icon} in ('cpu', 'brain-circuit', 'container', 'database')`),
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
    /** Unique, so identical bytes dedupe to one asset. */
    checksumSha256: bytea("checksum_sha256").notNull().unique(),
    altEn: text("alt_en"),
    altDe: text("alt_de"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
  },
  (t) => [index("media_assets_created_idx").on(t.createdAt.desc())],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    imageId: uuid("image_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    /** Resolved at publish time to an absolute URL; legacy `/projects/*.svg` passes through. */
    imagePath: text("image_path"),
    stack: jsonb("stack").$type<string[]>().notNull().default([]),
    linkLive: text("link_live"),
    linkRepo: text("link_repo"),
    linkCaseStudy: text("link_case_study"),
    /** Drives both render order and the GSAP sticky-stack z-index. */
    position: integer("position").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("projects_position_idx").on(t.position, t.id),
    index("projects_image_idx").on(t.imageId),
  ],
);

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
  },
  (t) => [primaryKey({ columns: [t.projectId, t.locale] })],
);

export type Locale = (typeof localeEnum.enumValues)[number];
