CREATE TABLE "ai_usage_features" (
	"day" date NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"thought_tokens" bigint DEFAULT 0 NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_features_day_feature_model_pk" PRIMARY KEY("day","feature","model")
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "public_reserve" double precision DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "feature_caps" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "feature_switches" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_public_reserve_check" CHECK ("ai_settings"."public_reserve" >= 0 and "ai_settings"."public_reserve" <= 0.9);