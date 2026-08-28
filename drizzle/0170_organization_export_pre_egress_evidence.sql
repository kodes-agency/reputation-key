-- Durable pre-egress export evidence and crash recovery (LIF-01).
--
-- Today a crash between `storage.putEncrypted` resolving and
-- `repository.completeGeneration` committing is unrecoverable: the encrypted
-- bytes exist in the object store but NOTHING in PostgreSQL records that they
-- were ever produced, which digests they carry, or under which key they live.
-- Recovery could then only rebuild the bundle — passing a LATER live snapshot
-- off as historical proof — so `identity/build.ts` hard-fences production
-- export generation.
--
-- The fix is one new control-plane state. `egress_pending` is written BEFORE
-- the upload and pins the coverage/manifest/archive digests and the object key
-- while `encryption_evidence_ref` stays NULL, because the upload has not been
-- confirmed. A reclaimed lease can then ask the object store whether that
-- exact key holds that exact checksum, and converge either way:
--   * present and exact  -> complete with the ORIGINAL digests, no rebuild;
--   * absent or mismatch -> fail closed, retaining the digests as evidence.
--
-- Expand-only: no column, table, index or compatibility mirror is removed.
-- The three constraint replacements below are widenings of the same named
-- CHECK (each DROP is immediately followed by an ADD of the same name), and
-- the partial unique index is recreated with a superset predicate so a second
-- open export still cannot exist while one is mid-egress.

ALTER TABLE "organization_exports" ADD COLUMN "pre_egress_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_exports" ADD COLUMN "egress_recovery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_exports" ADD CONSTRAINT "organization_export_recovery_attempts_nonnegative" CHECK ("organization_exports"."egress_recovery_attempts" >= 0);--> statement-breakpoint

ALTER TABLE "organization_exports" DROP CONSTRAINT "organization_export_state_valid";--> statement-breakpoint
ALTER TABLE "organization_exports" ADD CONSTRAINT "organization_export_state_valid" CHECK ("organization_exports"."state" IN ('requested', 'generating', 'egress_pending', 'ready', 'retrieval_issued', 'retrieved', 'delete_pending', 'deleted', 'failed'));--> statement-breakpoint

ALTER TABLE "organization_exports" DROP CONSTRAINT "organization_export_state_shape";--> statement-breakpoint
ALTER TABLE "organization_exports" ADD CONSTRAINT "organization_export_state_shape" CHECK ((
        "organization_exports"."state" = 'requested'
        AND "organization_exports"."generation_lease_expires_at" IS NULL
        AND "organization_exports"."coverage_sha256" IS NULL
        AND "organization_exports"."manifest_sha256" IS NULL
        AND "organization_exports"."archive_sha256" IS NULL
        AND "organization_exports"."object_key" IS NULL
        AND "organization_exports"."encryption_evidence_ref" IS NULL
        AND "organization_exports"."pre_egress_recorded_at" IS NULL
        AND "organization_exports"."last_error_code" IS NULL
      ) OR (
        "organization_exports"."state" = 'generating'
        AND "organization_exports"."generation_lease_expires_at" IS NOT NULL
        AND "organization_exports"."coverage_sha256" IS NULL
        AND "organization_exports"."manifest_sha256" IS NULL
        AND "organization_exports"."archive_sha256" IS NULL
        AND "organization_exports"."object_key" IS NULL
        AND "organization_exports"."encryption_evidence_ref" IS NULL
        AND "organization_exports"."pre_egress_recorded_at" IS NULL
        AND "organization_exports"."last_error_code" IS NULL
      ) OR (
        "organization_exports"."state" = 'egress_pending'
        AND "organization_exports"."generation_lease_expires_at" IS NOT NULL
        AND "organization_exports"."coverage_sha256" IS NOT NULL
        AND "organization_exports"."manifest_sha256" IS NOT NULL
        AND "organization_exports"."archive_sha256" IS NOT NULL
        AND "organization_exports"."object_key" IS NOT NULL
        AND "organization_exports"."encryption_evidence_ref" IS NULL
        AND "organization_exports"."pre_egress_recorded_at" IS NOT NULL
        AND "organization_exports"."last_error_code" IS NULL
      ) OR (
        "organization_exports"."state" IN ('ready', 'retrieval_issued', 'retrieved', 'delete_pending', 'deleted')
        AND "organization_exports"."generation_lease_expires_at" IS NULL
        AND "organization_exports"."coverage_sha256" IS NOT NULL
        AND "organization_exports"."manifest_sha256" IS NOT NULL
        AND "organization_exports"."archive_sha256" IS NOT NULL
        AND "organization_exports"."object_key" IS NOT NULL
        AND "organization_exports"."encryption_evidence_ref" IS NOT NULL
        AND "organization_exports"."last_error_code" IS NULL
      ) OR (
        "organization_exports"."state" = 'failed'
        AND "organization_exports"."generation_lease_expires_at" IS NULL
        AND "organization_exports"."encryption_evidence_ref" IS NULL
        AND "organization_exports"."last_error_code" IS NOT NULL
        AND (
          (
            "organization_exports"."coverage_sha256" IS NULL
            AND "organization_exports"."manifest_sha256" IS NULL
            AND "organization_exports"."archive_sha256" IS NULL
            AND "organization_exports"."object_key" IS NULL
            AND "organization_exports"."pre_egress_recorded_at" IS NULL
          ) OR (
            "organization_exports"."coverage_sha256" IS NOT NULL
            AND "organization_exports"."manifest_sha256" IS NOT NULL
            AND "organization_exports"."archive_sha256" IS NOT NULL
            AND "organization_exports"."object_key" IS NOT NULL
            AND "organization_exports"."pre_egress_recorded_at" IS NOT NULL
          )
        )
      ));--> statement-breakpoint

-- A mid-egress export is an OPEN export: recreate the single-open-per-org
-- predicate as a superset so a second request cannot start while the first
-- still owns its deterministic object key.
DROP INDEX "organization_exports_one_open_per_org_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "organization_exports_one_open_per_org_idx" ON "organization_exports" USING btree ("organization_id") WHERE "organization_exports"."state" IN ('requested', 'generating', 'egress_pending', 'ready', 'retrieval_issued');--> statement-breakpoint
CREATE INDEX "organization_exports_pre_egress_idx" ON "organization_exports" USING btree ("state","pre_egress_recorded_at");--> statement-breakpoint

-- `generating -> ready` is deliberately withdrawn. `ready` now REQUIRES that
-- durable pre-egress evidence was committed first, so no path can publish an
-- archive whose digests were never recorded before egress. A reclaimed lease
-- renews in place (`egress_pending -> egress_pending`) instead of returning to
-- `generating`, which would have licensed a rebuild.
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
    OR (OLD."state" = 'generating' AND NEW."state" IN ('generating', 'egress_pending', 'failed'))
    OR (OLD."state" = 'egress_pending' AND NEW."state" IN ('egress_pending', 'ready', 'failed'))
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

  -- Pre-egress evidence is write-once. A recovery pass may only READ these
  -- values; any attempt to rewrite a digest, key, or the moment they were
  -- committed is a rebuild in disguise.
  IF (OLD."object_key" IS NOT NULL AND NEW."object_key" IS DISTINCT FROM OLD."object_key")
     OR (OLD."coverage_sha256" IS NOT NULL AND NEW."coverage_sha256" IS DISTINCT FROM OLD."coverage_sha256")
     OR (OLD."manifest_sha256" IS NOT NULL AND NEW."manifest_sha256" IS DISTINCT FROM OLD."manifest_sha256")
     OR (OLD."archive_sha256" IS NOT NULL AND NEW."archive_sha256" IS DISTINCT FROM OLD."archive_sha256")
     OR (OLD."pre_egress_recorded_at" IS NOT NULL AND NEW."pre_egress_recorded_at" IS DISTINCT FROM OLD."pre_egress_recorded_at")
     OR (OLD."encryption_evidence_ref" IS NOT NULL AND NEW."encryption_evidence_ref" IS DISTINCT FROM OLD."encryption_evidence_ref") THEN
    RAISE EXCEPTION 'organization export immutable archive evidence changed';
  END IF;

  IF NEW."egress_recovery_attempts" < OLD."egress_recovery_attempts" THEN
    RAISE EXCEPTION 'organization export egress recovery evidence cannot be rewound';
  END IF;
  RETURN NEW;
END;
$$;
