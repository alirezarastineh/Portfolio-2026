ALTER TABLE "ai_messages" ADD COLUMN "handoff_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "primary_metric" text DEFAULT 'helpfulRate' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN "origin" text DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN "ask_message_id" text;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD COLUMN "ask_transcript" jsonb;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_ask_message_id_ai_messages_id_fk" FOREIGN KEY ("ask_message_id") REFERENCES "public"."ai_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_origin_check" CHECK ("contact_messages"."origin" in ('form', 'ask'));