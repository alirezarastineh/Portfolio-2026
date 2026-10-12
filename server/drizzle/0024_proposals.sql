CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"goal" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"locale" "locale" NOT NULL,
	"label" text NOT NULL,
	"before" text DEFAULT '' NOT NULL,
	"after" text,
	"skill" text NOT NULL,
	"version" text NOT NULL,
	"use_id" uuid,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	CONSTRAINT "ai_proposals_goal_check" CHECK ("ai_proposals"."goal" in ('translations', 'alt', 'seo')),
	CONSTRAINT "ai_proposals_kind_check" CHECK ("ai_proposals"."kind" in ('section', 'project', 'experience', 'skill', 'post', 'media')),
	CONSTRAINT "ai_proposals_status_check" CHECK ("ai_proposals"."status" in ('proposed', 'needs_you', 'accepted', 'rejected', 'applied', 'reverted', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_use_id_ai_skill_uses_id_fk" FOREIGN KEY ("use_id") REFERENCES "public"."ai_skill_uses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_proposals_run_target_idx" ON "ai_proposals" USING btree ("run_id","goal","kind","entity_id","field","locale");--> statement-breakpoint
CREATE INDEX "ai_proposals_status_idx" ON "ai_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_proposals_created_idx" ON "ai_proposals" USING btree ("created_at" DESC NULLS LAST);