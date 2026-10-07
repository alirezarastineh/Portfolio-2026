CREATE TABLE "ai_insight_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" text NOT NULL,
	"analysed" integer NOT NULL,
	"newest_message_id" text,
	"newest_at" timestamp with time zone,
	"topics" jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "ai_insight_snapshots_trigger_check" CHECK ("ai_insight_snapshots"."trigger" in ('admin', 'auto'))
);
--> statement-breakpoint
CREATE TABLE "ai_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"statement" text NOT NULL,
	"scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"journal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topic" jsonb,
	"applied_as" text,
	"applied_ref" text,
	"applied_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"status" text DEFAULT 'proposed' NOT NULL,
	"effectiveness" jsonb,
	"retired_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "ai_lessons_source_check" CHECK ("ai_lessons"."source" in ('journal', 'insight')),
	CONSTRAINT "ai_lessons_applied_as_check" CHECK ("ai_lessons"."applied_as" in ('faq', 'content-task', 'prompt-rule', 'eval-case')),
	CONSTRAINT "ai_lessons_status_check" CHECK ("ai_lessons"."status" in ('proposed', 'active', 'retired')),
	CONSTRAINT "ai_lessons_decided_by_check" CHECK ("ai_lessons"."decided_by" in ('admin', 'system'))
);
--> statement-breakpoint
CREATE INDEX "ai_insight_snapshots_created_idx" ON "ai_insight_snapshots" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_lessons_created_idx" ON "ai_lessons" USING btree ("created_at" DESC NULLS LAST);