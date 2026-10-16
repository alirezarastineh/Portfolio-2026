-- A deliberate defect for a scratch PR (plan Phase 7): never merge.
ALTER TABLE "ai_mcp_usage" DROP COLUMN IF EXISTS "ci_red";
