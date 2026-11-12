-- migrate:contract 6cd50e868b63ffad5aa006c60b949fbab51fd850
-- Widens the ledger's context list with the platform's work items. No reader
-- depends on the narrower list, so the running release already accepts it.
ALTER TABLE "backup_erasure_ledger" DROP CONSTRAINT "backup_erasure_ledger_context_valid";
--> statement-breakpoint
ALTER TABLE "backup_erasure_ledger" ADD CONSTRAINT "backup_erasure_ledger_context_valid" CHECK ("backup_erasure_ledger"."context" IN ('activity', 'ai', 'dashboard', 'goal', 'guest', 'identity', 'inbox', 'integration', 'metric', 'notification', 'portal', 'property', 'review', 'staff', 'platform')) NOT VALID;
