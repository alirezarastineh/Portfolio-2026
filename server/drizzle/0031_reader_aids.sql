ALTER TABLE "project_translations" ADD COLUMN "summary_plain" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_translations" ADD COLUMN "summary_expert" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_translations" ADD COLUMN "glossary" jsonb DEFAULT '[]'::jsonb NOT NULL;