-- Groups the versions written before publications existed into publications.
-- Every locale of one publish was inserted in one transaction, and now() is
-- fixed per transaction, so equal created_at means "the same publish". The old
-- single-locale rollbacks each become a publication of their own.
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
-- Which uploaded images each existing version shows. Project images are the
-- only media a v1 payload references (stored as an absolute or relative URL
-- ending in /media/<filename>).
INSERT INTO "version_media_refs" ("version_id", "asset_id")
SELECT DISTINCT v."id", m."id"
FROM "content_versions" AS v
CROSS JOIN LATERAL jsonb_array_elements(coalesce(v."payload"->'projects', '[]'::jsonb)) AS p(project)
JOIN "media_assets" AS m ON (p.project->>'image') LIKE '%/media/' || m."filename"
ON CONFLICT DO NOTHING;
