CREATE TABLE "ai_run_items" (
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_run_items_run_id_key_pk" PRIMARY KEY("run_id","key"),
	CONSTRAINT "ai_run_items_status_check" CHECK ("ai_run_items"."status" in ('pending', 'running', 'done', 'failed', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb DEFAULT '{"total":0,"done":0,"failed":0,"unavailable":0}'::jsonb NOT NULL,
	"summary" jsonb,
	"usd" double precision DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	CONSTRAINT "ai_runs_kind_check" CHECK ("ai_runs"."kind" in ('eval', 'pairwise', 'judge', 'insights', 'agent')),
	CONSTRAINT "ai_runs_status_check" CHECK ("ai_runs"."status" in ('queued', 'running', 'done', 'failed', 'cancelled', 'interrupted'))
);
--> statement-breakpoint
ALTER TABLE "ai_run_items" ADD CONSTRAINT "ai_run_items_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_created_idx" ON "ai_runs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_one_active_per_kind" ON "ai_runs" USING btree ("kind") WHERE "ai_runs"."status" in ('queued', 'running');