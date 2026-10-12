ALTER TABLE "ai_skill_uses" ADD COLUMN "repairs" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_skill_uses" ADD COLUMN "flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_skill_uses" ADD COLUMN "candidates" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_skill_uses" ADD COLUMN "pick" smallint;--> statement-breakpoint
ALTER TABLE "ai_skill_uses" ADD COLUMN "critic" text;--> statement-breakpoint
ALTER TABLE "ai_skill_uses" ADD CONSTRAINT "ai_skill_uses_repairs_check" CHECK ("ai_skill_uses"."repairs" >= 0);--> statement-breakpoint
ALTER TABLE "ai_skill_uses" ADD CONSTRAINT "ai_skill_uses_candidates_check" CHECK ("ai_skill_uses"."candidates" >= 1);--> statement-breakpoint
ALTER TABLE "ai_skill_uses" ADD CONSTRAINT "ai_skill_uses_pick_check" CHECK ("ai_skill_uses"."pick" >= 0 and "ai_skill_uses"."pick" < "ai_skill_uses"."candidates");--> statement-breakpoint
ALTER TABLE "ai_skill_uses" ADD CONSTRAINT "ai_skill_uses_critic_check" CHECK ("ai_skill_uses"."critic" in ('ok', 'revised', 'refused'));