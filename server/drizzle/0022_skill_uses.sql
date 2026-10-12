CREATE TABLE "ai_skill_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"skill" text NOT NULL,
	"version" text NOT NULL,
	"source" text DEFAULT 'copilot' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"words" integer NOT NULL,
	"outcome" text,
	"edit_distance" integer,
	"decided_at" timestamp with time zone,
	CONSTRAINT "ai_skill_uses_source_check" CHECK ("ai_skill_uses"."source" in ('copilot', 'agent')),
	CONSTRAINT "ai_skill_uses_outcome_check" CHECK ("ai_skill_uses"."outcome" in ('kept', 'edited', 'discarded', 'abstained')),
	CONSTRAINT "ai_skill_uses_edit_distance_check" CHECK ("ai_skill_uses"."edit_distance" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ai_skill_uses_skill_version_idx" ON "ai_skill_uses" USING btree ("skill","version");--> statement-breakpoint
CREATE INDEX "ai_skill_uses_created_idx" ON "ai_skill_uses" USING btree ("created_at" DESC NULLS LAST);