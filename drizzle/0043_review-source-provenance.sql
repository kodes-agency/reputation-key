-- Google import compatibility teardown is intentionally excluded from the
-- Drizzle journal. The controlled R4 cutover applies
-- scripts/migrations/google-import-contract.sql after its quiescence gate.
ALTER TABLE "reviews" ADD COLUMN "source_epoch" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "source_revision" integer;--> statement-breakpoint
CREATE TABLE "review_source_provenance_quarantine" (
  "review_id" uuid PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "quarantined_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "review_source_provenance_quarantine_reason_valid"
    CHECK ("reason" IN ('missing_property', 'cross_tenant_property'))
);--> statement-breakpoint
CREATE INDEX "review_source_provenance_quarantine_org_idx"
  ON "review_source_provenance_quarantine" ("organization_id", "quarantined_at");--> statement-breakpoint
INSERT INTO "review_source_provenance_quarantine"
  ("review_id", "organization_id", "property_id", "reason")
SELECT
  r."id",
  r."organization_id",
  r."property_id",
  CASE WHEN p_any."id" IS NULL THEN 'missing_property' ELSE 'cross_tenant_property' END
FROM "reviews" r
LEFT JOIN "properties" p_any ON p_any."id" = r."property_id"
LEFT JOIN "properties" p_tenant
  ON p_tenant."id" = r."property_id"
  AND p_tenant."organization_id" = r."organization_id"
WHERE p_tenant."id" IS NULL
ON CONFLICT ("review_id") DO NOTHING;--> statement-breakpoint
DELETE FROM "reviews" r
WHERE NOT EXISTS (
  SELECT 1
  FROM "properties" p
  WHERE p."id" = r."property_id"
    AND p."organization_id" = r."organization_id"
);--> statement-breakpoint
UPDATE "reviews" r
SET
  "source_epoch" = p."source_epoch",
  "source_revision" = 1
FROM "properties" p
WHERE p."id" = r."property_id"
  AND p."organization_id" = r."organization_id";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "source_epoch" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "source_revision" SET NOT NULL;--> statement-breakpoint
-- The controlled Google import contract migration removes the legacy identity
-- columns and enum types after the review provenance expansion is complete.
CREATE OR REPLACE FUNCTION "ai_epoch_millis_v1"(p_timestamp timestamptz)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
  result numeric;
BEGIN
  result := floor(extract(epoch FROM p_timestamp)::numeric * 1000);
  IF result < 0 OR result > 9007199254740991 THEN
    RAISE EXCEPTION 'ai_epoch_millis_v1_out_of_range' USING ERRCODE = '22003';
  END IF;
  RETURN result::bigint;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "ai_advisory_lock_key_v1"(p_scope text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
BEGIN
  IF octet_length(p_scope) < 1
    OR octet_length(p_scope) > 2048
    OR p_scope !~ '^[ -~]+$'
    OR p_scope !~ '^(release-run|erasure-owner|provider-source|provider-snapshot|property-event|reply-adoption|provider-rate|deployment-concurrency|organization-concurrency|property-concurrency|operation-attempt|canary-release)\|'
  THEN
    RAISE EXCEPTION 'ai_advisory_lock_key_v1_invalid_scope' USING ERRCODE = '22023';
  END IF;
  RETURN hashtextextended(
    'ai-admission-scope-v1|' || octet_length(p_scope)::text || ':' || p_scope,
    5928232768719372617
  );
END;
$$;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "source_revision" TYPE bigint;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "analysis_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "ai_source_byte_length" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "ai_source_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_source_epoch_safe"
    CHECK ("source_epoch" BETWEEN 0 AND 2147483647),
  ADD CONSTRAINT "reviews_source_revision_safe"
    CHECK ("source_revision" BETWEEN 0 AND 9007199254740991),
  ADD CONSTRAINT "reviews_analysis_sequence_safe"
    CHECK ("analysis_sequence" BETWEEN 0 AND 9007199254740991),
  ADD CONSTRAINT "reviews_ai_source_byte_length_valid"
    CHECK ("ai_source_byte_length" BETWEEN 1 AND 4294967295),
  ADD CONSTRAINT "reviews_ai_source_digest_valid"
    CHECK ("ai_source_digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "reviews"
    WHERE "ai_source_byte_length" IS NULL OR "ai_source_digest" IS NULL
  ) THEN
    RAISE EXCEPTION 'review_ai_source_contract_migrator_required' USING ERRCODE = 'P0001';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "reviews"
  ALTER COLUMN "ai_source_byte_length" SET NOT NULL,
  ALTER COLUMN "ai_source_digest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews"
  ALTER COLUMN "analysis_sequence" DROP DEFAULT;--> statement-breakpoint
CREATE TABLE "review_ai_analysis_heads" (
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "source_epoch" integer NOT NULL,
  "head_sequence" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "review_ai_analysis_heads_pk"
    PRIMARY KEY ("organization_id", "property_id", "source_epoch"),
  CONSTRAINT "review_ai_analysis_heads_property_tenant_fk"
    FOREIGN KEY ("organization_id", "property_id")
    REFERENCES "properties" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "review_ai_analysis_heads_source_epoch_safe"
    CHECK ("source_epoch" BETWEEN 0 AND 2147483647),
  CONSTRAINT "review_ai_analysis_heads_sequence_safe"
    CHECK ("head_sequence" BETWEEN 0 AND 9007199254740991)
);--> statement-breakpoint
INSERT INTO "review_ai_analysis_heads"
  ("organization_id", "property_id", "source_epoch", "head_sequence")
SELECT "organization_id", "id", "source_epoch", 0
FROM "properties"
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "lock_review_ai_analysis_head_v1"(
  p_organization_id text,
  p_property_id uuid,
  p_source_epoch integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  property_epoch integer;
  next_sequence bigint;
BEGIN
  SELECT "source_epoch" INTO property_epoch
  FROM public."properties"
  WHERE "organization_id" = p_organization_id
    AND "id" = p_property_id
  FOR UPDATE;

  IF property_epoch IS NULL OR property_epoch <> p_source_epoch THEN
    RAISE EXCEPTION 'review_source_epoch_changed' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."review_ai_analysis_heads" (
    "organization_id", "property_id", "source_epoch", "head_sequence"
  )
  VALUES (p_organization_id, p_property_id, p_source_epoch, 0)
  ON CONFLICT DO NOTHING;

  UPDATE public."review_ai_analysis_heads"
  SET "head_sequence" = "head_sequence" + 1,
      "updated_at" = transaction_timestamp()
  WHERE "organization_id" = p_organization_id
    AND "property_id" = p_property_id
    AND "source_epoch" = p_source_epoch
    AND "head_sequence" < 9007199254740991
  RETURNING "head_sequence" INTO next_sequence;

  IF next_sequence IS NULL THEN
    RAISE EXCEPTION 'review_analysis_sequence_unavailable' USING ERRCODE = '22003';
  END IF;
  RETURN next_sequence;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "lock_review_ai_analysis_head_v1"(text, uuid, integer) FROM PUBLIC;--> statement-breakpoint
CREATE TABLE "review_provider_subject_hmac_key_versions" (
  "key_version" varchar(32) PRIMARY KEY,
  "key_digest" varchar(64) NOT NULL,
  "state" varchar(16) NOT NULL,
  "generation" bigint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "activated_at" timestamptz,
  "retiring_at" timestamptz,
  CONSTRAINT "review_provider_subject_key_version_valid"
    CHECK ("key_version" ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  CONSTRAINT "review_provider_subject_key_digest_valid"
    CHECK ("key_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "review_provider_subject_key_state_valid"
    CHECK ("state" IN ('trusted_next', 'active', 'retiring')),
  CONSTRAINT "review_provider_subject_key_generation_safe"
    CHECK ("generation" BETWEEN 1 AND 9007199254740991)
);--> statement-breakpoint
CREATE UNIQUE INDEX "review_provider_subject_one_active_idx"
  ON "review_provider_subject_hmac_key_versions" ("state")
  WHERE "state" = 'active';
--> statement-breakpoint
CREATE TABLE "review_provider_snapshot_runs" (
  "id" uuid PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "source_epoch" integer NOT NULL,
  "state" varchar(16) NOT NULL,
  "phase" varchar(16) NOT NULL,
  "expected_total" integer,
  "main_cursor_ref" varchar(76),
  "confirmation_cursor_ref" varchar(76),
  "main_page_count" integer DEFAULT 0 NOT NULL,
  "main_unique_count" integer DEFAULT 0 NOT NULL,
  "confirmation_page_count" integer DEFAULT 0 NOT NULL,
  "confirmation_unique_count" integer DEFAULT 0 NOT NULL,
  "apply_cursor_review_id" uuid,
  "started_at" timestamptz NOT NULL,
  "confirmation_deadline" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "terminal_at" timestamptz,
  "record_expires_at" timestamptz,
  "failure_code" varchar(64),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "review_provider_snapshot_runs_property_tenant_fk"
    FOREIGN KEY ("organization_id", "property_id")
    REFERENCES "properties" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "review_provider_snapshot_runs_state_valid"
    CHECK ("state" IN ('scanning', 'confirming', 'deleting', 'completed', 'failed')),
  CONSTRAINT "review_provider_snapshot_runs_phase_valid"
    CHECK ("phase" IN ('main', 'confirmation', 'apply', 'terminal')),
  CONSTRAINT "review_provider_snapshot_runs_counts_valid"
    CHECK (
      "source_epoch" BETWEEN 0 AND 2147483647
      AND ("expected_total" IS NULL OR "expected_total" BETWEEN 0 AND 10000)
      AND "main_page_count" BETWEEN 0 AND 200
      AND "confirmation_page_count" BETWEEN 0 AND 200
      AND "main_unique_count" BETWEEN 0 AND 10000
      AND "confirmation_unique_count" BETWEEN 0 AND 10000
    ),
  CONSTRAINT "review_provider_snapshot_runs_terminal_valid"
    CHECK (
      ("state" IN ('completed', 'failed')
        AND "terminal_at" IS NOT NULL
        AND "record_expires_at" = "terminal_at" + interval '30 days')
      OR
      ("state" NOT IN ('completed', 'failed')
        AND "terminal_at" IS NULL
        AND "record_expires_at" IS NULL)
    )
);--> statement-breakpoint
CREATE UNIQUE INDEX "review_provider_snapshot_one_active_idx"
  ON "review_provider_snapshot_runs" ("organization_id", "property_id", "source_epoch")
  WHERE "state" IN ('scanning', 'confirming', 'deleting');--> statement-breakpoint
CREATE TABLE "review_provider_subjects" (
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "source_epoch" integer NOT NULL,
  "key_version" varchar(32) NOT NULL,
  "locator_hmac" bytea NOT NULL,
  "verifier_hmac" bytea NOT NULL,
  "review_id" uuid NOT NULL,
  "last_source_revision" bigint NOT NULL,
  "state" varchar(24) NOT NULL,
  "last_observed_at" timestamptz NOT NULL,
  "last_seen_snapshot_run_id" uuid,
  "first_missing_at" timestamptz,
  "first_missing_snapshot_run_id" uuid,
  "unlinked_at" timestamptz,
  "unlink_expires_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "review_provider_subjects_pk"
    PRIMARY KEY (
      "organization_id", "property_id", "source_epoch", "key_version", "locator_hmac"
    ),
  CONSTRAINT "review_provider_subjects_property_tenant_fk"
    FOREIGN KEY ("organization_id", "property_id")
    REFERENCES "properties" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "review_provider_subjects_key_version_fk"
    FOREIGN KEY ("key_version")
    REFERENCES "review_provider_subject_hmac_key_versions" ("key_version")
    ON DELETE RESTRICT,
  CONSTRAINT "review_provider_subjects_last_seen_run_fk"
    FOREIGN KEY ("last_seen_snapshot_run_id")
    REFERENCES "review_provider_snapshot_runs" ("id") ON DELETE SET NULL,
  CONSTRAINT "review_provider_subjects_hmac_length_valid"
    CHECK (octet_length("locator_hmac") = 32 AND octet_length("verifier_hmac") = 32),
  CONSTRAINT "review_provider_subjects_controls_safe"
    CHECK (
      "source_epoch" BETWEEN 0 AND 2147483647
      AND "last_source_revision" BETWEEN 0 AND 9007199254740991
    ),
  CONSTRAINT "review_provider_subjects_state_valid"
    CHECK ("state" IN ('linked', 'source_expired', 'provider_deleted')),
  CONSTRAINT "review_provider_subjects_unlink_valid"
    CHECK (
      ("state" = 'linked' AND "unlinked_at" IS NULL AND "unlink_expires_at" IS NULL)
      OR
      ("state" <> 'linked' AND "unlinked_at" IS NOT NULL
        AND "unlink_expires_at" = "unlinked_at" + interval '24 months')
    ),
  CONSTRAINT "review_provider_subjects_missing_pair_valid"
    CHECK (("first_missing_at" IS NULL) = ("first_missing_snapshot_run_id" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "review_provider_subjects_review_unique"
  ON "review_provider_subjects"
    ("organization_id", "property_id", "source_epoch", "review_id");--> statement-breakpoint
CREATE TABLE "review_provider_snapshot_members" (
  "run_id" uuid NOT NULL,
  "review_id" uuid NOT NULL,
  "main_seen" boolean DEFAULT false NOT NULL,
  "confirmation_seen" boolean DEFAULT false NOT NULL,
  CONSTRAINT "review_provider_snapshot_members_pk" PRIMARY KEY ("run_id", "review_id"),
  CONSTRAINT "review_provider_snapshot_members_run_fk"
    FOREIGN KEY ("run_id") REFERENCES "review_provider_snapshot_runs" ("id")
    ON DELETE CASCADE
);--> statement-breakpoint
CREATE TABLE "review_provider_deletion_candidates" (
  "run_id" uuid NOT NULL,
  "review_id" uuid NOT NULL,
  "expected_mapping_state" varchar(24) NOT NULL,
  "expected_source_revision" bigint NOT NULL,
  "state" varchar(24) DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "review_provider_deletion_candidates_pk" PRIMARY KEY ("run_id", "review_id"),
  CONSTRAINT "review_provider_deletion_candidates_run_fk"
    FOREIGN KEY ("run_id") REFERENCES "review_provider_snapshot_runs" ("id")
    ON DELETE CASCADE,
  CONSTRAINT "review_provider_deletion_candidates_state_valid"
    CHECK ("state" IN ('pending', 'confirmed_missing', 'observed')),
  CONSTRAINT "review_provider_deletion_candidates_mapping_state_valid"
    CHECK ("expected_mapping_state" IN ('linked', 'source_expired')),
  CONSTRAINT "review_provider_deletion_candidates_revision_safe"
    CHECK ("expected_source_revision" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "initialize_review_provider_subject_hmac_key_v1"(
  p_key_version text,
  p_key_digest text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  LOCK TABLE public."review_provider_subject_hmac_key_versions"
    IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public."review_provider_subject_hmac_key_versions") THEN
    RAISE EXCEPTION 'review_provider_subject_key_inventory_not_empty'
      USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public."review_provider_subject_hmac_key_versions" (
    "key_version", "key_digest", "state", "generation", "activated_at"
  )
  VALUES (p_key_version, p_key_digest, 'active', 1, transaction_timestamp());
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "review_provider_subject_hmac_key_inventory_v1"()
RETURNS TABLE (
  "key_version" text,
  "key_digest" text,
  "state" text,
  "generation" bigint,
  "reference_count" bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    k."key_version"::text,
    k."key_digest"::text,
    k."state"::text,
    k."generation",
    count(s."key_version")::bigint
  FROM public."review_provider_subject_hmac_key_versions" k
  LEFT JOIN public."review_provider_subjects" s
    ON s."key_version" = k."key_version"
  GROUP BY k."key_version", k."key_digest", k."state", k."generation"
  ORDER BY k."generation", k."key_version"
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "trust_next_review_provider_subject_hmac_key_v1"(
  p_expected_active_version text,
  p_trusted_next_version text,
  p_trusted_next_key_digest text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  active_row public."review_provider_subject_hmac_key_versions"%ROWTYPE;
BEGIN
  PERFORM 1
  FROM public."review_provider_subject_hmac_key_versions"
  ORDER BY "generation", "key_version"
  FOR UPDATE;

  SELECT * INTO active_row
  FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_active_version
    AND "state" = 'active';

  IF active_row."key_version" IS NULL
    OR (SELECT count(*) FROM public."review_provider_subject_hmac_key_versions") <> 1
    OR EXISTS (
      SELECT 1 FROM public."review_provider_subject_hmac_key_versions"
      WHERE "state" IN ('trusted_next', 'retiring')
    )
  THEN
    RAISE EXCEPTION 'review_provider_subject_trust_next_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."review_provider_subject_hmac_key_versions" (
    "key_version", "key_digest", "state", "generation"
  )
  VALUES (
    p_trusted_next_version,
    p_trusted_next_key_digest,
    'trusted_next',
    active_row."generation" + 1
  );
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "rotate_review_provider_subject_hmac_key_v1"(
  p_expected_active_version text,
  p_expected_trusted_next_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  active_row public."review_provider_subject_hmac_key_versions"%ROWTYPE;
  next_row public."review_provider_subject_hmac_key_versions"%ROWTYPE;
  captured_at timestamptz := transaction_timestamp();
BEGIN
  PERFORM 1
  FROM public."review_provider_subject_hmac_key_versions"
  ORDER BY "generation", "key_version"
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public."review_provider_subject_hmac_key_versions"
    WHERE "state" = 'retiring'
  ) THEN
    RAISE EXCEPTION 'review_provider_subject_rotation_in_progress' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO active_row
  FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_active_version AND "state" = 'active';
  SELECT * INTO next_row
  FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_trusted_next_version AND "state" = 'trusted_next';

  IF active_row."key_version" IS NULL OR next_row."key_version" IS NULL
    OR next_row."generation" <> active_row."generation" + 1
    OR (SELECT count(*) FROM public."review_provider_subject_hmac_key_versions") <> 2
  THEN
    RAISE EXCEPTION 'review_provider_subject_rotation_mismatch' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public."review_provider_subject_hmac_key_versions"
  SET "state" = 'retiring', "retiring_at" = captured_at
  WHERE "key_version" = p_expected_active_version;
  UPDATE public."review_provider_subject_hmac_key_versions"
  SET "state" = 'active', "activated_at" = captured_at
  WHERE "key_version" = p_expected_trusted_next_version;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "remove_review_provider_subject_hmac_key_v1"(
  p_expected_retiring_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  retiring_row public."review_provider_subject_hmac_key_versions"%ROWTYPE;
BEGIN
  SELECT * INTO retiring_row
  FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_retiring_version
  FOR UPDATE;

  IF retiring_row."key_version" IS NULL OR retiring_row."state" <> 'retiring' THEN
    RAISE EXCEPTION 'review_provider_subject_retiring_key_mismatch'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."review_provider_subjects"
    WHERE "key_version" = p_expected_retiring_version
  ) THEN
    RAISE EXCEPTION 'review_provider_subject_key_still_referenced'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_retiring_version;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "initialize_review_provider_subject_hmac_key_v1"(text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "review_provider_subject_hmac_key_inventory_v1"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "trust_next_review_provider_subject_hmac_key_v1"(text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "rotate_review_provider_subject_hmac_key_v1"(text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "remove_review_provider_subject_hmac_key_v1"(text) FROM PUBLIC;