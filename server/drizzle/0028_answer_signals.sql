ALTER TABLE "ai_feedback" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "signals" jsonb;