CREATE TABLE "identity_organization_lifecycle_receipts" (
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
	CONSTRAINT "identity_organization_lifecycle_receipts_pk" PRIMARY KEY("closure_lineage_id","lifecycle_revision","phase"),
	CONSTRAINT "identity_organization_lifecycle_receipts_revision_positive" CHECK ("identity_organization_lifecycle_receipts"."lifecycle_revision" > 0),
	CONSTRAINT "identity_organization_lifecycle_receipts_phase_valid" CHECK ("identity_organization_lifecycle_receipts"."phase" IN ('closing', 'purge_readiness', 'purge')),
	CONSTRAINT "identity_organization_lifecycle_receipts_outcome_valid" CHECK ("identity_organization_lifecycle_receipts"."outcome" IN ('complete', 'no_data')),
	CONSTRAINT "identity_organization_lifecycle_receipts_fingerprint_valid" CHECK ("identity_organization_lifecycle_receipts"."request_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "identity_organization_lifecycle_receipts_evidence_valid" CHECK ("identity_organization_lifecycle_receipts"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);--> statement-breakpoint
CREATE INDEX "identity_organization_lifecycle_receipts_org_time_idx" ON "identity_organization_lifecycle_receipts" USING btree ("organization_id","occurred_at" DESC);--> statement-breakpoint

-- Retrieval token digests are erased from the mutable export head after
-- consumption, but every issued authority must remain globally dead for that
-- request. The append-only history prevents A -> B -> A resurrection and
-- gives the export guard a transaction-bound issuance witness.
CREATE TABLE "organization_export_retrieval_issuances" (
	"export_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"export_revision" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"token_digest" char(64) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_export_retrieval_issuances_pk" PRIMARY KEY("export_id","export_revision"),
	CONSTRAINT "organization_export_retrieval_issuances_revision_positive" CHECK ("organization_export_retrieval_issuances"."export_revision" > 0),
	CONSTRAINT "organization_export_retrieval_issuances_digest_valid" CHECK ("organization_export_retrieval_issuances"."token_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "organization_export_retrieval_issuances_expiry_valid" CHECK ("organization_export_retrieval_issuances"."expires_at" > "organization_export_retrieval_issuances"."issued_at" AND "organization_export_retrieval_issuances"."expires_at" <= "organization_export_retrieval_issuances"."issued_at" + interval '24 hours')
);--> statement-breakpoint
ALTER TABLE "organization_export_retrieval_issuances" ADD CONSTRAINT "organization_export_retrieval_issuances_export_fk" FOREIGN KEY ("export_id") REFERENCES "public"."organization_exports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_export_retrieval_issuances_operation_idx" ON "organization_export_retrieval_issuances" USING btree ("export_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_export_retrieval_issuances_digest_idx" ON "organization_export_retrieval_issuances" USING btree ("export_id","token_digest");--> statement-breakpoint
CREATE INDEX "organization_export_retrieval_issuances_org_time_idx" ON "organization_export_retrieval_issuances" USING btree ("organization_id","issued_at" DESC);--> statement-breakpoint

-- Preserve the one currently live authority when upgrading an installation
-- that already issued a retrieval token under migration 0159.
INSERT INTO "organization_export_retrieval_issuances" (
  "export_id", "organization_id", "export_revision", "operation_id",
  "token_digest", "issued_at", "expires_at", "created_at"
)
SELECT
  "id", "organization_id", "revision", "retrieval_operation_id",
  "retrieval_token_digest", "retrieval_issued_at", "retrieval_expires_at",
  "retrieval_issued_at"
FROM "organization_exports"
WHERE "state" = 'retrieval_issued'
ON CONFLICT DO NOTHING;--> statement-breakpoint

CREATE FUNCTION "reject_identity_lifecycle_evidence_mutation_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = TG_TABLE_NAME || ' is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "identity_organization_lifecycle_receipts_update_delete_guard"
BEFORE UPDATE OR DELETE ON "identity_organization_lifecycle_receipts"
FOR EACH ROW EXECUTE FUNCTION "reject_identity_lifecycle_evidence_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "identity_organization_lifecycle_receipts_truncate_guard"
BEFORE TRUNCATE ON "identity_organization_lifecycle_receipts"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_identity_lifecycle_evidence_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "organization_export_retrieval_issuances_update_delete_guard"
BEFORE UPDATE OR DELETE ON "organization_export_retrieval_issuances"
FOR EACH ROW EXECUTE FUNCTION "reject_identity_lifecycle_evidence_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "organization_export_retrieval_issuances_truncate_guard"
BEFORE TRUNCATE ON "organization_export_retrieval_issuances"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_identity_lifecycle_evidence_mutation_v1"();--> statement-breakpoint
ALTER TABLE "identity_organization_lifecycle_receipts" ENABLE ALWAYS TRIGGER "identity_organization_lifecycle_receipts_update_delete_guard";--> statement-breakpoint
ALTER TABLE "identity_organization_lifecycle_receipts" ENABLE ALWAYS TRIGGER "identity_organization_lifecycle_receipts_truncate_guard";--> statement-breakpoint
ALTER TABLE "organization_export_retrieval_issuances" ENABLE ALWAYS TRIGGER "organization_export_retrieval_issuances_update_delete_guard";--> statement-breakpoint
ALTER TABLE "organization_export_retrieval_issuances" ENABLE ALWAYS TRIGGER "organization_export_retrieval_issuances_truncate_guard";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "identity_organization_lifecycle_receipts" FROM PUBLIC;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "organization_export_retrieval_issuances" FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION "guard_organization_export_retrieval_issuance_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  authority public.organization_exports%ROWTYPE;
BEGIN
  SELECT * INTO authority
  FROM public.organization_exports
  WHERE id = NEW.export_id
  FOR UPDATE;

  IF NOT FOUND
     OR NEW.organization_id IS DISTINCT FROM authority.organization_id
     OR NEW.export_revision IS DISTINCT FROM authority.revision + 1 THEN
    RAISE EXCEPTION 'organization export retrieval issuance authority changed';
  END IF;

  IF NOT (
    authority.state = 'ready'
    OR (
      authority.state = 'retrieval_issued'
      AND authority.retrieval_expires_at <= NEW.issued_at
    )
  ) THEN
    RAISE EXCEPTION 'organization export retrieval issuance state is unavailable';
  END IF;

  IF NEW.expires_at > authority.object_expires_at THEN
    RAISE EXCEPTION 'organization export retrieval issuance exceeds object expiry';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "organization_export_retrieval_issuance_insert_guard"
BEFORE INSERT ON "organization_export_retrieval_issuances"
FOR EACH ROW EXECUTE FUNCTION "guard_organization_export_retrieval_issuance_v1"();--> statement-breakpoint

CREATE FUNCTION "verify_organization_export_retrieval_issuance_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_exports AS authority
    WHERE authority.id = NEW.export_id
      AND authority.organization_id = NEW.organization_id
      AND authority.state = 'retrieval_issued'
      AND authority.revision = NEW.export_revision
      AND authority.retrieval_operation_id = NEW.operation_id
      AND authority.retrieval_token_digest = NEW.token_digest
      AND authority.retrieval_issued_at = NEW.issued_at
      AND authority.retrieval_expires_at = NEW.expires_at
  ) THEN
    RAISE EXCEPTION 'organization export retrieval issuance was not co-committed';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "organization_export_retrieval_issuance_commit_guard"
AFTER INSERT ON "organization_export_retrieval_issuances"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "verify_organization_export_retrieval_issuance_v1"();--> statement-breakpoint

-- A retrieval token expires after 24 hours while its encrypted object may
-- remain valid for seven days. Permit a current AccountAdmin to rotate the
-- expired digest/operation pair without weakening any other state edge.
CREATE OR REPLACE FUNCTION "guard_organization_export_revision_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
     OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
     OR NEW."format_version" IS DISTINCT FROM OLD."format_version"
     OR NEW."as_of" IS DISTINCT FROM OLD."as_of"
     OR NEW."object_expires_at" IS DISTINCT FROM OLD."object_expires_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'organization export immutable request binding changed';
  END IF;

  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'organization export revision must advance by exactly one';
  END IF;

  IF NOT (
    (OLD."state" = 'requested' AND NEW."state" IN ('generating', 'failed'))
    OR (OLD."state" = 'generating' AND NEW."state" IN ('generating', 'ready', 'failed'))
    OR (OLD."state" = 'ready' AND NEW."state" IN ('retrieval_issued', 'delete_pending'))
    OR (
      OLD."state" = 'retrieval_issued'
      AND NEW."state" = 'retrieval_issued'
      AND OLD."retrieval_expires_at" <= NEW."retrieval_issued_at"
      AND NEW."retrieval_operation_id" IS DISTINCT FROM OLD."retrieval_operation_id"
      AND NEW."retrieval_token_digest" IS DISTINCT FROM OLD."retrieval_token_digest"
    )
    OR (OLD."state" = 'retrieval_issued' AND NEW."state" IN ('retrieved', 'delete_pending'))
    OR (OLD."state" = 'retrieved' AND NEW."state" = 'delete_pending')
    OR (OLD."state" = 'delete_pending' AND NEW."state" = 'deleted')
  ) THEN
    RAISE EXCEPTION 'invalid organization export state transition: % -> %', OLD."state", NEW."state";
  END IF;

  IF NEW."state" = 'retrieval_issued' AND NOT EXISTS (
    SELECT 1
    FROM "organization_export_retrieval_issuances" AS issuance
    WHERE issuance."export_id" = NEW."id"
      AND issuance."organization_id" = NEW."organization_id"
      AND issuance."export_revision" = NEW."revision"
      AND issuance."operation_id" = NEW."retrieval_operation_id"
      AND issuance."token_digest" = NEW."retrieval_token_digest"
      AND issuance."issued_at" = NEW."retrieval_issued_at"
      AND issuance."expires_at" = NEW."retrieval_expires_at"
  ) THEN
    RAISE EXCEPTION 'organization export retrieval issuance evidence is missing';
  END IF;

  IF (OLD."object_key" IS NOT NULL AND NEW."object_key" IS DISTINCT FROM OLD."object_key")
     OR (OLD."coverage_sha256" IS NOT NULL AND NEW."coverage_sha256" IS DISTINCT FROM OLD."coverage_sha256")
     OR (OLD."manifest_sha256" IS NOT NULL AND NEW."manifest_sha256" IS DISTINCT FROM OLD."manifest_sha256")
     OR (OLD."archive_sha256" IS NOT NULL AND NEW."archive_sha256" IS DISTINCT FROM OLD."archive_sha256")
     OR (OLD."encryption_evidence_ref" IS NOT NULL AND NEW."encryption_evidence_ref" IS DISTINCT FROM OLD."encryption_evidence_ref") THEN
    RAISE EXCEPTION 'organization export immutable archive evidence changed';
  END IF;
  RETURN NEW;
END;
$$;
