-- Content model v2 backfill. Idempotent: every statement only fills what is
-- still empty, so a re-run changes nothing.

-- The project image becomes the cover. Uploaded images are matched by asset id
-- first, then by the /media/<filename> path the v1 editor stored. Legacy
-- /projects/*.svg placeholders have no asset; they keep publishing from
-- image_path until a real cover is chosen.
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
-- The site's origin, from the canonical URL the English SEO document declares.
UPDATE "site_profile" AS s
SET "site_url" = substring(d."data"->>'canonical' from '^(https?://[^/]+)')
FROM "content_documents" AS d
WHERE s."site_url" IS NULL
	AND d."section" = 'seo'
	AND d."locale" = 'en'
	AND d."data"->>'canonical' ~ '^https?://';
