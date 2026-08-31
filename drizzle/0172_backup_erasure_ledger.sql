-- Backup-erasure ledger and its hold releases (LIF-01-T15).
--
-- A restore is the only operation that can undo an irreversible erasure: the
-- backup predates the purge, so restoring it resurrects every Organization,
-- Property and privacy subject erased after the restore point. This ledger is
-- the record the recovery fence replays to stop that.
--
-- No foreign key to `organization` or `properties`: an entry exists precisely
-- because its subject is gone, and a referential dependency would delete the
-- evidence that prevents resurrection.
--
-- The ledger is append-only, so a legal hold cannot be recorded by UPDATE. A
-- hold RELEASE is therefore its own append-only fact.
--
-- Expand-only: this migration only creates. It removes no column, table,
-- index, constraint, or compatibility mirror.
CREATE TABLE "backup_erasure_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_class" varchar(32) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid,
	"subject_ref" char(64),
	"context" varchar(32) NOT NULL,
	"closure_lineage_id" uuid NOT NULL,
	"lifecycle_revision" integer NOT NULL,
	"effective_erasure_at" timestamp with time zone NOT NULL,
	"erased_row_count" integer NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"hold_reference" varchar(200),
	"data_cell_id" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_erasure_ledger_subject_class_valid" CHECK ("backup_erasure_ledger"."subject_class" IN ('organization', 'property', 'privacy_subject')),
	CONSTRAINT "backup_erasure_ledger_context_valid" CHECK ("backup_erasure_ledger"."context" IN ('activity', 'ai', 'badge', 'dashboard', 'goal', 'guest', 'identity', 'inbox', 'integration', 'leaderboard', 'metric', 'notification', 'portal', 'property', 'review', 'staff', 'team')),
	CONSTRAINT "backup_erasure_ledger_cell_valid" CHECK ("backup_erasure_ledger"."data_cell_id" IN ('us', 'europe', 'global')),
	CONSTRAINT "backup_erasure_ledger_revision_positive" CHECK ("backup_erasure_ledger"."lifecycle_revision" > 0),
	CONSTRAINT "backup_erasure_ledger_count_nonnegative" CHECK ("backup_erasure_ledger"."erased_row_count" >= 0),
	CONSTRAINT "backup_erasure_ledger_evidence_valid" CHECK ("backup_erasure_ledger"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'),
	CONSTRAINT "backup_erasure_ledger_hold_valid" CHECK ("backup_erasure_ledger"."hold_reference" IS NULL OR "backup_erasure_ledger"."hold_reference" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'),
	CONSTRAINT "backup_erasure_ledger_subject_ref_valid" CHECK ("backup_erasure_ledger"."subject_ref" IS NULL OR "backup_erasure_ledger"."subject_ref" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "backup_erasure_ledger_scope_valid" CHECK (("backup_erasure_ledger"."subject_class" = 'organization' AND "backup_erasure_ledger"."property_id" IS NULL AND "backup_erasure_ledger"."subject_ref" IS NULL)
        OR ("backup_erasure_ledger"."subject_class" = 'property' AND "backup_erasure_ledger"."property_id" IS NOT NULL AND "backup_erasure_ledger"."subject_ref" IS NULL)
        OR ("backup_erasure_ledger"."subject_class" = 'privacy_subject' AND "backup_erasure_ledger"."subject_ref" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "backup_erasure_ledger_lineage_unique" ON "backup_erasure_ledger" USING btree ("subject_class","closure_lineage_id","lifecycle_revision","context");--> statement-breakpoint
CREATE INDEX "backup_erasure_ledger_replay_idx" ON "backup_erasure_ledger" USING btree ("data_cell_id","effective_erasure_at");--> statement-breakpoint
CREATE INDEX "backup_erasure_ledger_org_idx" ON "backup_erasure_ledger" USING btree ("organization_id","effective_erasure_at");--> statement-breakpoint

CREATE TABLE "backup_erasure_hold_releases" (
	"ledger_entry_id" uuid PRIMARY KEY NOT NULL,
	"hold_reference" varchar(200) NOT NULL,
	"authority_ref" varchar(200) NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_erasure_hold_releases_refs_valid" CHECK ("backup_erasure_hold_releases"."hold_reference" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$' AND "backup_erasure_hold_releases"."authority_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);--> statement-breakpoint
ALTER TABLE "backup_erasure_hold_releases" ADD CONSTRAINT "backup_erasure_hold_releases_ledger_entry_id_backup_erasure_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."backup_erasure_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- The ledger is the control that stops a restore from resurrecting purged
-- data. A rewritable or deletable entry is an entry an operator can quietly
-- remove after a bad restore, which is exactly the failure this prevents.
CREATE FUNCTION "reject_backup_erasure_ledger_mutation_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = TG_TABLE_NAME || ' is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "backup_erasure_ledger_update_delete_guard"
BEFORE UPDATE OR DELETE ON "backup_erasure_ledger"
FOR EACH ROW EXECUTE FUNCTION "reject_backup_erasure_ledger_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "backup_erasure_ledger_truncate_guard"
BEFORE TRUNCATE ON "backup_erasure_ledger"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_backup_erasure_ledger_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "backup_erasure_hold_releases_update_delete_guard"
BEFORE UPDATE OR DELETE ON "backup_erasure_hold_releases"
FOR EACH ROW EXECUTE FUNCTION "reject_backup_erasure_ledger_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "backup_erasure_hold_releases_truncate_guard"
BEFORE TRUNCATE ON "backup_erasure_hold_releases"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_backup_erasure_ledger_mutation_v1"();--> statement-breakpoint
ALTER TABLE "backup_erasure_ledger" ENABLE ALWAYS TRIGGER "backup_erasure_ledger_update_delete_guard";--> statement-breakpoint
ALTER TABLE "backup_erasure_ledger" ENABLE ALWAYS TRIGGER "backup_erasure_ledger_truncate_guard";--> statement-breakpoint
ALTER TABLE "backup_erasure_hold_releases" ENABLE ALWAYS TRIGGER "backup_erasure_hold_releases_update_delete_guard";--> statement-breakpoint
ALTER TABLE "backup_erasure_hold_releases" ENABLE ALWAYS TRIGGER "backup_erasure_hold_releases_truncate_guard";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "backup_erasure_ledger" FROM PUBLIC;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "backup_erasure_hold_releases" FROM PUBLIC;
