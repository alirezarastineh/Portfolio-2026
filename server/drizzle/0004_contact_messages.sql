CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locale" "locale",
	"name" text NOT NULL,
	"email" "citext" NOT NULL,
	"message" text NOT NULL,
	"ip_hash" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"mail_status" text DEFAULT 'pending' NOT NULL,
	"mail_error" text,
	CONSTRAINT "contact_messages_status_check" CHECK ("contact_messages"."status" in ('new', 'read', 'archived', 'spam')),
	CONSTRAINT "contact_messages_mail_status_check" CHECK ("contact_messages"."mail_status" in ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX "contact_messages_created_idx" ON "contact_messages" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contact_messages_ip_created_idx" ON "contact_messages" USING btree ("ip_hash","created_at");