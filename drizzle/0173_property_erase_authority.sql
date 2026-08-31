-- Support-mediated permanent Property Erase authority (LIF-01-T19).
--
-- `properties.lifecycle_state` has declared purge_pending/purging/purged since
-- BETA-1 B1.5 but nothing drove them. This is the authority that does.
--
-- POSTURE: `property.erase` stays DISABLED in capability-fate.ts and stays in
-- BLOCKED_CAPABILITIES. There is no tenant-facing authorization path. An
-- AccountAdmin may REQUEST; only an operator command carrying an INDEPENDENT
-- support authorization reference may authorize.
--
-- The irreversible boundary is purge_pending -> purging. It is guarded here as
-- well as in the domain transition table, because a single guard on an
-- irreversible operation is a single point of failure.
--
-- Expand-only: this migration only creates. It removes no column, table,
-- index, constraint, or compatibility mirror.
CREATE TABLE "property_erase_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"state" varchar(24) NOT NULL,
	"requested_by_user_id" varchar(255) NOT NULL,
	"identity_verification_ref" varchar(200) NOT NULL,
	"support_operator_id" varchar(255) NOT NULL,
	"support_authorization_ref" varchar(200) NOT NULL,
	"retention_preview_ref" varchar(200),
	"export_evidence_ref" varchar(200),
	"inventory_revision" integer DEFAULT 0 NOT NULL,
	"inventory_digest" char(64),
	"confirmation_digest" char(64),
	"grace_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"purge_started_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason_code" varchar(64),
	"evidence_ref" varchar(200) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"state_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_erase_authorities_state_valid" CHECK ("property_erase_authorities"."state" IN ('requested', 'previewed', 'confirmed', 'purge_pending', 'purging', 'purged', 'cancelled')),
	CONSTRAINT "property_erase_authorities_refs_valid" CHECK ("property_erase_authorities"."identity_verification_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND "property_erase_authorities"."support_authorization_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND "property_erase_authorities"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND ("property_erase_authorities"."retention_preview_ref" IS NULL OR "property_erase_authorities"."retention_preview_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND ("property_erase_authorities"."export_evidence_ref" IS NULL OR "property_erase_authorities"."export_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND ("property_erase_authorities"."cancel_reason_code" IS NULL OR "property_erase_authorities"."cancel_reason_code" ~ '^[a-z][a-z0-9_]{0,63}$')),
	CONSTRAINT "property_erase_authorities_digests_valid" CHECK (("property_erase_authorities"."inventory_digest" IS NULL OR "property_erase_authorities"."inventory_digest" ~ '^[a-f0-9]{64}$')
        AND ("property_erase_authorities"."confirmation_digest" IS NULL OR "property_erase_authorities"."confirmation_digest" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "property_erase_authorities_revision_valid" CHECK ("property_erase_authorities"."inventory_revision" >= 0),
	CONSTRAINT "property_erase_authorities_confirmation_complete" CHECK ("property_erase_authorities"."state" IN ('requested', 'previewed', 'cancelled')
        OR ("property_erase_authorities"."confirmation_digest" IS NOT NULL AND "property_erase_authorities"."inventory_digest" IS NOT NULL
          AND "property_erase_authorities"."retention_preview_ref" IS NOT NULL AND "property_erase_authorities"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "property_erase_authorities_terminal_valid" CHECK (("property_erase_authorities"."state" = 'purged') = ("property_erase_authorities"."purged_at" IS NOT NULL)
        AND ("property_erase_authorities"."state" = 'cancelled') = ("property_erase_authorities"."cancelled_at" IS NOT NULL)
        AND ("property_erase_authorities"."state" NOT IN ('purging', 'purged') OR "property_erase_authorities"."purge_started_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "property_erase_authorities_live_unique" ON "property_erase_authorities" USING btree ("property_id") WHERE state NOT IN ('purged', 'cancelled');--> statement-breakpoint
CREATE INDEX "property_erase_authorities_state_idx" ON "property_erase_authorities" USING btree ("state","state_changed_at");--> statement-breakpoint
CREATE INDEX "property_erase_authorities_org_idx" ON "property_erase_authorities" USING btree ("organization_id","property_id");--> statement-breakpoint

CREATE TABLE "property_erase_context_receipts" (
	"authority_id" uuid NOT NULL,
	"context" varchar(32) NOT NULL,
	"phase" varchar(24) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"erased_row_count" integer NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_erase_context_receipts_pk" PRIMARY KEY("authority_id","context","phase"),
	CONSTRAINT "property_erase_context_receipts_phase_valid" CHECK ("property_erase_context_receipts"."phase" IN ('inventory', 'purge')),
	CONSTRAINT "property_erase_context_receipts_outcome_valid" CHECK ("property_erase_context_receipts"."outcome" IN ('complete', 'no_data')),
	CONSTRAINT "property_erase_context_receipts_count_valid" CHECK ("property_erase_context_receipts"."erased_row_count" >= 0),
	CONSTRAINT "property_erase_context_receipts_evidence_valid" CHECK ("property_erase_context_receipts"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);--> statement-breakpoint
ALTER TABLE "property_erase_context_receipts" ADD CONSTRAINT "property_erase_context_receipts_authority_id_property_erase_authorities_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."property_erase_authorities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_erase_context_receipts_authority_idx" ON "property_erase_context_receipts" USING btree ("authority_id","phase");--> statement-breakpoint

-- The irreversible boundary, enforced independently of the application.
--
-- Once `purging` has begun there is no cancel and no rollback: the Property's
-- rows are already going. The trigger also pins the authorization binding, so
-- an erase cannot be quietly retargeted at a different Property or re-attributed
-- to a different support authorization after it was reviewed.
CREATE FUNCTION "reject_property_erase_authority_mutation_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = TG_TABLE_NAME || ' evidence cannot be truncated';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = TG_TABLE_NAME || ' evidence cannot be deleted';
  END IF;

  IF TG_TABLE_NAME = 'property_erase_context_receipts' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'property_erase_context_receipts is append-only';
  END IF;

  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.requested_by_user_id <> OLD.requested_by_user_id
     OR NEW.support_authorization_ref <> OLD.support_authorization_ref
     OR NEW.identity_verification_ref <> OLD.identity_verification_ref
     OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'property erase authorization binding is immutable';
  END IF;

  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  -- Cancellation is impossible once the purge has started. This is the whole
  -- point of the boundary.
  IF OLD.state IN ('purging', 'purged') AND NEW.state = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'property erase is irreversible once purging has begun';
  END IF;

  allowed := CASE OLD.state
    WHEN 'requested' THEN NEW.state IN ('previewed', 'cancelled')
    WHEN 'previewed' THEN NEW.state IN ('previewed', 'confirmed', 'cancelled')
    WHEN 'confirmed' THEN NEW.state IN ('purge_pending', 'cancelled')
    WHEN 'purge_pending' THEN NEW.state IN ('purging', 'cancelled')
    WHEN 'purging' THEN NEW.state = 'purged'
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'invalid property erase transition ' || OLD.state || ' -> ' || NEW.state;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "property_erase_authorities_transition_guard"
BEFORE UPDATE OR DELETE ON "property_erase_authorities"
FOR EACH ROW EXECUTE FUNCTION "reject_property_erase_authority_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "property_erase_authorities_truncate_guard"
BEFORE TRUNCATE ON "property_erase_authorities"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_property_erase_authority_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "property_erase_context_receipts_mutation_guard"
BEFORE UPDATE OR DELETE ON "property_erase_context_receipts"
FOR EACH ROW EXECUTE FUNCTION "reject_property_erase_authority_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "property_erase_context_receipts_truncate_guard"
BEFORE TRUNCATE ON "property_erase_context_receipts"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_property_erase_authority_mutation_v1"();--> statement-breakpoint
ALTER TABLE "property_erase_authorities" ENABLE ALWAYS TRIGGER "property_erase_authorities_transition_guard";--> statement-breakpoint
ALTER TABLE "property_erase_authorities" ENABLE ALWAYS TRIGGER "property_erase_authorities_truncate_guard";--> statement-breakpoint
ALTER TABLE "property_erase_context_receipts" ENABLE ALWAYS TRIGGER "property_erase_context_receipts_mutation_guard";--> statement-breakpoint
ALTER TABLE "property_erase_context_receipts" ENABLE ALWAYS TRIGGER "property_erase_context_receipts_truncate_guard";--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "property_erase_authorities" FROM PUBLIC;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "property_erase_context_receipts" FROM PUBLIC;
