CREATE TABLE "ai_guard_events" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_guard_events_day_kind_pk" PRIMARY KEY("day","kind")
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "trace" jsonb;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "dropped_citations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "corpus_key" text;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "checks" jsonb;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "judge" jsonb;