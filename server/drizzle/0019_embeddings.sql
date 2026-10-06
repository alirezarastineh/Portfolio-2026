CREATE TABLE "ai_embeddings" (
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"dims" integer NOT NULL,
	"vector" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_embeddings_content_hash_model_pk" PRIMARY KEY("content_hash","model")
);
