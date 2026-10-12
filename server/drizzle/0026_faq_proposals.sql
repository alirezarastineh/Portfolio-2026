CREATE TABLE "ai_faq_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"snapshot_id" uuid,
	"topic_index" smallint,
	"topic" jsonb,
	"journal_id" uuid,
	"question_en" text DEFAULT '' NOT NULL,
	"question_de" text DEFAULT '' NOT NULL,
	"answer_en" text DEFAULT '' NOT NULL,
	"answer_de" text DEFAULT '' NOT NULL,
	"uses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"faq_id" uuid,
	"lesson_id" uuid,
	CONSTRAINT "ai_faq_proposals_source_check" CHECK (("ai_faq_proposals"."source" = 'insight' and "ai_faq_proposals"."topic" is not null and "ai_faq_proposals"."topic_index" is not null and "ai_faq_proposals"."journal_id" is null)
        or ("ai_faq_proposals"."source" = 'journal' and "ai_faq_proposals"."topic" is null and "ai_faq_proposals"."topic_index" is null and "ai_faq_proposals"."snapshot_id" is null)),
	CONSTRAINT "ai_faq_proposals_status_check" CHECK ("ai_faq_proposals"."status" in ('proposed', 'needs_you', 'accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "ai_faq_proposals" ADD CONSTRAINT "ai_faq_proposals_snapshot_id_ai_insight_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."ai_insight_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_faq_proposals" ADD CONSTRAINT "ai_faq_proposals_journal_id_ai_journal_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ai_journal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_faq_proposals" ADD CONSTRAINT "ai_faq_proposals_faq_id_ai_faq_id_fk" FOREIGN KEY ("faq_id") REFERENCES "public"."ai_faq"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_faq_proposals" ADD CONSTRAINT "ai_faq_proposals_lesson_id_ai_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."ai_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_faq_proposals_created_idx" ON "ai_faq_proposals" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_faq_proposals_open_topic_idx" ON "ai_faq_proposals" USING btree ("snapshot_id","topic_index") WHERE "ai_faq_proposals"."status" in ('proposed', 'needs_you');--> statement-breakpoint
CREATE UNIQUE INDEX "ai_faq_proposals_open_entry_idx" ON "ai_faq_proposals" USING btree ("journal_id") WHERE "ai_faq_proposals"."status" in ('proposed', 'needs_you');