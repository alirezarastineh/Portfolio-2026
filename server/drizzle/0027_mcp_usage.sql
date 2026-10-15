CREATE TABLE "ai_mcp_usage" (
	"day" date NOT NULL,
	"name" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_mcp_usage_day_name_pk" PRIMARY KEY("day","name")
);
