CREATE TABLE "ai_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text NOT NULL,
	"diagnosis" jsonb NOT NULL,
	"root_cause" text DEFAULT '' NOT NULL,
	"fix_type" text,
	"fix" text DEFAULT '' NOT NULL,
	"fix_ref" text,
	"heuristic" text DEFAULT '' NOT NULL,
	"case_id" uuid,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"replay" jsonb,
	CONSTRAINT "ai_journal_status_check" CHECK ("ai_journal"."status" in ('proposed', 'accepted', 'fixed', 'retired')),
	CONSTRAINT "ai_journal_fix_type_check" CHECK ("ai_journal"."fix_type" in ('content', 'faq', 'prompt', 'routing', 'retrieval', 'model', 'infra')),
	CONSTRAINT "ai_journal_decided_by_check" CHECK ("ai_journal"."decided_by" in ('admin', 'system'))
);
--> statement-breakpoint
ALTER TABLE "ai_journal" ADD CONSTRAINT "ai_journal_case_id_ai_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."ai_eval_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_journal_created_idx" ON "ai_journal" USING btree ("created_at" DESC NULLS LAST);