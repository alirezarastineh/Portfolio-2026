-- citext backs the case-insensitive unique on admin_users.email. Part of the
-- migration itself, so `drizzle-kit migrate` on an empty database works too.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('en', 'de');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"csrf_token" text NOT NULL,
	"pending_totp" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_pending_secret" text,
	"totp_enrolled_at" timestamp with time zone,
	"recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_attempts_outcome_check" CHECK ("auth_attempts"."outcome" in ('fail', 'success'))
);
--> statement-breakpoint
CREATE TABLE "content_documents" (
	"section" text NOT NULL,
	"locale" "locale" NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "content_documents_section_locale_pk" PRIMARY KEY("section","locale"),
	CONSTRAINT "content_documents_section_check" CHECK ("content_documents"."section" in ('ui', 'seo'))
);
--> statement-breakpoint
CREATE TABLE "content_pointers" (
	"locale" "locale" PRIMARY KEY NOT NULL,
	"version_id" bigint NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"locale" "locale" NOT NULL,
	"payload" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"checksum_sha256" "bytea" NOT NULL,
	"alt_en" text,
	"alt_de" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "media_assets_filename_unique" UNIQUE("filename"),
	CONSTRAINT "media_assets_checksum_sha256_unique" UNIQUE("checksum_sha256")
);
--> statement-breakpoint
CREATE TABLE "project_translations" (
	"project_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"name" text NOT NULL,
	"descriptor" text NOT NULL,
	"hook" text NOT NULL,
	"problem" text NOT NULL,
	"ai_architecture" text NOT NULL,
	"full_stack_infra" text NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "project_translations_project_id_locale_pk" PRIMARY KEY("project_id","locale")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"image_id" uuid,
	"image_path" text,
	"stack" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"link_live" text,
	"link_repo" text,
	"link_case_study" text,
	"position" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "site_profile" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"contact_email" text NOT NULL,
	"primary_cta_href" text NOT NULL,
	"secondary_cta_href" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "site_profile_singleton" CHECK ("site_profile"."id")
);
--> statement-breakpoint
CREATE TABLE "skill_translations" (
	"skill_id" text NOT NULL,
	"locale" "locale" NOT NULL,
	"title" text NOT NULL,
	"caption" text NOT NULL,
	"narrative" text NOT NULL,
	CONSTRAINT "skill_translations_skill_id_locale_pk" PRIMARY KEY("skill_id","locale")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"icon" text NOT NULL,
	"span" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_icon_check" CHECK ("skills"."icon" in ('cpu', 'brain-circuit', 'container', 'database')),
	CONSTRAINT "skills_span_check" CHECK ("skills"."span" in ('lg', 'tall', 'sm'))
);
--> statement-breakpoint
CREATE TABLE "socials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"href" text NOT NULL,
	"icon" text NOT NULL,
	"position" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "socials_icon_check" CHECK ("socials"."icon" in ('github', 'linkedin', 'mail', 'twitter'))
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pointers" ADD CONSTRAINT "content_pointers_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pointers" ADD CONSTRAINT "content_pointers_published_by_admin_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_translations" ADD CONSTRAINT "project_translations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_image_id_media_assets_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_profile" ADD CONSTRAINT "site_profile_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_translations" ADD CONSTRAINT "skill_translations_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("user_id") WHERE "admin_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "admin_sessions_idle_expiry_idx" ON "admin_sessions" USING btree ("idle_expires_at");--> statement-breakpoint
CREATE INDEX "auth_attempts_bucket_time_idx" ON "auth_attempts" USING btree ("bucket","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_versions_locale_created_idx" ON "content_versions" USING btree ("locale","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "media_assets_created_idx" ON "media_assets" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "projects_position_idx" ON "projects" USING btree ("position","id");--> statement-breakpoint
CREATE INDEX "projects_image_idx" ON "projects" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "skills_position_idx" ON "skills" USING btree ("position","id");--> statement-breakpoint
CREATE INDEX "socials_position_idx" ON "socials" USING btree ("position","id");