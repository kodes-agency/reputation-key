-- Shared context Organization lifecycle receipts (LIF-01).
--
-- Every one of the 17 lifecycle-owning contexts must return an affirmative,
-- content-free receipt for each closure phase — a `no_data` answer is still
-- evidence, and an omitted contributor would make a partial purge look
-- complete. Identity keeps its dedicated table from 0168; the remaining
-- sixteen share this one, keyed by context, so the authority/lock/fingerprint
-- semantics are written and reviewed exactly once.
--
-- No foreign key to `organization`: closure evidence must outlive removal of
-- the Better Auth Organization row.
--
-- Expand-only: this migration only creates. It removes no column, table,
-- index, constraint, or compatibility mirror.
CREATE TABLE "context_organization_lifecycle_receipts" (
	"context" text NOT NULL,
	"organization_id" text NOT NULL,
	"closure_lineage_id" uuid NOT NULL,
	"lifecycle_revision" integer NOT NULL,
	"phase" text NOT NULL,
	"request_fingerprint" char(64) NOT NULL,
	"outcome" text NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"recoverable_until" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_organization_lifecycle_receipts_pk" PRIMARY KEY("context","closure_lineage_id","lifecycle_revision","phase"),
	CONSTRAINT "context_organization_lifecycle_receipts_revision_positive" CHECK ("context_organization_lifecycle_receipts"."lifecycle_revision" > 0),
	CONSTRAINT "context_organization_lifecycle_receipts_context_valid" CHECK ("context_organization_lifecycle_receipts"."context" IN ('activity', 'ai', 'badge', 'dashboard', 'goal', 'guest', 'identity', 'inbox', 'integration', 'leaderboard', 'metric', 'notification', 'portal', 'property', 'review', 'staff', 'team')),
	CONSTRAINT "context_organization_lifecycle_receipts_phase_valid" CHECK ("context_organization_lifecycle_receipts"."phase" IN ('closing', 'purge_readiness', 'purge')),
	CONSTRAINT "context_organization_lifecycle_receipts_outcome_valid" CHECK ("context_organization_lifecycle_receipts"."outcome" IN ('complete', 'no_data')),
	CONSTRAINT "context_organization_lifecycle_receipts_fingerprint_valid" CHECK ("context_organization_lifecycle_receipts"."request_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "context_organization_lifecycle_receipts_evidence_valid" CHECK ("context_organization_lifecycle_receipts"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);--> statement-breakpoint
CREATE INDEX "context_organization_lifecycle_receipts_org_time_idx" ON "context_organization_lifecycle_receipts" USING btree ("organization_id","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "context_organization_lifecycle_receipts_lineage_idx" ON "context_organization_lifecycle_receipts" USING btree ("closure_lineage_id","lifecycle_revision","phase");--> statement-breakpoint

-- Receipts are the evidence that a purge happened. Rewriting or deleting one
-- would let a failed phase be presented as complete after the fact.
CREATE FUNCTION "reject_context_lifecycle_receipt_mutation_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = TG_TABLE_NAME || ' is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "context_organization_lifecycle_receipts_update_delete_guard"
BEFORE UPDATE OR DELETE ON "context_organization_lifecycle_receipts"
FOR EACH ROW EXECUTE FUNCTION "reject_context_lifecycle_receipt_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "context_organization_lifecycle_receipts_truncate_guard"
BEFORE TRUNCATE ON "context_organization_lifecycle_receipts"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_context_lifecycle_receipt_mutation_v1"();--> statement-breakpoint
ALTER TABLE "context_organization_lifecycle_receipts" ENABLE ALWAYS TRIGGER "context_organization_lifecycle_receipts_update_delete_guard";--> statement-breakpoint
ALTER TABLE "context_organization_lifecycle_receipts" ENABLE ALWAYS TRIGGER "context_organization_lifecycle_receipts_truncate_guard";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "context_organization_lifecycle_receipts" FROM PUBLIC;
