CREATE TABLE "ai_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alert" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "ai_audit_actor_check" CHECK ("ai_audit"."actor" in ('admin', 'agent', 'system')),
	CONSTRAINT "ai_audit_decision_check" CHECK ("ai_audit"."decision" in ('allowed', 'denied', 'asked'))
);
--> statement-breakpoint
CREATE INDEX "ai_audit_at_idx" ON "ai_audit" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_audit_state_idx" ON "ai_audit" USING btree ("target","at" DESC NULLS LAST) WHERE "ai_audit"."action" in ('demote', 'reinstate');--> statement-breakpoint
CREATE INDEX "ai_audit_open_alerts_idx" ON "ai_audit" USING btree ("at" DESC NULLS LAST) WHERE "ai_audit"."alert" and "ai_audit"."seen_at" is null;