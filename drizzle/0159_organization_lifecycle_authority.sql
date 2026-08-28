-- LIF-01: Identity-owned Organization lifecycle control plane.
-- Better Auth remains the Organization entity authority. This lifecycle row
-- is independent so closure fences/evidence survive later cleanup work.
CREATE TABLE "organization_lifecycle_authority" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"closure_lineage_id" uuid,
	"closure_requested_at" timestamp with time zone,
	"recoverable_until" timestamp with time zone,
	"irreversible_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reactivation_required" boolean DEFAULT false NOT NULL,
	"requested_by" varchar(255),
	"request_reason_code" varchar(64),
	"request_support_evidence_ref" varchar(200),
	"last_transition_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_actor_id" varchar(255) NOT NULL,
	"last_reason_code" varchar(64) NOT NULL,
	"last_support_evidence_ref" varchar(200) NOT NULL,
	CONSTRAINT "organization_lifecycle_state_valid" CHECK ("organization_lifecycle_authority"."state" IN ('active', 'closure_requested', 'closing', 'purge_pending', 'purging', 'closed')),
	CONSTRAINT "organization_lifecycle_revision_nonnegative" CHECK ("organization_lifecycle_authority"."revision" >= 0),
	CONSTRAINT "organization_lifecycle_request_reason_valid" CHECK ("organization_lifecycle_authority"."request_reason_code" IS NULL OR "organization_lifecycle_authority"."request_reason_code" IN ('account_admin_request', 'contract_ended', 'duplicate_workspace', 'privacy_request', 'test_workspace')),
	CONSTRAINT "organization_lifecycle_evidence_ref_valid" CHECK ("organization_lifecycle_authority"."last_support_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$' AND ("organization_lifecycle_authority"."request_support_evidence_ref" IS NULL OR "organization_lifecycle_authority"."request_support_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')),
	CONSTRAINT "organization_lifecycle_reason_code_valid" CHECK ("organization_lifecycle_authority"."last_reason_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "organization_lifecycle_state_shape" CHECK ((
		"organization_lifecycle_authority"."state" = 'active'
		AND "organization_lifecycle_authority"."irreversible_at" IS NULL
		AND "organization_lifecycle_authority"."closed_at" IS NULL
		AND (
			("organization_lifecycle_authority"."closure_lineage_id" IS NULL AND "organization_lifecycle_authority"."closure_requested_at" IS NULL AND "organization_lifecycle_authority"."recoverable_until" IS NULL AND "organization_lifecycle_authority"."requested_by" IS NULL AND "organization_lifecycle_authority"."request_reason_code" IS NULL AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NULL AND "organization_lifecycle_authority"."reactivation_required" = false)
			OR
			("organization_lifecycle_authority"."closure_lineage_id" IS NOT NULL AND "organization_lifecycle_authority"."closure_requested_at" IS NOT NULL AND "organization_lifecycle_authority"."recoverable_until" > "organization_lifecycle_authority"."closure_requested_at" AND "organization_lifecycle_authority"."requested_by" IS NOT NULL AND "organization_lifecycle_authority"."request_reason_code" IS NOT NULL AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL AND "organization_lifecycle_authority"."reactivation_required" = true)
		)
	) OR (
		"organization_lifecycle_authority"."state" IN ('closure_requested', 'closing', 'purge_pending')
		AND "organization_lifecycle_authority"."closure_lineage_id" IS NOT NULL
		AND "organization_lifecycle_authority"."closure_requested_at" IS NOT NULL
		AND "organization_lifecycle_authority"."recoverable_until" > "organization_lifecycle_authority"."closure_requested_at"
		AND "organization_lifecycle_authority"."requested_by" IS NOT NULL
		AND "organization_lifecycle_authority"."request_reason_code" IS NOT NULL
		AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL
		AND "organization_lifecycle_authority"."irreversible_at" IS NULL
		AND "organization_lifecycle_authority"."closed_at" IS NULL
		AND "organization_lifecycle_authority"."reactivation_required" = true
	) OR (
		"organization_lifecycle_authority"."state" = 'purging'
		AND "organization_lifecycle_authority"."closure_lineage_id" IS NOT NULL
		AND "organization_lifecycle_authority"."closure_requested_at" IS NOT NULL
		AND "organization_lifecycle_authority"."recoverable_until" > "organization_lifecycle_authority"."closure_requested_at"
		AND "organization_lifecycle_authority"."requested_by" IS NOT NULL
		AND "organization_lifecycle_authority"."request_reason_code" IS NOT NULL
		AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL
		AND "organization_lifecycle_authority"."irreversible_at" IS NOT NULL
		AND "organization_lifecycle_authority"."closed_at" IS NULL
		AND "organization_lifecycle_authority"."reactivation_required" = true
	) OR (
		"organization_lifecycle_authority"."state" = 'closed'
		AND "organization_lifecycle_authority"."closure_lineage_id" IS NOT NULL
		AND "organization_lifecycle_authority"."closure_requested_at" IS NOT NULL
		AND "organization_lifecycle_authority"."recoverable_until" > "organization_lifecycle_authority"."closure_requested_at"
		AND "organization_lifecycle_authority"."requested_by" IS NOT NULL
		AND "organization_lifecycle_authority"."request_reason_code" IS NOT NULL
		AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL
		AND "organization_lifecycle_authority"."irreversible_at" IS NOT NULL
		AND "organization_lifecycle_authority"."closed_at" IS NOT NULL
		AND "organization_lifecycle_authority"."reactivation_required" = true
	))
);--> statement-breakpoint
CREATE INDEX "organization_lifecycle_state_deadline_idx" ON "organization_lifecycle_authority" USING btree ("state","recoverable_until");--> statement-breakpoint
CREATE INDEX "organization_lifecycle_transition_idx" ON "organization_lifecycle_authority" USING btree ("last_transition_at" DESC);--> statement-breakpoint
CREATE FUNCTION "guard_organization_lifecycle_revision_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id" THEN
    RAISE EXCEPTION 'organization lifecycle authority cannot change tenant';
  END IF;

  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'organization lifecycle revision must advance by exactly one';
  END IF;

  IF NOT (
    (OLD."state" = 'active' AND NEW."state" = 'closure_requested')
    OR (OLD."state" = 'closure_requested' AND NEW."state" IN ('active', 'closing'))
    OR (OLD."state" = 'closing' AND NEW."state" IN ('active', 'purge_pending'))
    OR (OLD."state" = 'purge_pending' AND NEW."state" IN ('active', 'purging'))
    OR (OLD."state" = 'purging' AND NEW."state" = 'closed')
  ) THEN
    RAISE EXCEPTION 'invalid organization lifecycle state transition: % -> %', OLD."state", NEW."state";
  END IF;

  IF NOT (
    (OLD."state" = 'active' AND NEW."state" = 'closure_requested' AND NEW."last_reason_code" IN ('account_admin_request', 'contract_ended', 'duplicate_workspace', 'privacy_request', 'test_workspace'))
    OR (OLD."state" = 'closure_requested' AND NEW."state" = 'active' AND NEW."last_reason_code" IN ('closure_cancelled', 'request_created_in_error', 'retention_needed'))
    OR (OLD."state" = 'closure_requested' AND NEW."state" = 'closing' AND NEW."last_reason_code" = 'closing_prepared')
    OR (OLD."state" = 'closing' AND NEW."state" = 'active' AND NEW."last_reason_code" IN ('closure_cancelled', 'request_created_in_error', 'retention_needed'))
    OR (OLD."state" = 'closing' AND NEW."state" = 'purge_pending' AND NEW."last_reason_code" IN ('recovery_window_elapsed', 'recovery_window_waived'))
    OR (OLD."state" = 'purge_pending' AND NEW."state" = 'active' AND NEW."last_reason_code" = 'purge_cancelled_before_irreversible')
    OR (OLD."state" = 'purge_pending' AND NEW."state" = 'purging' AND NEW."last_reason_code" = 'irreversible_purge_authorized')
    OR (OLD."state" = 'purging' AND NEW."state" = 'closed' AND NEW."last_reason_code" = 'context_purge_complete')
  ) THEN
    RAISE EXCEPTION 'organization lifecycle reason does not match state transition';
  END IF;

  IF OLD."state" = 'active' AND OLD."reactivation_required" = true THEN
    RAISE EXCEPTION 'organization lifecycle requires explicit reactivation before a new closure';
  END IF;

  IF OLD."state" <> 'active' AND (
    NEW."closure_lineage_id" IS DISTINCT FROM OLD."closure_lineage_id"
    OR NEW."closure_requested_at" IS DISTINCT FROM OLD."closure_requested_at"
    OR NEW."recoverable_until" IS DISTINCT FROM OLD."recoverable_until"
    OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
    OR NEW."request_reason_code" IS DISTINCT FROM OLD."request_reason_code"
    OR NEW."request_support_evidence_ref" IS DISTINCT FROM OLD."request_support_evidence_ref"
  ) THEN
    RAISE EXCEPTION 'organization lifecycle closure request evidence is immutable';
  END IF;

  IF OLD."irreversible_at" IS NOT NULL
     AND NEW."irreversible_at" IS DISTINCT FROM OLD."irreversible_at" THEN
    RAISE EXCEPTION 'organization lifecycle irreversible boundary is immutable';
  END IF;

  IF NEW."last_transition_at" < OLD."last_transition_at" THEN
    RAISE EXCEPTION 'organization lifecycle transition time cannot move backwards';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "organization_lifecycle_revision_guard"
BEFORE UPDATE ON "organization_lifecycle_authority"
FOR EACH ROW EXECUTE FUNCTION "guard_organization_lifecycle_revision_v1"();--> statement-breakpoint
CREATE TABLE "organization_lifecycle_command_receipts" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"operation" text NOT NULL,
	"result_state" text NOT NULL,
	"result_revision" integer NOT NULL,
	"closure_lineage_id" uuid,
	"closure_requested_at" timestamp with time zone,
	"recoverable_until" timestamp with time zone,
	"irreversible_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reactivation_required" boolean NOT NULL,
	"last_transition_at" timestamp with time zone NOT NULL,
	"last_actor_id" varchar(255) NOT NULL,
	"last_reason_code" varchar(64) NOT NULL,
	"last_support_evidence_ref" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_lifecycle_receipt_operation_valid" CHECK ("organization_lifecycle_command_receipts"."operation" IN ('request', 'cancel')),
	CONSTRAINT "organization_lifecycle_receipt_state_valid" CHECK ("organization_lifecycle_command_receipts"."result_state" IN ('active', 'closure_requested', 'closing', 'purge_pending', 'purging', 'closed')),
	CONSTRAINT "organization_lifecycle_receipt_revision_positive" CHECK ("organization_lifecycle_command_receipts"."result_revision" > 0)
);--> statement-breakpoint
CREATE INDEX "organization_lifecycle_receipt_org_time_idx" ON "organization_lifecycle_command_receipts" USING btree ("organization_id","occurred_at" DESC);--> statement-breakpoint

-- Context-owned Organization Export control plane. It stores only lifecycle,
-- checksum, object-key, token-digest, and content-free evidence; archive
-- contents stay encrypted in private object storage.
CREATE TABLE "organization_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by" varchar(255) NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"format_version" varchar(64) DEFAULT 'organization-export/v1' NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"object_expires_at" timestamp with time zone NOT NULL,
	"generation_lease_expires_at" timestamp with time zone,
	"coverage_sha256" varchar(64),
	"manifest_sha256" varchar(64),
	"archive_sha256" varchar(64),
	"object_key" varchar(200),
	"encryption_evidence_ref" varchar(200),
	"retrieval_operation_id" uuid,
	"retrieval_token_digest" varchar(64),
	"retrieval_issued_at" timestamp with time zone,
	"retrieval_expires_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone,
	"deletion_evidence_ref" varchar(200),
	"deleted_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_export_state_valid" CHECK ("organization_exports"."state" IN ('requested', 'generating', 'ready', 'retrieval_issued', 'retrieved', 'delete_pending', 'deleted', 'failed')),
	CONSTRAINT "organization_export_revision_positive" CHECK ("organization_exports"."revision" >= 1),
	CONSTRAINT "organization_export_version_fixed" CHECK ("organization_exports"."format_version" = 'organization-export/v1'),
	CONSTRAINT "organization_export_object_expiry_bounded" CHECK ("organization_exports"."object_expires_at" > "organization_exports"."created_at" AND "organization_exports"."object_expires_at" <= "organization_exports"."created_at" + interval '7 days'),
	CONSTRAINT "organization_export_digest_shape" CHECK (("organization_exports"."coverage_sha256" IS NULL OR "organization_exports"."coverage_sha256" ~ '^[a-f0-9]{64}$') AND ("organization_exports"."manifest_sha256" IS NULL OR "organization_exports"."manifest_sha256" ~ '^[a-f0-9]{64}$') AND ("organization_exports"."archive_sha256" IS NULL OR "organization_exports"."archive_sha256" ~ '^[a-f0-9]{64}$') AND ("organization_exports"."retrieval_token_digest" IS NULL OR "organization_exports"."retrieval_token_digest" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "organization_export_evidence_ref_shape" CHECK (("organization_exports"."encryption_evidence_ref" IS NULL OR "organization_exports"."encryption_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$') AND ("organization_exports"."deletion_evidence_ref" IS NULL OR "organization_exports"."deletion_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')),
	CONSTRAINT "organization_export_error_code_shape" CHECK ("organization_exports"."last_error_code" IS NULL OR "organization_exports"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "organization_export_state_shape" CHECK ((
		"organization_exports"."state" = 'requested' AND "organization_exports"."generation_lease_expires_at" IS NULL AND "organization_exports"."coverage_sha256" IS NULL AND "organization_exports"."manifest_sha256" IS NULL AND "organization_exports"."archive_sha256" IS NULL AND "organization_exports"."object_key" IS NULL AND "organization_exports"."encryption_evidence_ref" IS NULL AND "organization_exports"."last_error_code" IS NULL
	) OR (
		"organization_exports"."state" = 'generating' AND "organization_exports"."generation_lease_expires_at" IS NOT NULL AND "organization_exports"."coverage_sha256" IS NULL AND "organization_exports"."manifest_sha256" IS NULL AND "organization_exports"."archive_sha256" IS NULL AND "organization_exports"."object_key" IS NULL AND "organization_exports"."encryption_evidence_ref" IS NULL AND "organization_exports"."last_error_code" IS NULL
	) OR (
		"organization_exports"."state" IN ('ready', 'retrieval_issued', 'retrieved', 'delete_pending', 'deleted') AND "organization_exports"."generation_lease_expires_at" IS NULL AND "organization_exports"."coverage_sha256" IS NOT NULL AND "organization_exports"."manifest_sha256" IS NOT NULL AND "organization_exports"."archive_sha256" IS NOT NULL AND "organization_exports"."object_key" IS NOT NULL AND "organization_exports"."encryption_evidence_ref" IS NOT NULL AND "organization_exports"."last_error_code" IS NULL
	) OR (
		"organization_exports"."state" = 'failed' AND "organization_exports"."generation_lease_expires_at" IS NULL AND "organization_exports"."coverage_sha256" IS NULL AND "organization_exports"."manifest_sha256" IS NULL AND "organization_exports"."archive_sha256" IS NULL AND "organization_exports"."object_key" IS NULL AND "organization_exports"."encryption_evidence_ref" IS NULL AND "organization_exports"."last_error_code" IS NOT NULL
	)),
	CONSTRAINT "organization_export_retrieval_shape" CHECK ((
		"organization_exports"."state" = 'retrieval_issued' AND "organization_exports"."retrieval_operation_id" IS NOT NULL AND "organization_exports"."retrieval_token_digest" IS NOT NULL AND "organization_exports"."retrieval_issued_at" IS NOT NULL AND "organization_exports"."retrieval_expires_at" > "organization_exports"."retrieval_issued_at" AND "organization_exports"."retrieval_expires_at" <= "organization_exports"."retrieval_issued_at" + interval '24 hours' AND "organization_exports"."retrieval_expires_at" <= "organization_exports"."object_expires_at" AND "organization_exports"."retrieved_at" IS NULL
	) OR (
		"organization_exports"."state" = 'retrieved' AND "organization_exports"."retrieval_operation_id" IS NOT NULL AND "organization_exports"."retrieval_token_digest" IS NULL AND "organization_exports"."retrieval_issued_at" IS NOT NULL AND "organization_exports"."retrieval_expires_at" IS NULL AND "organization_exports"."retrieved_at" IS NOT NULL
	) OR (
		"organization_exports"."state" NOT IN ('retrieval_issued', 'retrieved') AND "organization_exports"."retrieval_operation_id" IS NULL AND "organization_exports"."retrieval_token_digest" IS NULL AND "organization_exports"."retrieval_issued_at" IS NULL AND "organization_exports"."retrieval_expires_at" IS NULL AND "organization_exports"."retrieved_at" IS NULL
	)),
	CONSTRAINT "organization_export_deletion_shape" CHECK (("organization_exports"."state" = 'deleted' AND "organization_exports"."deleted_at" IS NOT NULL AND "organization_exports"."deletion_evidence_ref" IS NOT NULL) OR ("organization_exports"."state" <> 'deleted' AND "organization_exports"."deleted_at" IS NULL AND "organization_exports"."deletion_evidence_ref" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "organization_exports_one_open_per_org_idx" ON "organization_exports" USING btree ("organization_id") WHERE "organization_exports"."state" IN ('requested', 'generating', 'ready', 'retrieval_issued');--> statement-breakpoint
CREATE INDEX "organization_exports_generation_idx" ON "organization_exports" USING btree ("state","generation_lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "organization_exports_expiry_idx" ON "organization_exports" USING btree ("state","object_expires_at");--> statement-breakpoint
CREATE FUNCTION "guard_organization_export_revision_v1"() RETURNS trigger
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
    OR (OLD."state" = 'retrieval_issued' AND NEW."state" IN ('retrieved', 'delete_pending'))
    OR (OLD."state" = 'retrieved' AND NEW."state" = 'delete_pending')
    OR (OLD."state" = 'delete_pending' AND NEW."state" = 'deleted')
  ) THEN
    RAISE EXCEPTION 'invalid organization export state transition: % -> %', OLD."state", NEW."state";
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
$$;--> statement-breakpoint
CREATE TRIGGER "organization_export_revision_guard"
BEFORE UPDATE ON "organization_exports"
FOR EACH ROW EXECUTE FUNCTION "guard_organization_export_revision_v1"();--> statement-breakpoint

-- The lifecycle authority is the durable fail-closed fence. Generic policy
-- administration may add/refresh a suspension, but may not clear or delete it
-- while closure is pending or explicit reactivation work remains.
CREATE FUNCTION "guard_organization_lifecycle_policy_fence_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_organization_id text;
  attempts_to_clear boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_organization_id := OLD."organization_id";
    attempts_to_clear := true;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW."organization_id" IS DISTINCT FROM OLD."organization_id" THEN
      RAISE EXCEPTION 'organization policy cannot change tenant';
    END IF;
    target_organization_id := NEW."organization_id";
    attempts_to_clear := NEW."suspended_at" IS NULL;
  END IF;

  IF attempts_to_clear AND EXISTS (
    SELECT 1
    FROM "organization_lifecycle_authority" AS lifecycle
    WHERE lifecycle."organization_id" = target_organization_id
      AND (lifecycle."state" <> 'active' OR lifecycle."reactivation_required" = true)
  ) THEN
    RAISE EXCEPTION 'organization lifecycle fence requires explicit reactivation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "organization_lifecycle_policy_fence"
BEFORE INSERT OR UPDATE OR DELETE ON "organization_policy"
FOR EACH ROW EXECUTE FUNCTION "guard_organization_lifecycle_policy_fence_v1"();--> statement-breakpoint

-- Better Auth owns Organization creation, so the lifecycle control plane must
-- provision itself in the same transaction without relying on one app route.
CREATE FUNCTION "provision_organization_lifecycle_authority_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "organization_lifecycle_authority" (
    "organization_id", "state", "revision", "reactivation_required",
    "last_transition_at", "last_actor_id", "last_reason_code",
    "last_support_evidence_ref"
  ) VALUES (
    NEW."id", 'active', 0, false, NEW."createdAt", 'system:organization',
    'provisioned', 'organization:create'
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "organization_lifecycle_authority_provision"
AFTER INSERT ON "organization"
FOR EACH ROW EXECUTE FUNCTION "provision_organization_lifecycle_authority_v1"();--> statement-breakpoint

-- Existing Organizations become explicit active authorities without
-- interpreting any external/provider state.
INSERT INTO "organization_lifecycle_authority" (
	"organization_id", "state", "revision", "reactivation_required",
	"last_transition_at", "last_actor_id", "last_reason_code",
	"last_support_evidence_ref"
)
SELECT
	"id", 'active', 0, false, "createdAt", 'system:migration',
	'provisioned', 'migration:0159'
FROM "organization"
ON CONFLICT ("organization_id") DO NOTHING;
