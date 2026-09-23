CREATE TABLE "content_version_docs" (
	"version_id" bigint NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"checksum" text NOT NULL,
	CONSTRAINT "content_version_docs_version_id_key_pk" PRIMARY KEY("version_id","key")
);
--> statement-breakpoint
CREATE TABLE "experience_translations" (
	"experience_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experience_translations_experience_id_locale_pk" PRIMARY KEY("experience_id","locale")
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'work' NOT NULL,
	"org_name" text NOT NULL,
	"org_url" text,
	"logo_id" uuid,
	"location" text DEFAULT '' NOT NULL,
	"employment_type" text DEFAULT '' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"date_precision" text DEFAULT 'month' NOT NULL,
	"credential_id" text,
	"credential_url" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_kind_check" CHECK ("experiences"."kind" in ('work', 'education', 'certification')),
	CONSTRAINT "experiences_precision_check" CHECK ("experiences"."date_precision" in ('month', 'year')),
	CONSTRAINT "experiences_employment_type_check" CHECK ("experiences"."employment_type" in ('', 'full-time', 'part-time', 'contract', 'freelance', 'internship')),
	CONSTRAINT "experiences_period_check" CHECK ("experiences"."end_date" is null or "experiences"."end_date" >= "experiences"."start_date")
);
--> statement-breakpoint
CREATE TABLE "post_translations" (
	"post_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_translations_post_id_locale_pk" PRIMARY KEY("post_id","locale")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"cover_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canonical_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_status_check" CHECK ("posts"."status" in ('draft', 'published')),
	CONSTRAINT "posts_published_at_check" CHECK ("posts"."status" <> 'published' or "posts"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "profile_resumes" (
	"locale" "locale" PRIMARY KEY NOT NULL,
	"media_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_gallery" (
	"project_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"caption" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "project_gallery_project_id_media_id_pk" PRIMARY KEY("project_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "content_documents" DROP CONSTRAINT "content_documents_section_check";--> statement-breakpoint
ALTER TABLE "skills" DROP CONSTRAINT "skills_icon_check";--> statement-breakpoint
ALTER TABLE "socials" DROP CONSTRAINT "socials_icon_check";--> statement-breakpoint
ALTER TABLE "project_translations" ADD COLUMN "role" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_translations" ADD COLUMN "category_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_translations" ADD COLUMN "metrics" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_translations" ADD COLUMN "body" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_translations" ADD COLUMN "seo_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_translations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cover_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "site_profile" ADD COLUMN "site_url" text;--> statement-breakpoint
ALTER TABLE "site_profile" ADD COLUMN "availability" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_profile" ADD COLUMN "location_city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_profile" ADD COLUMN "location_country" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_profile" ADD COLUMN "timezone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_profile" ADD COLUMN "avatar_id" uuid;--> statement-breakpoint
ALTER TABLE "content_version_docs" ADD CONSTRAINT "content_version_docs_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_translations" ADD CONSTRAINT "experience_translations_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_logo_id_media_assets_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_translations" ADD CONSTRAINT "post_translations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_cover_id_media_assets_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_resumes" ADD CONSTRAINT "profile_resumes_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_gallery" ADD CONSTRAINT "project_gallery_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_gallery" ADD CONSTRAINT "project_gallery_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiences_position_idx" ON "experiences" USING btree ("position","id");--> statement-breakpoint
CREATE INDEX "experiences_logo_idx" ON "experiences" USING btree ("logo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slug_idx" ON "posts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "posts_published_idx" ON "posts" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_cover_idx" ON "posts" USING btree ("cover_id");--> statement-breakpoint
CREATE INDEX "project_gallery_media_idx" ON "project_gallery" USING btree ("media_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cover_id_media_assets_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_profile" ADD CONSTRAINT "site_profile_avatar_id_media_assets_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_cover_idx" ON "projects" USING btree ("cover_id");--> statement-breakpoint
ALTER TABLE "content_documents" ADD CONSTRAINT "content_documents_section_check" CHECK ("content_documents"."section" in ('ui', 'seo', 'imprint', 'privacy'));--> statement-breakpoint
ALTER TABLE "site_profile" ADD CONSTRAINT "site_profile_availability_check" CHECK ("site_profile"."availability" in ('open', 'limited', 'closed'));--> statement-breakpoint
ALTER TABLE "site_profile" ADD CONSTRAINT "site_profile_country_check" CHECK ("site_profile"."location_country" ~ '^([A-Z]{2})?$');--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_icon_check" CHECK ("skills"."icon" ~ '^[a-z0-9-]{1,40}$');--> statement-breakpoint
ALTER TABLE "socials" ADD CONSTRAINT "socials_icon_check" CHECK ("socials"."icon" ~ '^[a-z0-9-]{1,40}$');