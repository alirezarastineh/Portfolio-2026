CREATE TABLE "ai_corpus_snapshots" (
	"key" text PRIMARY KEY NOT NULL,
	"documents" jsonb NOT NULL,
	"projects" jsonb NOT NULL,
	"posts" jsonb NOT NULL,
	"core_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_eval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite" text DEFAULT 'production' NOT NULL,
	"question" text NOT NULL,
	"locale" "locale" NOT NULL,
	"snapshot_key" text NOT NULL,
	"must_cite" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cite_any" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"must_include" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"must_not_include" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expect_tool" jsonb,
	"judge" boolean DEFAULT true NOT NULL,
	"from_message_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_eval_cases_status_check" CHECK ("ai_eval_cases"."status" in ('active', 'retired')),
	CONSTRAINT "ai_eval_cases_suite_check" CHECK ("ai_eval_cases"."suite" in ('production'))
);
--> statement-breakpoint
ALTER TABLE "ai_eval_cases" ADD CONSTRAINT "ai_eval_cases_snapshot_key_ai_corpus_snapshots_key_fk" FOREIGN KEY ("snapshot_key") REFERENCES "public"."ai_corpus_snapshots"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_cases" ADD CONSTRAINT "ai_eval_cases_from_message_id_ai_messages_id_fk" FOREIGN KEY ("from_message_id") REFERENCES "public"."ai_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_eval_cases_suite_status_idx" ON "ai_eval_cases" USING btree ("suite","status");