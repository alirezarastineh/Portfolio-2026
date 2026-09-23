CREATE TABLE "content_publications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'publish' NOT NULL,
	"label" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"restored_from" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "content_publications_kind_check" CHECK ("content_publications"."kind" in ('publish', 'rollback'))
);
--> statement-breakpoint
CREATE TABLE "version_media_refs" (
	"version_id" bigint NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "version_media_refs_version_id_asset_id_pk" PRIMARY KEY("version_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "content_versions" ADD COLUMN "publication_id" bigint;--> statement-breakpoint
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_media_refs" ADD CONSTRAINT "version_media_refs_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_media_refs" ADD CONSTRAINT "version_media_refs_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_publications_created_idx" ON "content_publications" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "version_media_refs_asset_idx" ON "version_media_refs" USING btree ("asset_id");--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_publication_id_content_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."content_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_versions_publication_idx" ON "content_versions" USING btree ("publication_id");