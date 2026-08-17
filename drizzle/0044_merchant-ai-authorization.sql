CREATE OR REPLACE FUNCTION "assert_ai_capability_set_executable_v1"(
  p_capabilities text[],
  p_notice_version text,
  p_notice_digest text,
  p_provider_deployment_profile_version text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  canonical_capabilities text[];
  current_capability text;
  mapping record;
  result jsonb := '{}'::jsonb;
BEGIN
  IF p_notice_version <> 'merchant-ai-notice-2026-08-15.v1'
    OR p_notice_digest <> '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b'
    OR p_provider_deployment_profile_version <> 'private-beta-global-v1'
  THEN
    RAISE EXCEPTION 'merchant_ai_runtime_mapping_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(
    array_agg(catalogue.capability ORDER BY catalogue.ordinal),
    ARRAY[]::text[]
  )
  INTO canonical_capabilities
  FROM unnest(ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[])
    WITH ORDINALITY AS catalogue(capability, ordinal)
  WHERE catalogue.capability = ANY(coalesce(p_capabilities, ARRAY[]::text[]));

  IF cardinality(canonical_capabilities) = 0
    OR cardinality(canonical_capabilities) <> cardinality(p_capabilities)
    OR canonical_capabilities <> p_capabilities
    OR ('property_trends' = ANY(p_capabilities) AND NOT 'review_analysis' = ANY(p_capabilities))
  THEN
    RAISE EXCEPTION 'merchant_ai_invalid_capability_set' USING ERRCODE = 'P0001';
  END IF;

  FOREACH current_capability IN ARRAY canonical_capabilities
  LOOP
    SELECT *
    INTO STRICT mapping
    FROM public.resolve_ai_runtime_capability_v1(
      p_provider_deployment_profile_version,
      current_capability,
      '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5'
    );

    IF mapping.notice_version IS DISTINCT FROM p_notice_version
      OR mapping.notice_digest IS DISTINCT FROM p_notice_digest
      OR mapping.resolved_catalogue_digest IS DISTINCT FROM
        '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5'
    THEN
      RAISE EXCEPTION 'merchant_ai_runtime_mapping_unavailable'
        USING ERRCODE = 'P0001';
    END IF;

    result := result || jsonb_build_object(
      current_capability,
      mapping.runtime_profile_version
    );
  END LOOP;
  RETURN result;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_capability_set_executable_v1"(text[], text, text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE "merchant_ai_consent_evidence" (
  "authorization_lineage_id" uuid NOT NULL,
  "state_version" integer NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "transition_kind" text NOT NULL,
  "state" text NOT NULL,
  "capabilities" text[] NOT NULL,
  "capability_runtime_profile_versions" jsonb NOT NULL,
  "review_analysis_epoch" integer NOT NULL,
  "reply_drafting_epoch" integer NOT NULL,
  "property_trends_epoch" integer NOT NULL,
  "authorized_source_epoch" integer NOT NULL,
  "analysis_start_sequence" bigint NOT NULL,
  "notice_version" varchar(100) NOT NULL,
  "notice_digest" varchar(64) NOT NULL,
  "source_policy_id" varchar(150) NOT NULL,
  "routing_policy_version" integer NOT NULL,
  "processing_region" varchar(20) NOT NULL,
  "provider_deployment_profile_version" varchar(100) NOT NULL,
  "redaction_profile_family" varchar(100) NOT NULL,
  "actor_user_id" varchar(255) NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "merchant_ai_consent_evidence_pk" PRIMARY KEY ("authorization_lineage_id", "state_version"),
  CONSTRAINT "merchant_ai_consent_evidence_transition_valid" CHECK ("transition_kind" IN ('enable', 'change', 'revoke', 'restore_reset')),
  CONSTRAINT "merchant_ai_consent_evidence_state_valid" CHECK ("state" IN ('disabled', 'enabled', 'revoked')),
  CONSTRAINT "merchant_ai_consent_evidence_versions_valid" CHECK (
    "state_version" >= 1
    AND "review_analysis_epoch" >= 1
    AND "reply_drafting_epoch" >= 1
    AND "property_trends_epoch" >= 1
    AND "authorized_source_epoch" >= 1
    AND "analysis_start_sequence" >= 0
    AND "routing_policy_version" >= 1
  ),
  CONSTRAINT "merchant_ai_consent_evidence_region_valid" CHECK ("processing_region" = 'global'),
  CONSTRAINT "merchant_ai_consent_evidence_profile_valid" CHECK ("provider_deployment_profile_version" = 'private-beta-global-v1'),
  CONSTRAINT "merchant_ai_consent_evidence_notice_digest_valid" CHECK ("notice_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "merchant_ai_consent_evidence_contract_valid" CHECK (
    "notice_version" = 'merchant-ai-notice-2026-08-15.v1'
    AND "notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b'
    AND "source_policy_id" = 'google-business-profile-source-policy-v1'
    AND "routing_policy_version" = 1
    AND "redaction_profile_family" = 'gbp-review-global-v1'
  ),
  CONSTRAINT "merchant_ai_consent_evidence_capabilities_valid" CHECK (
    (
      "state" = 'enabled'
      AND (
        "capabilities" = ARRAY['review_analysis']::text[]
        OR "capabilities" = ARRAY['reply_drafting']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'property_trends']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]
      )
    )
    OR ("state" IN ('disabled', 'revoked') AND "capabilities" = ARRAY[]::text[])
  ),
  CONSTRAINT "merchant_ai_consent_evidence_runtime_map_valid" CHECK (
    ("capabilities" = ARRAY[]::text[] AND "capability_runtime_profile_versions" = '{}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis":"review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting":"reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis":"review-analysis-runtime-v1","reply_drafting":"reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis":"review-analysis-runtime-v1","property_trends":"property-trends-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis":"review-analysis-runtime-v1","reply_drafting":"reply-drafting-runtime-v1","property_trends":"property-trends-runtime-v1"}'::jsonb)
  ),
  CONSTRAINT "merchant_ai_consent_evidence_request_hash_valid" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "merchant_ai_consent_evidence_reason_valid" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{2,63}$')
);
--> statement-breakpoint
CREATE TABLE "merchant_ai_enablement" (
  "property_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "authorization_lineage_id" uuid NOT NULL,
  "state" text NOT NULL,
  "capabilities" text[] NOT NULL,
  "capability_runtime_profile_versions" jsonb NOT NULL,
  "review_analysis_epoch" integer NOT NULL,
  "reply_drafting_epoch" integer NOT NULL,
  "property_trends_epoch" integer NOT NULL,
  "authorized_source_epoch" integer NOT NULL,
  "analysis_start_sequence" bigint NOT NULL,
  "state_version" integer NOT NULL,
  "notice_version" varchar(100) NOT NULL,
  "notice_digest" varchar(64) NOT NULL,
  "source_policy_id" varchar(150) NOT NULL,
  "routing_policy_version" integer NOT NULL,
  "processing_region" varchar(20) NOT NULL,
  "provider_deployment_profile_version" varchar(100) NOT NULL,
  "redaction_profile_family" varchar(100) NOT NULL,
  "updated_by" varchar(255) NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "merchant_ai_enablement_state_valid" CHECK ("state" IN ('disabled', 'enabled', 'revoked')),
  CONSTRAINT "merchant_ai_enablement_versions_valid" CHECK (
    "state_version" >= 1
    AND "review_analysis_epoch" >= 1
    AND "reply_drafting_epoch" >= 1
    AND "property_trends_epoch" >= 1
    AND "authorized_source_epoch" >= 1
    AND "analysis_start_sequence" >= 0
    AND "routing_policy_version" >= 1
  ),
  CONSTRAINT "merchant_ai_enablement_region_valid" CHECK ("processing_region" = 'global'),
  CONSTRAINT "merchant_ai_enablement_profile_valid" CHECK ("provider_deployment_profile_version" = 'private-beta-global-v1'),
  CONSTRAINT "merchant_ai_enablement_notice_digest_valid" CHECK ("notice_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "merchant_ai_enablement_contract_valid" CHECK (
    "notice_version" = 'merchant-ai-notice-2026-08-15.v1'
    AND "notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b'
    AND "source_policy_id" = 'google-business-profile-source-policy-v1'
    AND "routing_policy_version" = 1
    AND "redaction_profile_family" = 'gbp-review-global-v1'
  ),
  CONSTRAINT "merchant_ai_enablement_capabilities_valid" CHECK (
    (
      "state" = 'enabled'
      AND (
        "capabilities" = ARRAY['review_analysis']::text[]
        OR "capabilities" = ARRAY['reply_drafting']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'property_trends']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]
      )
    )
    OR ("state" IN ('disabled', 'revoked') AND "capabilities" = ARRAY[]::text[])
  ),
  CONSTRAINT "merchant_ai_enablement_runtime_map_valid" CHECK (
    ("capabilities" = ARRAY[]::text[] AND "capability_runtime_profile_versions" = '{}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis":"review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting":"reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis":"review-analysis-runtime-v1","reply_drafting":"reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis":"review-analysis-runtime-v1","property_trends":"property-trends-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis":"review-analysis-runtime-v1","reply_drafting":"reply-drafting-runtime-v1","property_trends":"property-trends-runtime-v1"}'::jsonb)
  )
);
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_evidence_head_fk" FOREIGN KEY ("authorization_lineage_id", "state_version") REFERENCES "public"."merchant_ai_consent_evidence"("authorization_lineage_id", "state_version") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_ai_consent_evidence_idempotency_unique" ON "merchant_ai_consent_evidence" USING btree ("organization_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "merchant_ai_consent_evidence_property_version_idx" ON "merchant_ai_consent_evidence" USING btree ("organization_id", "property_id", "state_version");
--> statement-breakpoint
CREATE INDEX "merchant_ai_enablement_org_idx" ON "merchant_ai_enablement" USING btree ("organization_id", "updated_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_merchant_ai_evidence_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior merchant_ai_consent_evidence%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF current_setting('repkey.merchant_ai_transition', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'merchant_ai_history_is_append_only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'merchant_ai_history_is_append_only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior
  FROM merchant_ai_consent_evidence
  WHERE authorization_lineage_id = NEW.authorization_lineage_id
    AND state_version = NEW.state_version - 1
  FOR SHARE;

  IF NEW.state_version = 1 THEN
    IF FOUND
      OR NOT (
        (NEW.transition_kind = 'enable' AND NEW.state = 'enabled')
        OR (NEW.transition_kind = 'restore_reset' AND NEW.state = 'disabled')
      )
      OR NEW.review_analysis_epoch <> 1 OR NEW.reply_drafting_epoch <> 1
      OR NEW.property_trends_epoch <> 1
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_initial_transition' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT FOUND
      OR prior.organization_id <> NEW.organization_id
      OR prior.property_id <> NEW.property_id
      OR NEW.state_version <> prior.state_version + 1
      OR NEW.review_analysis_epoch < prior.review_analysis_epoch
      OR NEW.review_analysis_epoch > prior.review_analysis_epoch + 1
      OR NEW.reply_drafting_epoch < prior.reply_drafting_epoch
      OR NEW.reply_drafting_epoch > prior.reply_drafting_epoch + 1
      OR NEW.property_trends_epoch < prior.property_trends_epoch
      OR NEW.property_trends_epoch > prior.property_trends_epoch + 1
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_transition_lineage' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "merchant_ai_consent_evidence_append_guard" BEFORE INSERT OR UPDATE OR DELETE ON "merchant_ai_consent_evidence" FOR EACH ROW EXECUTE FUNCTION "guard_merchant_ai_evidence_v1"();
--> statement-breakpoint
CREATE TRIGGER "merchant_ai_consent_evidence_truncate_guard" BEFORE TRUNCATE ON "merchant_ai_consent_evidence" FOR EACH STATEMENT EXECUTE FUNCTION "guard_merchant_ai_evidence_v1"();
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ENABLE ALWAYS TRIGGER "merchant_ai_consent_evidence_append_guard";
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ENABLE ALWAYS TRIGGER "merchant_ai_consent_evidence_truncate_guard";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_merchant_ai_enablement_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  evidence merchant_ai_consent_evidence%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF current_setting('repkey.merchant_ai_transition', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'merchant_ai_head_requires_transition_function' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'merchant_ai_head_cannot_be_deleted' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT evidence
  FROM merchant_ai_consent_evidence
  WHERE authorization_lineage_id = NEW.authorization_lineage_id
    AND state_version = NEW.state_version;
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id <> OLD.organization_id
    OR NEW.property_id <> OLD.property_id
    OR (
      evidence.transition_kind <> 'restore_reset'
      AND (
        NEW.authorization_lineage_id <> OLD.authorization_lineage_id
        OR NEW.state_version <> OLD.state_version + 1
      )
    )
    OR (
      evidence.transition_kind = 'restore_reset'
      AND (
        NEW.authorization_lineage_id = OLD.authorization_lineage_id
        OR NEW.state_version <> 1
        OR NEW.state <> 'disabled'
      )
    )
  ) THEN
    RAISE EXCEPTION 'merchant_ai_head_lineage_replacement' USING ERRCODE = 'P0001';
  END IF;

  IF evidence.organization_id <> NEW.organization_id
    OR evidence.property_id <> NEW.property_id
    OR evidence.state <> NEW.state
    OR evidence.capabilities <> NEW.capabilities
    OR evidence.capability_runtime_profile_versions <> NEW.capability_runtime_profile_versions
    OR evidence.review_analysis_epoch <> NEW.review_analysis_epoch
    OR evidence.reply_drafting_epoch <> NEW.reply_drafting_epoch
    OR evidence.property_trends_epoch <> NEW.property_trends_epoch
    OR evidence.authorized_source_epoch <> NEW.authorized_source_epoch
    OR evidence.analysis_start_sequence <> NEW.analysis_start_sequence
    OR evidence.notice_version <> NEW.notice_version
    OR evidence.notice_digest <> NEW.notice_digest
    OR evidence.source_policy_id <> NEW.source_policy_id
    OR evidence.routing_policy_version <> NEW.routing_policy_version
    OR evidence.processing_region <> NEW.processing_region
    OR evidence.provider_deployment_profile_version <> NEW.provider_deployment_profile_version
    OR evidence.redaction_profile_family <> NEW.redaction_profile_family
  THEN
    RAISE EXCEPTION 'merchant_ai_head_evidence_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "merchant_ai_enablement_transition_guard" BEFORE INSERT OR UPDATE OR DELETE ON "merchant_ai_enablement" FOR EACH ROW EXECUTE FUNCTION "guard_merchant_ai_enablement_v1"();
--> statement-breakpoint
CREATE TRIGGER "merchant_ai_enablement_truncate_guard" BEFORE TRUNCATE ON "merchant_ai_enablement" FOR EACH STATEMENT EXECUTE FUNCTION "guard_merchant_ai_enablement_v1"();
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ENABLE ALWAYS TRIGGER "merchant_ai_enablement_transition_guard";
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ENABLE ALWAYS TRIGGER "merchant_ai_enablement_truncate_guard";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "apply_merchant_ai_transition_v1"(
  p_authorization_lineage_id uuid,
  p_expected_state_version integer,
  p_state_version integer,
  p_organization_id varchar,
  p_property_id uuid,
  p_transition_kind text,
  p_state text,
  p_capabilities text[],
  p_runtime_profiles jsonb,
  p_review_analysis_epoch integer,
  p_reply_drafting_epoch integer,
  p_property_trends_epoch integer,
  p_authorized_source_epoch integer,
  p_analysis_start_sequence bigint,
  p_notice_version varchar,
  p_notice_digest varchar,
  p_source_policy_id varchar,
  p_routing_policy_version integer,
  p_processing_region varchar,
  p_provider_deployment_profile_version varchar,
  p_redaction_profile_family varchar,
  p_actor_user_id varchar,
  p_reason_code varchar,
  p_idempotency_key varchar,
  p_request_hash varchar,
  p_occurred_at timestamp with time zone
) RETURNS merchant_ai_consent_evidence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_head merchant_ai_enablement%ROWTYPE;
  replay merchant_ai_consent_evidence%ROWTYPE;
  inserted_evidence merchant_ai_consent_evidence%ROWTYPE;
  actor_role text;
  property_source_epoch integer;
  property_lifecycle_state text;
  property_binding_state text;
  property_deleted_at timestamp with time zone;
  head_found boolean;
  contract_changed boolean;
  expected_review_analysis_epoch integer;
  expected_reply_drafting_epoch integer;
  expected_property_trends_epoch integer;
BEGIN
  IF p_expected_state_version < 0 OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'merchant_ai_invalid_transition_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO replay
  FROM merchant_ai_consent_evidence
  WHERE organization_id = p_organization_id
    AND idempotency_key = p_idempotency_key
  LIMIT 1;
  IF FOUND THEN
    IF replay.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'merchant_ai_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN replay;
  END IF;

  SELECT lifecycle_state, google_binding_state, deleted_at, source_epoch
  INTO property_lifecycle_state, property_binding_state, property_deleted_at,
       property_source_epoch
  FROM properties
  WHERE organization_id = p_organization_id
    AND id = p_property_id
  FOR SHARE;
  IF NOT FOUND
    OR property_deleted_at IS NOT NULL
    OR property_source_epoch <> p_authorized_source_epoch
    OR (
      p_transition_kind <> 'revoke'
      AND p_transition_kind <> 'restore_reset'
      AND (
        property_lifecycle_state <> 'active'
        OR property_binding_state <> 'active'
      )
    )
  THEN
    RAISE EXCEPTION 'merchant_ai_property_inactive' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO actor_role
  FROM member
  WHERE "organizationId" = p_organization_id
    AND "userId" = p_actor_user_id
  FOR SHARE;
  IF p_transition_kind <> 'restore_reset' THEN
    IF NOT FOUND THEN
      RAISE EXCEPTION 'merchant_ai_membership_denied' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      'owner' = ANY (
        regexp_split_to_array(lower(actor_role), '[[:space:]]*,[[:space:]]*')
      )
    ) AND (
      NOT (
        'admin' = ANY (
          regexp_split_to_array(lower(actor_role), '[[:space:]]*,[[:space:]]*')
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM property_access_grant
        WHERE organization_id = p_organization_id
          AND property_id = p_property_id
          AND user_id = p_actor_user_id
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > p_occurred_at)
      )
    ) THEN
      RAISE EXCEPTION 'merchant_ai_assignment_denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO current_head
  FROM merchant_ai_enablement
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
  FOR UPDATE;
  head_found := FOUND;

  IF (NOT head_found AND p_expected_state_version <> 0)
    OR (
      head_found
      AND current_head.state_version <> p_expected_state_version
    )
  THEN
    RAISE EXCEPTION 'merchant_ai_version_conflict' USING ERRCODE = '40001';
  END IF;

  IF p_transition_kind = 'restore_reset' THEN
    IF p_state <> 'disabled'
      OR cardinality(p_capabilities) <> 0
      OR p_state_version <> 1
      OR (head_found AND current_head.authorization_lineage_id = p_authorization_lineage_id)
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_restore_reset' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF p_state_version <> p_expected_state_version + 1
      OR (
        p_transition_kind = 'enable'
        AND (
          p_state <> 'enabled'
          OR (head_found AND current_head.state NOT IN ('disabled', 'revoked'))
        )
      )
      OR (
        p_transition_kind = 'change'
        AND (
          NOT head_found
          OR current_head.state <> 'enabled'
          OR p_state <> 'enabled'
        )
      )
      OR (
        p_transition_kind = 'revoke'
        AND (
          NOT head_found
          OR current_head.state <> 'enabled'
          OR p_state <> 'revoked'
          OR cardinality(p_capabilities) <> 0
        )
      )
      OR p_transition_kind NOT IN ('enable', 'change', 'revoke')
      OR (
        head_found
        AND current_head.authorization_lineage_id <> p_authorization_lineage_id
      )
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_state_transition' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NOT head_found OR p_transition_kind = 'restore_reset' THEN
    expected_review_analysis_epoch := 1;
    expected_reply_drafting_epoch := 1;
    expected_property_trends_epoch := 1;
    IF p_analysis_start_sequence <> 0 THEN
      RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_transition_kind IN ('enable', 'revoke') THEN
    expected_review_analysis_epoch := current_head.review_analysis_epoch + 1;
    expected_reply_drafting_epoch := current_head.reply_drafting_epoch + 1;
    expected_property_trends_epoch := current_head.property_trends_epoch + 1;
    IF p_analysis_start_sequence <> current_head.analysis_start_sequence THEN
      RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    contract_changed :=
      current_head.notice_version <> p_notice_version
      OR current_head.notice_digest <> p_notice_digest
      OR current_head.source_policy_id <> p_source_policy_id
      OR current_head.routing_policy_version <> p_routing_policy_version
      OR current_head.provider_deployment_profile_version
        <> p_provider_deployment_profile_version
      OR current_head.redaction_profile_family <> p_redaction_profile_family;

    expected_review_analysis_epoch := current_head.review_analysis_epoch + CASE
      WHEN (
        (
          ('review_analysis' = ANY(current_head.capabilities))
          <> ('review_analysis' = ANY(p_capabilities))
        )
        OR (
          (
            current_head.authorized_source_epoch <> p_authorized_source_epoch
            OR contract_changed
            OR current_head.capability_runtime_profile_versions->>'review_analysis'
              IS DISTINCT FROM p_runtime_profiles->>'review_analysis'
          )
          AND (
            'review_analysis' = ANY(current_head.capabilities)
            OR 'review_analysis' = ANY(p_capabilities)
          )
        )
      ) THEN 1 ELSE 0
    END;
    expected_reply_drafting_epoch := current_head.reply_drafting_epoch + CASE
      WHEN (
        (
          ('reply_drafting' = ANY(current_head.capabilities))
          <> ('reply_drafting' = ANY(p_capabilities))
        )
        OR (
          (
            current_head.authorized_source_epoch <> p_authorized_source_epoch
            OR contract_changed
            OR current_head.capability_runtime_profile_versions->>'reply_drafting'
              IS DISTINCT FROM p_runtime_profiles->>'reply_drafting'
          )
          AND (
            'reply_drafting' = ANY(current_head.capabilities)
            OR 'reply_drafting' = ANY(p_capabilities)
          )
        )
      ) THEN 1 ELSE 0
    END;
    expected_property_trends_epoch := current_head.property_trends_epoch + CASE
      WHEN (
        (
          ('property_trends' = ANY(current_head.capabilities))
          <> ('property_trends' = ANY(p_capabilities))
        )
        OR (
          (
            current_head.authorized_source_epoch <> p_authorized_source_epoch
            OR contract_changed
            OR current_head.capability_runtime_profile_versions->>'property_trends'
              IS DISTINCT FROM p_runtime_profiles->>'property_trends'
          )
          AND (
            'property_trends' = ANY(current_head.capabilities)
            OR 'property_trends' = ANY(p_capabilities)
          )
        )
      ) THEN 1 ELSE 0
    END;
    IF p_analysis_start_sequence <> current_head.analysis_start_sequence THEN
      RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_review_analysis_epoch <> expected_review_analysis_epoch
    OR p_reply_drafting_epoch <> expected_reply_drafting_epoch
    OR p_property_trends_epoch <> expected_property_trends_epoch
  THEN
    RAISE EXCEPTION 'merchant_ai_invalid_capability_epoch' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('repkey.merchant_ai_transition', '1', true);
  INSERT INTO merchant_ai_consent_evidence (
    authorization_lineage_id, state_version, organization_id, property_id,
    transition_kind, state, capabilities, capability_runtime_profile_versions,
    review_analysis_epoch, reply_drafting_epoch, property_trends_epoch,
    authorized_source_epoch, analysis_start_sequence, notice_version, notice_digest,
    source_policy_id, routing_policy_version, processing_region,
    provider_deployment_profile_version, redaction_profile_family,
    actor_user_id, reason_code, idempotency_key, request_hash, occurred_at
  ) VALUES (
    p_authorization_lineage_id, p_state_version, p_organization_id, p_property_id,
    p_transition_kind, p_state, p_capabilities, p_runtime_profiles,
    p_review_analysis_epoch, p_reply_drafting_epoch, p_property_trends_epoch,
    p_authorized_source_epoch, p_analysis_start_sequence, p_notice_version,
    p_notice_digest, p_source_policy_id, p_routing_policy_version,
    p_processing_region, p_provider_deployment_profile_version,
    p_redaction_profile_family, p_actor_user_id, p_reason_code,
    p_idempotency_key, p_request_hash, p_occurred_at
  )
  RETURNING * INTO inserted_evidence;

  INSERT INTO merchant_ai_enablement (
    property_id, organization_id, authorization_lineage_id, state, capabilities,
    capability_runtime_profile_versions, review_analysis_epoch,
    reply_drafting_epoch, property_trends_epoch, authorized_source_epoch,
    analysis_start_sequence, state_version, notice_version, notice_digest,
    source_policy_id, routing_policy_version, processing_region,
    provider_deployment_profile_version, redaction_profile_family,
    updated_by, updated_at
  ) VALUES (
    p_property_id, p_organization_id, p_authorization_lineage_id, p_state,
    p_capabilities, p_runtime_profiles, p_review_analysis_epoch,
    p_reply_drafting_epoch, p_property_trends_epoch, p_authorized_source_epoch,
    p_analysis_start_sequence, p_state_version, p_notice_version, p_notice_digest,
    p_source_policy_id, p_routing_policy_version, p_processing_region,
    p_provider_deployment_profile_version, p_redaction_profile_family,
    p_actor_user_id, p_occurred_at
  )
  ON CONFLICT (property_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    authorization_lineage_id = EXCLUDED.authorization_lineage_id,
    state = EXCLUDED.state,
    capabilities = EXCLUDED.capabilities,
    capability_runtime_profile_versions = EXCLUDED.capability_runtime_profile_versions,
    review_analysis_epoch = EXCLUDED.review_analysis_epoch,
    reply_drafting_epoch = EXCLUDED.reply_drafting_epoch,
    property_trends_epoch = EXCLUDED.property_trends_epoch,
    authorized_source_epoch = EXCLUDED.authorized_source_epoch,
    analysis_start_sequence = EXCLUDED.analysis_start_sequence,
    state_version = EXCLUDED.state_version,
    notice_version = EXCLUDED.notice_version,
    notice_digest = EXCLUDED.notice_digest,
    source_policy_id = EXCLUDED.source_policy_id,
    routing_policy_version = EXCLUDED.routing_policy_version,
    processing_region = EXCLUDED.processing_region,
    provider_deployment_profile_version = EXCLUDED.provider_deployment_profile_version,
    redaction_profile_family = EXCLUDED.redaction_profile_family,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  RETURN inserted_evidence;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "apply_merchant_ai_transition_v1"(
  uuid, integer, integer, varchar, uuid, text, text, text[], jsonb,
  integer, integer, integer, integer, bigint, varchar, varchar, varchar,
  integer, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "merchant_ai_consent_evidence", "merchant_ai_enablement" FROM PUBLIC;
