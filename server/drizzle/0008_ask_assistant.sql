CREATE TABLE "ai_faq" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_faq_translations" (
	"faq_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_faq_translations_faq_id_locale_pk" PRIMARY KEY("faq_id","locale")
);
--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"message_id" text PRIMARY KEY NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_feedback_value_check" CHECK ("ai_feedback"."value" in (-1, 1))
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_hash" text NOT NULL,
	"locale" "locale" NOT NULL,
	"source" text DEFAULT 'terminal' NOT NULL,
	"route" text NOT NULL,
	"question_redacted" text NOT NULL,
	"answer_excerpt" text DEFAULT '' NOT NULL,
	"cited_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ttft_ms" integer,
	"total_ms" integer NOT NULL,
	"tokens" jsonb NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	"finish_reason" text NOT NULL,
	"prompt_version" text NOT NULL,
	CONSTRAINT "ai_messages_source_check" CHECK ("ai_messages"."source" in ('terminal', 'playground', 'eval'))
);
--> statement-breakpoint
CREATE TABLE "ai_rate_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"daily_budget_usd" double precision,
	"deep_enabled" boolean DEFAULT true NOT NULL,
	"suggested_questions" jsonb DEFAULT '{"en":[],"de":[]}'::jsonb NOT NULL,
	"system_card" jsonb DEFAULT '{"en":"","de":""}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_singleton_check" CHECK ("ai_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"day" date NOT NULL,
	"model" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"thought_tokens" bigint DEFAULT 0 NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_day_model_pk" PRIMARY KEY("day","model")
);
--> statement-breakpoint
ALTER TABLE "ai_faq_translations" ADD CONSTRAINT "ai_faq_translations_faq_id_ai_faq_id_fk" FOREIGN KEY ("faq_id") REFERENCES "public"."ai_faq"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_faq_position_idx" ON "ai_faq" USING btree ("position","id");--> statement-breakpoint
CREATE INDEX "ai_messages_created_idx" ON "ai_messages" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_messages_session_idx" ON "ai_messages" USING btree ("session_hash","created_at");--> statement-breakpoint
CREATE INDEX "ai_rate_events_bucket_time_idx" ON "ai_rate_events" USING btree ("bucket","occurred_at" DESC NULLS LAST);