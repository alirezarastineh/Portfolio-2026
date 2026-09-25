-- Contract cleanup (Phase 9): the v1 project image columns go, and every
-- content version must belong to a publication.

-- Nothing uploaded is lost: an image the v1 columns still point at becomes the
-- cover first (as in 0007). What remains are the bundled /projects/*.svg
-- placeholders, which have no asset; such a project publishes without a
-- picture until a cover is chosen. Snapshots already published keep theirs.
UPDATE "projects" AS p
SET "cover_id" = p."image_id"
WHERE p."cover_id" IS NULL AND p."image_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "projects" AS p
SET "cover_id" = m."id"
FROM "media_assets" AS m
WHERE p."cover_id" IS NULL
	AND p."image_path" LIKE '%/media/' || m."filename"
	AND m."kind" = 'image';
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_image_id_media_assets_id_fk";
--> statement-breakpoint
DROP INDEX "projects_image_idx";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "image_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "image_path";--> statement-breakpoint
-- Every version written since 0003 has a publication. Any stray one (a restored
-- old dump) is grouped exactly as 0003 did, so the constraint cannot fail.
INSERT INTO "content_publications" ("kind", "label", "schema_version", "created_at", "created_by")
SELECT DISTINCT ON ("created_at")
	CASE WHEN "label" LIKE 'rollback to #%' THEN 'rollback' ELSE 'publish' END,
	"label",
	1,
	"created_at",
	"created_by"
FROM "content_versions"
WHERE "publication_id" IS NULL
ORDER BY "created_at", "id";
--> statement-breakpoint
UPDATE "content_versions" AS v
SET "publication_id" = p."id"
FROM "content_publications" AS p
WHERE v."publication_id" IS NULL AND p."created_at" = v."created_at";
--> statement-breakpoint
ALTER TABLE "content_versions" ALTER COLUMN "publication_id" SET NOT NULL;
