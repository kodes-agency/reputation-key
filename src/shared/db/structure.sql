--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "drizzle";


--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";


--
-- Name: authorization_execution_permit_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."authorization_execution_permit_state" AS ENUM (
    'admitted',
    'started',
    'completed',
    'fenced'
);


--
-- Name: connection_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."connection_status" AS ENUM (
    'pending',
    'active',
    'degraded',
    'reauth_required',
    'disconnecting',
    'disconnected',
    'failed'
);


--
-- Name: connection_visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."connection_visibility" AS ENUM (
    'private',
    'organization'
);


--
-- Name: credential_revoke_permit_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."credential_revoke_permit_state" AS ENUM (
    'dormant',
    'active',
    'dispatching',
    'consumed_no_revoke',
    'confirmed_not_sent',
    'confirmed_revoked',
    'cleanup_ambiguous',
    'provider_reset_confirmed'
);


--
-- Name: google_content_capability; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."google_content_capability" AS ENUM (
    'property.import_gbp_v2',
    'property.read_gbp_performance',
    'property.connect_gbp',
    'property.publish_reply'
);


--
-- Name: google_credential_source_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."google_credential_source_kind" AS ENUM (
    'refresh',
    'reauth',
    'reconnect'
);


--
-- Name: google_credential_source_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."google_credential_source_state" AS ENUM (
    'registered',
    'provider_started',
    'terminal',
    'provider_outcome_ambiguous',
    'provider_reset_terminal'
);


--
-- Name: google_credential_use_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."google_credential_use_state" AS ENUM (
    'active',
    'cleanup_only',
    'none'
);


--
-- Name: google_import_v2_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."google_import_v2_action" AS ENUM (
    'create',
    'relink'
);


--
-- Name: google_import_v2_item_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."google_import_v2_item_status" AS ENUM (
    'pending',
    'processing',
    'imported',
    'relinked',
    'already_exists',
    'failed',
    'cancelled'
);


--
-- Name: google_import_v2_outcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."google_import_v2_outcome" AS ENUM (
    'imported',
    'relinked',
    'already_exists',
    'active_binding_conflict',
    'stale_binding',
    'reauthentication_required',
    'reconnect_required',
    'authorization_changed',
    'user_cancelled',
    'policy_disabled',
    'organization_suspended',
    'property_suspended',
    'property_deleted',
    'temporarily_unavailable',
    'cleanup_required',
    'internal_error',
    'tenant_profile_invalid'
);


--
-- Name: google_subject_authority_guard_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."google_subject_authority_guard_state" AS ENUM (
    'open',
    'source_active',
    'cleanup_pending',
    'drained',
    'provider_reset_required',
    'ambiguous',
    'provider_reset_terminal'
);


--
-- Name: grant_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."grant_kind" AS ENUM (
    'full_access',
    'manage',
    'respond',
    'view'
);


--
-- Name: grant_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."grant_status" AS ENUM (
    'active',
    'revoked'
);


--
-- Name: inbox_assignment_reason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."inbox_assignment_reason" AS ENUM (
    'claim',
    'assign',
    'reassign',
    'release',
    'eligibility_lost',
    'reopen_restore'
);


--
-- Name: inbox_priority_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."inbox_priority_level" AS ENUM (
    'urgent',
    'high',
    'medium',
    'low'
);


--
-- Name: inbox_source_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."inbox_source_type" AS ENUM (
    'review',
    'feedback'
);


--
-- Name: inbox_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."inbox_status" AS ENUM (
    'open',
    'closed'
);


--
-- Name: participation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."participation_status" AS ENUM (
    'active',
    'inactive',
    'archived'
);


--
-- Name: reply_authorship; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."reply_authorship" AS ENUM (
    'human',
    'ai_assisted'
);


--
-- Name: reply_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."reply_source" AS ENUM (
    'google_sync',
    'internal'
);


--
-- Name: reply_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."reply_status" AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'published',
    'rejected',
    'publish_failed'
);


--
-- Name: responsibility_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."responsibility_kind" AS ENUM (
    'primary',
    'supporting'
);


--
-- Name: review_platform; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."review_platform" AS ENUM (
    'google'
);


--
-- Name: staff_participant_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."staff_participant_status" AS ENUM (
    'active',
    'archived'
);


--
-- Name: advance_review_reply_state_revision_on_delete_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."advance_review_reply_state_revision_on_delete_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD."source" = 'internal' AND EXISTS (
    SELECT 1
    FROM "reviews"
    WHERE "id" = OLD."review_id"
      AND "organization_id" = OLD."organization_id"
  ) THEN
    PERFORM "advance_review_reply_state_revision_v1"(
      OLD."review_id",
      OLD."organization_id"
    );
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: advance_review_reply_state_revision_v1("uuid", character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."advance_review_reply_state_revision_v1"("p_review_id" "uuid", "p_organization_id" character varying) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  changed_rows integer;
BEGIN
  UPDATE "reviews"
  SET "reply_state_revision" = "reply_state_revision" + 1
  WHERE "id" = p_review_id
    AND "organization_id" = p_organization_id
    AND "reply_state_revision" < '9007199254740991'::bigint;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'cannot advance review reply state revision';
  END IF;
END;
$$;


--
-- Name: ai_advisory_lock_key_v1("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."ai_advisory_lock_key_v1"("p_lock_key" "text") RETURNS bigint
    LANGUAGE "sql" IMMUTABLE STRICT
    AS $$
  SELECT hashtextextended(p_lock_key, 0)
$$;


--
-- Name: ai_epoch_millis_v1(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."ai_epoch_millis_v1"("p_timestamp" timestamp with time zone) RETURNS bigint
    LANGUAGE "plpgsql" IMMUTABLE STRICT
    SET "search_path" TO 'pg_catalog'
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
$$;


--
-- Name: ai_property_local_date_v1(timestamp with time zone, "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."ai_property_local_date_v1"("p_reviewed_at" timestamp with time zone, "p_timezone" "text") RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE STRICT
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
DECLARE
  v_epoch_millis bigint;
  v_millisecond_instant timestamp with time zone;
  v_local_date date;
BEGIN
  IF length(p_timezone) NOT BETWEEN 1 AND 64
    OR p_timezone !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
  THEN
    RETURN NULL;
  END IF;
  v_epoch_millis := public.ai_epoch_millis_v1(p_reviewed_at);
  v_millisecond_instant :=
    timestamp with time zone '1970-01-01 00:00:00+00'
    + (v_epoch_millis * interval '1 millisecond');
  v_local_date := (v_millisecond_instant AT TIME ZONE p_timezone)::date;
  IF extract(year FROM v_local_date) NOT BETWEEN 1970 AND 2100 THEN
    RETURN NULL;
  END IF;
  RETURN v_local_date;
EXCEPTION
  WHEN invalid_parameter_value OR numeric_value_out_of_range THEN RETURN NULL;
END;
$_$;


--
-- Name: ai_property_local_midnight_v1("date", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."ai_property_local_midnight_v1"("p_local_date" "date", "p_timezone" "text") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" STABLE STRICT
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
DECLARE
  v_midnight timestamp with time zone;
BEGIN
  IF extract(year FROM p_local_date) NOT BETWEEN 1970 AND 2100
    OR length(p_timezone) NOT BETWEEN 1 AND 64
    OR p_timezone !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
  THEN
    RETURN NULL;
  END IF;
  v_midnight := p_local_date::timestamp AT TIME ZONE p_timezone;
  IF public.ai_property_local_date_v1(v_midnight, p_timezone) <> p_local_date THEN
    RETURN NULL;
  END IF;
  RETURN v_midnight;
EXCEPTION
  WHEN invalid_parameter_value OR numeric_value_out_of_range THEN RETURN NULL;
END;
$_$;


SET default_table_access_method = "heap";

--
-- Name: merchant_ai_consent_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."merchant_ai_consent_evidence" (
    "authorization_lineage_id" "uuid" NOT NULL,
    "state_version" integer NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "transition_kind" "text" NOT NULL,
    "state" "text" NOT NULL,
    "capabilities" "text"[] NOT NULL,
    "capability_runtime_profile_versions" "jsonb" NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "reply_drafting_epoch" integer NOT NULL,
    "property_trends_epoch" integer NOT NULL,
    "authorized_source_epoch" integer NOT NULL,
    "analysis_start_sequence" bigint NOT NULL,
    "notice_version" character varying(100) NOT NULL,
    "notice_digest" character varying(64) NOT NULL,
    "source_policy_id" character varying(150) NOT NULL,
    "routing_policy_version" integer NOT NULL,
    "processing_region" character varying(20) NOT NULL,
    "provider_deployment_profile_version" character varying(100) NOT NULL,
    "redaction_profile_family" character varying(100) NOT NULL,
    "actor_user_id" character varying(255) NOT NULL,
    "reason_code" character varying(64) NOT NULL,
    "idempotency_key" character varying(128) NOT NULL,
    "request_hash" character varying(64) NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "ceremony_id" "uuid",
    CONSTRAINT "merchant_ai_consent_evidence_analysis_sequence_safe" CHECK ((("analysis_start_sequence" >= 0) AND ("analysis_start_sequence" <= '9007199254740991'::bigint))),
    CONSTRAINT "merchant_ai_consent_evidence_capabilities_valid" CHECK (((("state" = 'enabled'::"text") AND (("capabilities" = ARRAY['review_analysis'::"text"]) OR ("capabilities" = ARRAY['reply_drafting'::"text"]) OR ("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) OR ("capabilities" = ARRAY['review_analysis'::"text", 'property_trends'::"text"]) OR ("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]))) OR (("state" = ANY (ARRAY['disabled'::"text", 'revoked'::"text"])) AND ("capabilities" = ARRAY[]::"text"[])))),
    CONSTRAINT "merchant_ai_consent_evidence_contract_valid" CHECK (((((("notice_version")::"text" = 'merchant-ai-notice-2026-08-15.v1'::"text") AND (("notice_digest")::"text" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-08-19.v1'::"text") AND (("notice_digest")::"text" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-09-06.v1'::"text") AND (("notice_digest")::"text" = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-09-08.v1'::"text") AND (("notice_digest")::"text" = 'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-09-09.v1'::"text") AND (("notice_digest")::"text" = 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-09-15.v1'::"text") AND (("notice_digest")::"text" = '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-10-17.v1'::"text") AND (("notice_digest")::"text" = '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-10-30.v1'::"text") AND (("notice_digest")::"text" = 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-11-01.v1'::"text") AND (("notice_digest")::"text" = 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-11-06.v1'::"text") AND (("notice_digest")::"text" = 'eb810fedbb445bf9361d03280cfa44f31c3a8a8563a905549c3a7bdaed1a88f3'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-11-06.v2'::"text") AND (("notice_digest")::"text" = 'ede9faf088b4ce52da16d194639e780ab05b0349ac896f129f05fb185f53a5f7'::"text"))) AND (("source_policy_id")::"text" = 'google-business-profile-source-policy-v1'::"text") AND ("routing_policy_version" = 1) AND (("redaction_profile_family")::"text" = 'gbp-review-global-v1'::"text"))),
    CONSTRAINT "merchant_ai_consent_evidence_notice_digest_valid" CHECK ((("notice_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "merchant_ai_consent_evidence_profile_valid" CHECK ((("provider_deployment_profile_version")::"text" = ANY (ARRAY['private-beta-global-v1'::"text", 'private-beta-global-v2'::"text", 'private-beta-global-v3'::"text"]))),
    CONSTRAINT "merchant_ai_consent_evidence_reason_valid" CHECK ((("reason_code")::"text" ~ '^[a-z][a-z0-9_]{2,63}$'::"text")),
    CONSTRAINT "merchant_ai_consent_evidence_region_valid" CHECK ((("processing_region")::"text" = 'global'::"text")),
    CONSTRAINT "merchant_ai_consent_evidence_request_hash_valid" CHECK ((("request_hash")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "merchant_ai_consent_evidence_runtime_map_valid" CHECK (((("capabilities" = ARRAY[]::"text"[]) AND ("capability_runtime_profile_versions" = '{}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text"]) AND ("capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text"]) AND ("capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")))),
    CONSTRAINT "merchant_ai_consent_evidence_state_valid" CHECK (("state" = ANY (ARRAY['disabled'::"text", 'enabled'::"text", 'revoked'::"text"]))),
    CONSTRAINT "merchant_ai_consent_evidence_transition_valid" CHECK (("transition_kind" = ANY (ARRAY['enable'::"text", 'change'::"text", 'revoke'::"text", 'restore_reset'::"text", 'analysis_backfill'::"text"]))),
    CONSTRAINT "merchant_ai_consent_evidence_versions_valid" CHECK ((("state_version" >= 1) AND ("review_analysis_epoch" >= 1) AND ("reply_drafting_epoch" >= 1) AND ("property_trends_epoch" >= 1) AND ("authorized_source_epoch" >= 0) AND ("analysis_start_sequence" >= 0) AND ("routing_policy_version" >= 1)))
);


--
-- Name: apply_merchant_ai_transition_v1("uuid", integer, integer, character varying, "uuid", "text", "text", "text"[], "jsonb", integer, integer, integer, integer, bigint, character varying, character varying, character varying, integer, character varying, character varying, character varying, character varying, character varying, character varying, character varying, timestamp with time zone, "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."apply_merchant_ai_transition_v1"("p_authorization_lineage_id" "uuid", "p_expected_state_version" integer, "p_state_version" integer, "p_organization_id" character varying, "p_property_id" "uuid", "p_transition_kind" "text", "p_state" "text", "p_capabilities" "text"[], "p_runtime_profiles" "jsonb", "p_review_analysis_epoch" integer, "p_reply_drafting_epoch" integer, "p_property_trends_epoch" integer, "p_authorized_source_epoch" integer, "p_analysis_start_sequence" bigint, "p_notice_version" character varying, "p_notice_digest" character varying, "p_source_policy_id" character varying, "p_routing_policy_version" integer, "p_processing_region" character varying, "p_provider_deployment_profile_version" character varying, "p_redaction_profile_family" character varying, "p_actor_user_id" character varying, "p_reason_code" character varying, "p_idempotency_key" character varying, "p_request_hash" character varying, "p_occurred_at" timestamp with time zone, "p_ceremony_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."merchant_ai_consent_evidence"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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
  review_head_sequence bigint;
  head_found boolean;
  materially_changed text[];
  data_use_policy_changed boolean;
  reset_analysis_watermark boolean;
  expected_review_analysis_epoch integer;
  expected_reply_drafting_epoch integer;
  expected_property_trends_epoch integer;
BEGIN
  IF p_expected_state_version < 0
    OR p_occurred_at IS NULL
    OR p_authorized_source_epoch < 0
    OR p_analysis_start_sequence < 0
    OR p_analysis_start_sequence > 9007199254740991
  THEN
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
    OR (
      p_transition_kind <> 'revoke'
      AND property_source_epoch <> p_authorized_source_epoch
    )
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
      OR p_analysis_start_sequence <> 0
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
          OR current_head.authorized_source_epoch <> p_authorized_source_epoch
          OR current_head.analysis_start_sequence <> p_analysis_start_sequence
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

  IF p_transition_kind IN ('enable', 'change') THEN
    SELECT head_sequence INTO review_head_sequence
    FROM review_ai_analysis_heads
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_authorized_source_epoch
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'merchant_ai_review_head_unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT head_found OR p_transition_kind = 'restore_reset' THEN
    expected_review_analysis_epoch := 1;
    expected_reply_drafting_epoch := 1;
    expected_property_trends_epoch := 1;
  ELSIF p_transition_kind = 'enable' THEN
    expected_review_analysis_epoch := current_head.review_analysis_epoch + 1;
    expected_reply_drafting_epoch := current_head.reply_drafting_epoch + 1;
    expected_property_trends_epoch := current_head.property_trends_epoch + 1;
  ELSIF p_transition_kind = 'revoke' THEN
    expected_review_analysis_epoch := current_head.review_analysis_epoch + 1;
    expected_reply_drafting_epoch := current_head.reply_drafting_epoch + 1;
    expected_property_trends_epoch := current_head.property_trends_epoch + 1;
  ELSE
    data_use_policy_changed :=
      current_head.source_policy_id <> p_source_policy_id
      OR current_head.routing_policy_version <> p_routing_policy_version
      OR current_head.redaction_profile_family <> p_redaction_profile_family;
    materially_changed := merchant_ai_notice_material_changes_v1(
      current_head.notice_version, current_head.notice_digest, p_notice_version, p_notice_digest
    );
    expected_review_analysis_epoch := current_head.review_analysis_epoch + CASE
      WHEN (
        (
          ('review_analysis' = ANY(current_head.capabilities))
          <> ('review_analysis' = ANY(p_capabilities))
        )
        OR (
          (
            current_head.authorized_source_epoch <> p_authorized_source_epoch
            OR data_use_policy_changed
            OR 'review_analysis' = ANY(materially_changed)
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
            OR data_use_policy_changed
            OR 'reply_drafting' = ANY(materially_changed)
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
            OR data_use_policy_changed
            OR 'property_trends' = ANY(materially_changed)
          )
          AND (
            'property_trends' = ANY(current_head.capabilities)
            OR 'property_trends' = ANY(p_capabilities)
          )
        )
      ) THEN 1 ELSE 0
    END;

  END IF;

  IF p_transition_kind IN ('enable', 'change') THEN
    reset_analysis_watermark :=
      'review_analysis' = ANY(p_capabilities)
      AND expected_review_analysis_epoch
        > COALESCE(current_head.review_analysis_epoch, 0);
    IF reset_analysis_watermark THEN
      IF p_analysis_start_sequence <> review_head_sequence THEN
        RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
      END IF;
    ELSIF p_analysis_start_sequence
      <> COALESCE(current_head.analysis_start_sequence, 0)
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_review_analysis_epoch <> expected_review_analysis_epoch
    OR p_reply_drafting_epoch <> expected_reply_drafting_epoch
    OR p_property_trends_epoch <> expected_property_trends_epoch
  THEN
    RAISE EXCEPTION 'merchant_ai_invalid_capability_epoch' USING ERRCODE = 'P0001';
  END IF;

  IF p_transition_kind = 'change' THEN
    -- A technical refresh alone never writes consent evidence.
    IF current_head.notice_version = p_notice_version
      AND current_head.notice_digest = p_notice_digest
      AND current_head.capabilities = p_capabilities
      AND current_head.authorized_source_epoch = p_authorized_source_epoch
      AND current_head.source_policy_id = p_source_policy_id
      AND current_head.routing_policy_version = p_routing_policy_version
      AND current_head.redaction_profile_family = p_redaction_profile_family
    THEN
      RAISE EXCEPTION 'merchant_ai_no_op' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM set_config('repkey.merchant_ai_transition', '1', true);
  INSERT INTO merchant_ai_consent_evidence (
    authorization_lineage_id, state_version, organization_id, property_id,
    transition_kind, state, capabilities, capability_runtime_profile_versions,
    review_analysis_epoch, reply_drafting_epoch, property_trends_epoch,
    authorized_source_epoch, analysis_start_sequence, notice_version, notice_digest,
    source_policy_id, routing_policy_version, processing_region,
    provider_deployment_profile_version, redaction_profile_family,
    actor_user_id, reason_code, idempotency_key, request_hash, occurred_at,
    ceremony_id
  ) VALUES (
    p_authorization_lineage_id, p_state_version, p_organization_id, p_property_id,
    p_transition_kind, p_state, p_capabilities, p_runtime_profiles,
    p_review_analysis_epoch, p_reply_drafting_epoch, p_property_trends_epoch,
    p_authorized_source_epoch, p_analysis_start_sequence, p_notice_version,
    p_notice_digest, p_source_policy_id, p_routing_policy_version,
    p_processing_region, p_provider_deployment_profile_version,
    p_redaction_profile_family, p_actor_user_id, p_reason_code,
    p_idempotency_key, p_request_hash, p_occurred_at, p_ceremony_id
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


--
-- Name: bump_permission_version("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."bump_permission_version"("org_id" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF org_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO permission_version (organization_id, version, updated_at)
  VALUES (org_id, 1, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET version = permission_version.version + 1, updated_at = now();
END;
$$;


--
-- Name: complete_google_execution_permit_v1("uuid", "text", "text", integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."complete_google_execution_permit_v1"("p_permit_id" "uuid", "p_authority_revision" "text", "p_outcome" "text", "p_retry_after_ms" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_permit public.authorization_execution_permits%ROWTYPE;
  v_updated integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_outcome NOT IN (
    'success', 'provider_4xx', 'provider_5xx', 'rate_limited',
    'deadline_exceeded', 'transport_error', 'response_too_large',
    'caller_abandoned'
  ) OR (p_retry_after_ms IS NOT NULL AND
    (p_retry_after_ms < 0 OR p_retry_after_ms > 300000)) THEN
    RETURN false;
  END IF;

  SELECT permit.* INTO v_permit
  FROM public.authorization_execution_permits AS permit
  WHERE permit.id = p_permit_id
  FOR UPDATE OF permit;
  IF v_permit.id IS NULL
    OR v_permit.state <> 'started'
    OR public.google_execution_permit_revision_v1(v_permit) <>
      p_authority_revision THEN
    RETURN false;
  END IF;

  IF v_permit.operation_deadline_at IS NULL
    OR v_permit.operation_deadline_at <= v_now THEN
    UPDATE public.authorization_execution_permits AS permit
    SET state = 'fenced',
        fenced_at = v_now,
        correlation_id = 'operation_deadline_elapsed'
    WHERE permit.id = p_permit_id
      AND permit.state = 'started';
    RETURN false;
  END IF;

  UPDATE public.authorization_execution_permits AS permit
  SET state = 'completed',
      completed_at = v_now,
      correlation_id = CASE WHEN p_retry_after_ms IS NULL
        THEN p_outcome
        ELSE p_outcome || ':retry_after_' || p_retry_after_ms::text END
  WHERE permit.id = p_permit_id
    AND permit.state = 'started';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END
$$;


--
-- Name: enforce_inbox_feedback_handling_outcome_append_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."enforce_inbox_feedback_handling_outcome_append_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  completion_transition public.inbox_handling_cycle_transitions%ROWTYPE;
  previous_outcome public.inbox_feedback_handling_outcomes%ROWTYPE;
BEGIN
  SELECT * INTO completion_transition
  FROM public.inbox_handling_cycle_transitions
  WHERE inbox_item_id = NEW.inbox_item_id
    AND state_revision = NEW.completion_state_revision;

  IF NOT FOUND
     OR completion_transition.cycle_number <> NEW.cycle_number
     OR completion_transition.kind <> 'closed'
     OR completion_transition.transition_reason <> 'private_feedback_handled'
     OR completion_transition.transitioned_at <> NEW.completion_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'feedback outcome requires its private_feedback_handled completion transition';
  END IF;

  IF NEW.outcome_revision = 1 THEN
    IF NEW.recorded_at <> NEW.completion_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'initial feedback outcome must be recorded at completion';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO previous_outcome
  FROM public.inbox_feedback_handling_outcomes
  WHERE inbox_item_id = NEW.inbox_item_id
    AND cycle_number = NEW.cycle_number
    AND id = NEW.supersedes_outcome_id
    AND outcome_revision = NEW.supersedes_outcome_revision;

  IF NOT FOUND
     OR NEW.completion_at <> previous_outcome.completion_at
     OR NEW.completion_state_revision <> previous_outcome.completion_state_revision
     OR NEW.deadline_result <> previous_outcome.deadline_result
     OR NEW.recorded_at < previous_outcome.recorded_at
     OR NEW.resulting_command_revision <= previous_outcome.resulting_command_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'feedback outcome correction must preserve and directly supersede completion facts';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_inbox_response_target_exclusion_append_only_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."enforce_inbox_response_target_exclusion_append_only_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (
         SELECT 1 FROM public.inbox_handling_cycle_response_targets
         WHERE inbox_item_id = OLD.inbox_item_id AND cycle_number = OLD.cycle_number
       ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target exclusions are append-only';
END;
$$;


--
-- Name: enforce_inbox_response_target_reminder_terminal_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."enforce_inbox_response_target_reminder_terminal_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (
         SELECT 1 FROM public.inbox_handling_cycle_response_targets
         WHERE inbox_item_id = OLD.inbox_item_id AND cycle_number = OLD.cycle_number
       ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target reminder history is immutable';
  END IF;

  IF NEW.inbox_item_id <> OLD.inbox_item_id
     OR NEW.cycle_number <> OLD.cycle_number
     OR NEW.reminder_kind <> OLD.reminder_kind
     OR NEW.event_id <> OLD.event_id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.target_kind <> OLD.target_kind
     OR NEW.scheduled_for <> OLD.scheduled_for
     OR NEW.created_at <> OLD.created_at
     OR OLD.delivered_at IS NOT NULL
     OR OLD.cancelled_at IS NOT NULL
     OR ((NEW.delivered_at IS NOT NULL)::integer + (NEW.cancelled_at IS NOT NULL)::integer) <> 1
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target reminder cannot be repeated or rewritten';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_inbox_response_target_terminal_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."enforce_inbox_response_target_terminal_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (
         SELECT 1 FROM public.inbox_handling_cycles
         WHERE inbox_item_id = OLD.inbox_item_id AND cycle_number = OLD.cycle_number
       ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target history is immutable';
  END IF;

  IF NEW.inbox_item_id <> OLD.inbox_item_id
     OR NEW.cycle_number <> OLD.cycle_number
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.source_type <> OLD.source_type
     OR NEW.source_id <> OLD.source_id
     OR NEW.source_revision <> OLD.source_revision
     OR NEW.target_kind <> OLD.target_kind
     OR NEW.performance_eligibility <> OLD.performance_eligibility
     OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
     OR NEW.policy_source IS DISTINCT FROM OLD.policy_source
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.start_at IS DISTINCT FROM OLD.start_at
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.created_at <> OLD.created_at
     OR OLD.completion_at IS NOT NULL
     OR NEW.completion_at IS NULL
     OR NEW.result IS NULL
     OR NEW.stop_reason IS NULL
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target snapshot or terminal result cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fail_google_execution_permit_v1("uuid", "text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fail_google_execution_permit_v1"("p_permit_id" "uuid", "p_route_key" "text", "p_route_catalog_version" "text", "p_quota_policy_id" "text", "p_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_code NOT IN ('grant_unavailable', 'grant_expired') THEN
    RETURN false;
  END IF;
  UPDATE public.authorization_execution_permits AS permit
  SET state = 'fenced',
      fenced_at = clock_timestamp(),
      correlation_id = p_code
  WHERE permit.id = p_permit_id
    AND permit.state = 'started'
    AND permit.route_key = p_route_key
    AND permit.route_catalog_version = p_route_catalog_version
    AND permit.quota_policy_id = p_quota_policy_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END
$$;


--
-- Name: fence_google_connector_departure_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fence_google_connector_departure_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_cause text;
  v_event_cause text;
  v_old_is_owner boolean;
  v_new_is_owner boolean;
  v_occurred_at timestamptz := clock_timestamp();
BEGIN
  v_old_is_owner := 'owner' = ANY (
    regexp_split_to_array(COALESCE(OLD."role", ''), '\\s*,\\s*')
  );

  IF TG_OP = 'DELETE' THEN
    v_cause := 'connector_departure_member_removed';
    v_event_cause := 'member_removed';
  ELSE
    v_new_is_owner := 'owner' = ANY (
      regexp_split_to_array(COALESCE(NEW."role", ''), '\\s*,\\s*')
    );
    IF NOT v_old_is_owner OR v_new_is_owner THEN
      RETURN NEW;
    END IF;
    v_cause := 'connector_departure_account_admin_role_lost';
    v_event_cause := 'account_admin_role_lost';
  END IF;

  WITH transitioned AS MATERIALIZED (
    UPDATE public.google_connections AS connection
    SET
      status = 'reauth_required',
      lifecycle_version = connection.lifecycle_version + 1,
      access_version = connection.access_version + 1,
      status_reason = v_cause,
      status_changed_at = v_occurred_at,
      updated_at = v_occurred_at
    WHERE connection.organization_id = OLD."organizationId"
      AND COALESCE(
        connection.credential_authorized_by,
        connection.connected_by
      ) = OLD."userId"
      AND connection.credential_use_state = 'active'
      AND connection.status NOT IN (
        'reauth_required',
        'disconnecting',
        'disconnected'
      )
    RETURNING connection.id, connection.organization_id
  ), facts AS (
    SELECT
      gen_random_uuid() AS event_id,
      transitioned.id AS connection_id,
      transitioned.organization_id
    FROM transitioned
  )
  INSERT INTO public.outbox_events (
    id,
    event_type,
    event_version,
    payload,
    organization_id,
    property_id,
    source_context,
    source_aggregate_id,
    created_at
  )
  SELECT
    facts.event_id,
    'integration.google_account.reauthorization_required',
    1,
    jsonb_build_object(
      'connectionId', facts.connection_id::text,
      'organizationId', facts.organization_id,
      'cause', v_event_cause,
      'occurredAt', to_char(
        v_occurred_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'correlationId', NULL
    ),
    facts.organization_id,
    NULL,
    'integration',
    facts.connection_id::text,
    v_occurred_at
  FROM facts;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: authorization_execution_permits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."authorization_execution_permits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_schema_version" integer DEFAULT 1 NOT NULL,
    "capability" "public"."google_content_capability" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid",
    "connection_id" "uuid",
    "initiator_user_id" character varying(255),
    "operation_key" character varying(128) NOT NULL,
    "route_key" character varying(160) NOT NULL,
    "route_catalog_version" character varying(64) NOT NULL,
    "quota_policy_id" character varying(128) NOT NULL,
    "authorization_vector" "jsonb" NOT NULL,
    "state" "public"."authorization_execution_permit_state" NOT NULL,
    "admitted_at" timestamp with time zone NOT NULL,
    "start_deadline_at" timestamp with time zone NOT NULL,
    "started_at" timestamp with time zone,
    "operation_deadline_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "fenced_at" timestamp with time zone,
    "correlation_id" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "authorization_execution_permits_operation_window_check" CHECK ((("operation_deadline_at" IS NULL) OR (("started_at" IS NOT NULL) AND ("operation_deadline_at" > "started_at")))),
    CONSTRAINT "authorization_execution_permits_start_window_check" CHECK (("start_deadline_at" > "admitted_at")),
    CONSTRAINT "authorization_execution_permits_state_check" CHECK (((("state" = 'admitted'::"public"."authorization_execution_permit_state") AND ("started_at" IS NULL) AND ("operation_deadline_at" IS NULL) AND ("completed_at" IS NULL)) OR (("state" = 'started'::"public"."authorization_execution_permit_state") AND ("started_at" IS NOT NULL) AND ("operation_deadline_at" IS NOT NULL) AND ("completed_at" IS NULL)) OR (("state" = 'completed'::"public"."authorization_execution_permit_state") AND ("started_at" IS NOT NULL) AND ("operation_deadline_at" IS NOT NULL) AND ("completed_at" IS NOT NULL)) OR (("state" = 'fenced'::"public"."authorization_execution_permit_state") AND ("fenced_at" IS NOT NULL))))
);


--
-- Name: google_execution_permit_revision_v1("public"."authorization_execution_permits"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."google_execution_permit_revision_v1"("p_permit" "public"."authorization_execution_permits") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    p_permit.id,
    p_permit.route_key,
    p_permit.capability,
    p_permit.scope_schema_version,
    p_permit.organization_id,
    p_permit.property_id,
    p_permit.connection_id,
    p_permit.initiator_user_id,
    p_permit.operation_key,
    p_permit.route_catalog_version,
    p_permit.quota_policy_id,
    p_permit.authorization_vector,
    p_permit.admitted_at,
    p_permit.start_deadline_at
  )::text, 'UTF8')), 'hex')
$$;


--
-- Name: guard_beta_feedback_triage_revision_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_beta_feedback_triage_revision_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."organization_pseudonym" IS DISTINCT FROM OLD."organization_pseudonym"
     OR NEW."actor_pseudonym" IS DISTINCT FROM OLD."actor_pseudonym"
     OR NEW."feedback_type" IS DISTINCT FROM OLD."feedback_type"
     OR NEW."impact_code" IS DISTINCT FROM OLD."impact_code"
     OR NEW."route_key" IS DISTINCT FROM OLD."route_key"
     OR NEW."viewport" IS DISTINCT FROM OLD."viewport"
     OR NEW."reporter_role" IS DISTINCT FROM OLD."reporter_role"
     OR NEW."attachment_kind" IS DISTINCT FROM OLD."attachment_kind"
     OR NEW."attachment_captured_at" IS DISTINCT FROM OLD."attachment_captured_at"
     OR NEW."attachment_expires_at" IS DISTINCT FROM OLD."attachment_expires_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'beta feedback receipt identity is immutable';
  END IF;

  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'beta feedback triage revision must advance by exactly one';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: guard_goal_monthly_result_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_goal_monthly_result_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  assignment_from timestamptz;
  assignment_to timestamptz;
  version_from timestamptz;
  version_to timestamptz;
  version_timezone varchar(64);
  version_metric varchar(40);
  expected_start timestamptz;
  expected_end timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'goal monthly results cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'closed' THEN
    RAISE EXCEPTION 'closed goal monthly results are immutable; append a revision'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW."target_value" IS DISTINCT FROM OLD."target_value"
    AND (OLD."status" <> 'open' OR clock_timestamp() >= OLD."period_end")
  THEN
    RAISE EXCEPTION 'goal monthly result target is locked once its period ends'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW."target_value" IS NOT NULL
    AND (NEW."status" <> 'open' OR clock_timestamp() >= NEW."period_end")
  THEN
    RAISE EXCEPTION 'goal monthly result target is locked once its period ends'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'open' AND NEW."status" = 'reconciling')
    OR (OLD."status" = 'reconciling' AND NEW."status" = 'closed')
  ) THEN
    RAISE EXCEPTION 'invalid goal monthly result transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  SELECT
    assignment."effective_from",
    assignment."effective_to",
    version."effective_from",
    version."effective_to",
    version."property_timezone",
    version."metric_key"
  INTO
    assignment_from,
    assignment_to,
    version_from,
    version_to,
    version_timezone,
    version_metric
  FROM "goal_subject_assignments" assignment
  JOIN "goal_program_versions" version
    ON version."organization_id" = assignment."organization_id"
   AND version."property_id" = assignment."property_id"
   AND version."program_id" = assignment."program_id"
   AND version."id" = assignment."program_version_id"
  WHERE assignment."organization_id" = NEW."organization_id"
    AND assignment."property_id" = NEW."property_id"
    AND assignment."program_id" = NEW."program_id"
    AND assignment."program_version_id" = NEW."program_version_id"
    AND assignment."id" = NEW."assignment_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal monthly result assignment is unavailable'
      USING ERRCODE = '23503';
  END IF;

  IF NEW."target_value" IS NOT NULL AND NOT (
    (
      version_metric IN ('qualified_scans', 'portal_rating_count')
      AND NEW."target_value" > 0
      AND NEW."target_value" = trunc(NEW."target_value")
    )
    OR (
      version_metric = 'portal_rating_average'
      AND NEW."target_value" BETWEEN 1 AND 5
      AND NEW."target_value" * 10 = trunc(NEW."target_value" * 10)
    )
  ) THEN
    RAISE EXCEPTION 'goal monthly result target breaks its measure rule'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."property_timezone" <> version_timezone THEN
    RAISE EXCEPTION 'goal monthly result timezone does not match its immutable program version'
      USING ERRCODE = '23514';
  END IF;

  expected_start := date_trunc('month', NEW."period_start" AT TIME ZONE version_timezone)
    AT TIME ZONE version_timezone;
  expected_end := (
    date_trunc('month', NEW."period_start" AT TIME ZONE version_timezone) + interval '1 month'
  ) AT TIME ZONE version_timezone;

  IF NEW."period_start" <> expected_start OR NEW."period_end" <> expected_end THEN
    RAISE EXCEPTION 'goal monthly result must cover one complete property-local calendar month'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."period_start" < assignment_from
    OR (assignment_to IS NOT NULL AND NEW."period_end" > assignment_to)
    OR NEW."period_start" < version_from
    OR (version_to IS NOT NULL AND NEW."period_end" > version_to)
  THEN
    RAISE EXCEPTION 'goal monthly result falls outside its assignment or version window'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'reconciling' AND clock_timestamp() < NEW."period_end" THEN
    RAISE EXCEPTION 'goal monthly result cannot reconcile before its period ends'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'closed'
    AND clock_timestamp() < NEW."period_end" + interval '24 hours'
  THEN
    RAISE EXCEPTION 'goal monthly result cannot close before the reconciliation window ends'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: guard_goal_program_transition_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_goal_program_transition_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW."current_version" < OLD."current_version" THEN
    RAISE EXCEPTION 'goal program current_version cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'scheduled' AND NEW."status" IN ('active', 'ended'))
    OR (OLD."status" = 'active' AND NEW."status" IN ('paused', 'ended'))
    OR (OLD."status" = 'paused' AND NEW."status" IN ('active', 'ended'))
  ) THEN
    RAISE EXCEPTION 'invalid goal program transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: guard_last_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_last_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  org_id text;
  remaining_owners int;
BEGIN
  org_id := COALESCE(OLD."organizationId", NEW."organizationId");
  IF org_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Only restrict when the row currently holds the owner token.
  IF string_to_array(COALESCE(OLD."role", ''), ',') @> ARRAY['owner'] THEN
    SELECT count(*) INTO remaining_owners
    FROM member
    WHERE "organizationId" = org_id
      AND id <> OLD.id
      AND string_to_array("role", ',') @> ARRAY['owner'];
    IF remaining_owners = 0 THEN
      RAISE EXCEPTION 'cannot_remove_last_owner: organization % would have no owner', org_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: guard_merchant_ai_enablement_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_merchant_ai_enablement_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
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


--
-- Name: guard_merchant_ai_evidence_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_merchant_ai_evidence_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
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


--
-- Name: guard_operational_action_history_head_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_operational_action_history_head_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History sequence authority rejects %', TG_OP;
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.last_sequence <> OLD.last_sequence + 1
    OR NEW.last_recorded_at IS NULL
    OR (OLD.last_recorded_at IS NOT NULL
      AND NEW.last_recorded_at < OLD.last_recorded_at)
    OR NEW.updated_at IS DISTINCT FROM NEW.last_recorded_at THEN
    RAISE EXCEPTION 'Operational Action History sequence authority rejects UPDATE';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: guard_operational_action_history_hold_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_operational_action_history_hold_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History append-only legal-hold evidence rejects %', TG_OP;
  END IF;

  IF ROW(
    NEW.id,
    NEW.organization_id,
    NEW.reason_code,
    NEW.protects_from,
    NEW.protects_through,
    NEW.placed_at,
    NEW.placed_by_actor_id
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.organization_id,
    OLD.reason_code,
    OLD.protects_from,
    OLD.protects_through,
    OLD.placed_at,
    OLD.placed_by_actor_id
  ) OR NOT (
    (NEW.released_at IS NOT DISTINCT FROM OLD.released_at
      AND NEW.released_by_actor_id IS NOT DISTINCT FROM OLD.released_by_actor_id
      AND NEW.release_reason_code IS NOT DISTINCT FROM OLD.release_reason_code)
    OR (OLD.released_at IS NULL
      AND OLD.released_by_actor_id IS NULL
      AND OLD.release_reason_code IS NULL
      AND NEW.released_at IS NOT NULL
      AND NEW.released_by_actor_id IS NOT NULL
      AND NEW.release_reason_code IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Operational Action History append-only legal-hold evidence rejects UPDATE';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: guard_operational_action_history_record_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_operational_action_history_record_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History append-only core rejects %', TG_OP;
  END IF;

  IF ROW(
    NEW.id,
    NEW.organization_id,
    NEW.sequence,
    NEW.property_id,
    NEW.actor_type,
    NEW.action,
    NEW.outcome,
    NEW.resource_type,
    NEW.reason_code,
    NEW.provenance_kind,
    NEW.provenance_id,
    NEW.source_event_type,
    NEW.source_event_version,
    NEW.source_context,
    NEW.source_aggregate_id,
    NEW.occurred_at,
    NEW.recorded_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.organization_id,
    OLD.sequence,
    OLD.property_id,
    OLD.actor_type,
    OLD.action,
    OLD.outcome,
    OLD.resource_type,
    OLD.reason_code,
    OLD.provenance_kind,
    OLD.provenance_id,
    OLD.source_event_type,
    OLD.source_event_version,
    OLD.source_context,
    OLD.source_aggregate_id,
    OLD.occurred_at,
    OLD.recorded_at
  ) OR NOT (
    (NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
      AND NEW.actor_redacted_at IS NOT DISTINCT FROM OLD.actor_redacted_at)
    OR (OLD.actor_id IS NOT NULL
      AND NEW.actor_id IS NULL
      AND OLD.actor_redacted_at IS NULL
      AND NEW.actor_redacted_at IS NOT NULL)
  ) OR NOT (
    (NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id
      AND NEW.resource_redacted_at IS NOT DISTINCT FROM OLD.resource_redacted_at)
    OR (OLD.resource_id IS NOT NULL
      AND NEW.resource_id IS NULL
      AND OLD.resource_redacted_at IS NULL
      AND NEW.resource_redacted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Operational Action History append-only core rejects UPDATE';
  END IF;

  IF (
    NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
  ) AND EXISTS (
    SELECT 1
    FROM operational_action_history_legal_holds AS hold
    WHERE hold.organization_id = OLD.organization_id
      AND hold.released_at IS NULL
      AND OLD.occurred_at >= hold.protects_from
      AND (hold.protects_through IS NULL OR OLD.occurred_at <= hold.protects_through)
  ) THEN
    RAISE EXCEPTION 'Operational Action History active legal hold rejects redaction';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: guard_organization_export_retrieval_issuance_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_organization_export_retrieval_issuance_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
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
$$;


--
-- Name: guard_organization_export_revision_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_organization_export_revision_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


--
-- Name: guard_organization_lifecycle_revision_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_organization_lifecycle_revision_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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
$$;


--
-- Name: guard_review_lifecycle_recovery_execution_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guard_review_lifecycle_recovery_execution_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery evidence is durable and cannot be removed';
  END IF;

  IF ROW(
    NEW."id",
    NEW."recovery_generation",
    NEW."approval_id",
    NEW."approval_bundle_sha256",
    NEW."approver_identity",
    NEW."approval_key_id",
    NEW."approved_at",
    NEW."expires_at",
    NEW."release_sha",
    NEW."release_manifest_sha256",
    NEW."restore_point_at",
    NEW."restore_database_service_name",
    NEW."railway_project_id",
    NEW."railway_environment_id",
    NEW."evaluated_at",
    NEW."source_policy_version",
    NEW."retention_policy_version",
    NEW."policy_sha256",
    NEW."report_sha256",
    NEW."report_expired",
    NEW."operator_id",
    NEW."correlation_id",
    NEW."started_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."recovery_generation",
    OLD."approval_id",
    OLD."approval_bundle_sha256",
    OLD."approver_identity",
    OLD."approval_key_id",
    OLD."approved_at",
    OLD."expires_at",
    OLD."release_sha",
    OLD."release_manifest_sha256",
    OLD."restore_point_at",
    OLD."restore_database_service_name",
    OLD."railway_project_id",
    OLD."railway_environment_id",
    OLD."evaluated_at",
    OLD."source_policy_version",
    OLD."retention_policy_version",
    OLD."policy_sha256",
    OLD."report_sha256",
    OLD."report_expired",
    OLD."operator_id",
    OLD."correlation_id",
    OLD."started_at"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery approval binding is immutable';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery evidence time cannot move backwards';
  END IF;

  IF OLD."state" = 'applying' AND NEW."state" = 'applying' THEN
    IF NEW."recovery_replayed" IS DISTINCT FROM OLD."recovery_replayed"
       OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
       OR NEW."pages" < OLD."pages"
       OR NEW."scanned" < OLD."scanned"
       OR NEW."rows_redacted" < OLD."rows_redacted"
       OR NEW."legacy_google_replies_reconciled" < OLD."legacy_google_replies_reconciled" THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery applying evidence cannot move backwards';
    END IF;
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled",
      NEW."checkpoint_created_at",
      NEW."checkpoint_review_id"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled",
      OLD."checkpoint_created_at",
      OLD."checkpoint_review_id"
    ) AND (
      NEW."error_code" IS NOT NULL
      OR NEW."pages" <> OLD."pages" + 1
      OR NEW."scanned" <= OLD."scanned"
      OR NEW."scanned" > OLD."scanned" + 100
      OR NEW."rows_redacted" > OLD."rows_redacted" + (NEW."scanned" - OLD."scanned")
      OR NEW."checkpoint_created_at" IS NULL
      OR (
        OLD."checkpoint_created_at" IS NOT NULL
        AND ROW(NEW."checkpoint_created_at", NEW."checkpoint_review_id")
          <= ROW(OLD."checkpoint_created_at", OLD."checkpoint_review_id")
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery page evidence is invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'applying' AND NEW."state" = 'lifecycle_applied' THEN
    IF NEW."recovery_replayed" IS NOT NULL
       OR NEW."completed_at" IS NOT NULL
       OR NEW."error_code" IS NOT NULL
       OR NEW."checkpoint_created_at" IS NOT NULL
       OR NEW."checkpoint_review_id" IS NOT NULL
       OR NEW."scanned" < OLD."scanned"
       OR NEW."scanned" > OLD."scanned" + 100
       OR NEW."rows_redacted" < OLD."rows_redacted"
       OR NEW."rows_redacted" > OLD."rows_redacted" + (NEW."scanned" - OLD."scanned")
       OR NEW."legacy_google_replies_reconciled" < OLD."legacy_google_replies_reconciled"
       OR (
         NEW."scanned" = OLD."scanned"
         AND NEW."pages" <> OLD."pages"
       )
       OR (
         NEW."scanned" > OLD."scanned"
         AND NEW."pages" <> OLD."pages" + 1
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery apply transition is invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'lifecycle_applied' AND NEW."state" = 'lifecycle_applied' THEN
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled",
      NEW."checkpoint_created_at",
      NEW."checkpoint_review_id",
      NEW."recovery_replayed",
      NEW."completed_at"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled",
      OLD."checkpoint_created_at",
      OLD."checkpoint_review_id",
      OLD."recovery_replayed",
      OLD."completed_at"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery applied evidence is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'lifecycle_applied' AND NEW."state" = 'completed' THEN
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled"
    ) OR NEW."recovery_replayed" IS NULL OR NEW."completed_at" IS NULL OR NEW."error_code" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery completion evidence is invalid';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "recovery_runs" AS recovery
      WHERE recovery."id" = NEW."id"
        AND recovery."generation" = NEW."recovery_generation"
        AND recovery."source_release_sha" = NEW."release_sha"
        AND recovery."source_manifest_sha256" = NEW."release_manifest_sha256"
        AND recovery."restore_point_at" = NEW."restore_point_at"
        AND recovery."operator_id" = NEW."operator_id"
        AND recovery."correlation_id" = NEW."correlation_id"
        AND recovery."completed_at" = NEW."completed_at"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Review lifecycle recovery completion has no exact recovery run';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Review lifecycle recovery state may only advance';
END;
$$;


--
-- Name: increment_reply_state_revision(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."increment_reply_state_revision"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  material_change boolean;
  authorship_changed boolean;
  legacy_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."source" = 'google_sync' THEN
      IF NEW."authorship" IS NOT NULL OR NEW."ai_generated" THEN
        RAISE EXCEPTION 'Google reply mirrors cannot claim authorship';
      END IF;
      NEW."authorship" := NULL;
      NEW."ai_generated" := false;
    ELSE
      IF NEW."authorship" IS NULL THEN
        NEW."authorship" := CASE
          WHEN NEW."ai_generated" THEN 'ai_assisted'::"reply_authorship"
          ELSE 'human'::"reply_authorship"
        END;
      ELSE
        NEW."ai_generated" := NEW."authorship" = 'ai_assisted';
      END IF;
      IF NEW."state_revision" <> 1 THEN
        RAISE EXCEPTION 'new Reply state revision must be 1';
      END IF;
      PERFORM "advance_review_reply_state_revision_v1"(
        NEW."review_id",
        NEW."organization_id"
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."review_id" IS DISTINCT FROM OLD."review_id"
    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."source" IS DISTINCT FROM OLD."source"
  THEN
    RAISE EXCEPTION 'Reply ownership and source are immutable';
  END IF;

  IF NEW."source" = 'google_sync' THEN
    IF NEW."authorship" IS NOT NULL OR NEW."ai_generated" THEN
      RAISE EXCEPTION 'Google reply mirrors cannot claim authorship';
    END IF;
    NEW."authorship" := NULL;
    NEW."ai_generated" := false;
  ELSE
    authorship_changed := NEW."authorship" IS DISTINCT FROM OLD."authorship";
    legacy_changed := NEW."ai_generated" IS DISTINCT FROM OLD."ai_generated";

    IF authorship_changed AND legacy_changed THEN
      IF NEW."authorship" IS NULL
        OR NEW."ai_generated" IS DISTINCT FROM
          (NEW."authorship" = 'ai_assisted')
      THEN
        RAISE EXCEPTION 'contradictory Reply authorship fields';
      END IF;
    ELSIF authorship_changed THEN
      IF NEW."authorship" IS NULL THEN
        RAISE EXCEPTION 'internal Reply authorship is required';
      END IF;
      NEW."ai_generated" := NEW."authorship" = 'ai_assisted';
    ELSIF legacy_changed THEN
      NEW."authorship" := CASE
        WHEN NEW."ai_generated" THEN 'ai_assisted'::"reply_authorship"
        ELSE 'human'::"reply_authorship"
      END;
    END IF;

    IF NEW."authorship" IS NULL THEN
      RAISE EXCEPTION 'internal Reply authorship is required';
    END IF;
  END IF;

  IF NEW."authorship" IS DISTINCT FROM 'ai_assisted'::"reply_authorship" THEN
    NEW."origin_operation_id" := NULL;
    NEW."origin_source_epoch" := NULL;
    NEW."origin_source_revision" := NULL;
    NEW."origin_base_reply_state_revision" := NULL;
    NEW."origin_reply_drafting_epoch" := NULL;
    NEW."origin_property_profile_version" := NULL;
    NEW."origin_ai_profile_version" := NULL;
    NEW."origin_reply_template_id" := NULL;
    NEW."origin_reply_template_catalogue_version" := NULL;
    NEW."origin_reply_template_catalogue_digest" := NULL;
    NEW."origin_concrete_language_tag" := NULL;
    NEW."origin_template_group" := NULL;
    NEW."ai_draft_expires_at" := NULL;
  END IF;

  material_change := NEW."source" = 'internal' AND (
    NEW."text" IS DISTINCT FROM OLD."text"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."authorship" IS DISTINCT FROM OLD."authorship"
    OR NEW."origin_operation_id" IS DISTINCT FROM OLD."origin_operation_id"
    OR NEW."origin_source_epoch" IS DISTINCT FROM OLD."origin_source_epoch"
    OR NEW."origin_source_revision" IS DISTINCT FROM OLD."origin_source_revision"
    OR NEW."origin_base_reply_state_revision" IS DISTINCT FROM OLD."origin_base_reply_state_revision"
    OR NEW."origin_reply_drafting_epoch" IS DISTINCT FROM OLD."origin_reply_drafting_epoch"
    OR NEW."origin_property_profile_version" IS DISTINCT FROM OLD."origin_property_profile_version"
    OR NEW."origin_ai_profile_version" IS DISTINCT FROM OLD."origin_ai_profile_version"
    OR NEW."origin_reply_template_id" IS DISTINCT FROM OLD."origin_reply_template_id"
    OR NEW."origin_reply_template_catalogue_version" IS DISTINCT FROM OLD."origin_reply_template_catalogue_version"
    OR NEW."origin_reply_template_catalogue_digest" IS DISTINCT FROM OLD."origin_reply_template_catalogue_digest"
    OR NEW."origin_concrete_language_tag" IS DISTINCT FROM OLD."origin_concrete_language_tag"
    OR NEW."origin_template_group" IS DISTINCT FROM OLD."origin_template_group"
    OR NEW."ai_draft_expires_at" IS DISTINCT FROM OLD."ai_draft_expires_at"
  );

  IF material_change THEN
    IF NEW."state_revision" = OLD."state_revision" THEN
      NEW."state_revision" := OLD."state_revision" + 1;
    ELSIF NEW."state_revision" <> OLD."state_revision" + 1 THEN
      RAISE EXCEPTION 'invalid Reply state revision transition';
    END IF;
    PERFORM "advance_review_reply_state_revision_v1"(
      NEW."review_id",
      NEW."organization_id"
    );
  ELSIF NEW."state_revision" IS DISTINCT FROM OLD."state_revision" THEN
    RAISE EXCEPTION 'Reply state revision changed without a material transition';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: initialize_review_provider_subject_hmac_key_v1("text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."initialize_review_provider_subject_hmac_key_v1"("p_key_version" "text", "p_key_digest" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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
$$;


--
-- Name: invalidate_ai_reply_adoption_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."invalidate_ai_reply_adoption_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  origin_operation_id_value uuid;
  invalidated boolean;
BEGIN
  origin_operation_id_value := OLD."origin_operation_id";
  IF origin_operation_id_value IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  invalidated := TG_OP = 'DELETE';
  IF TG_OP = 'UPDATE' THEN
    invalidated :=
      NEW."text" IS DISTINCT FROM OLD."text"
      OR NEW."authorship" IS DISTINCT FROM OLD."authorship"
      OR NEW."origin_operation_id" IS DISTINCT FROM OLD."origin_operation_id"
      OR NEW."origin_source_epoch" IS DISTINCT FROM OLD."origin_source_epoch"
      OR NEW."origin_source_revision" IS DISTINCT FROM OLD."origin_source_revision"
      OR NEW."origin_base_reply_state_revision" IS DISTINCT FROM OLD."origin_base_reply_state_revision"
      OR NEW."origin_reply_drafting_epoch" IS DISTINCT FROM OLD."origin_reply_drafting_epoch"
      OR NEW."origin_property_profile_version" IS DISTINCT FROM OLD."origin_property_profile_version"
      OR NEW."origin_ai_profile_version" IS DISTINCT FROM OLD."origin_ai_profile_version"
      OR NEW."origin_reply_template_id" IS DISTINCT FROM OLD."origin_reply_template_id"
      OR NEW."origin_reply_template_catalogue_version" IS DISTINCT FROM OLD."origin_reply_template_catalogue_version"
      OR NEW."origin_reply_template_catalogue_digest" IS DISTINCT FROM OLD."origin_reply_template_catalogue_digest"
      OR NEW."origin_concrete_language_tag" IS DISTINCT FROM OLD."origin_concrete_language_tag"
      OR NEW."origin_template_group" IS DISTINCT FROM OLD."origin_template_group"
      OR NEW."ai_draft_expires_at" IS DISTINCT FROM OLD."ai_draft_expires_at";
  END IF;

  IF invalidated THEN
    UPDATE "ai_operations"
    SET
      "reply_adoption_disposition" = 'invalidated',
      "updated_at" = transaction_timestamp()
    WHERE "id" = origin_operation_id_value
      AND "command" = 'reply'
      AND "reply_adoption_disposition" = 'adopted';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: is_current_portal_ai_reply_brand_profile_v1("text", "uuid", integer, "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."is_current_portal_ai_reply_brand_profile_v1"("organization_id_value" "text", "property_id_value" "uuid", "profile_version_value" integer, "display_name_digest_value" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
DECLARE
  profile_row record;
BEGIN
  IF profile_version_value < 1
    OR display_name_digest_value !~ '^[0-9a-f]{64}$'
  THEN
    RETURN false;
  END IF;

  SELECT
    profile."version",
    profile."display_name"
  INTO profile_row
  FROM public."property_portal_brand_profiles" AS profile
  WHERE profile."organization_id" = organization_id_value
    AND profile."property_id" = property_id_value
  FOR SHARE;

  RETURN FOUND
    AND profile_row."version" = profile_version_value
    AND encode(
      sha256(
        convert_to('repkey-ai-reply-brand-display-name-v1', 'UTF8')
        || decode('00', 'hex')
        || convert_to(profile_row."display_name", 'UTF8')
      ),
      'hex'
    ) = display_name_digest_value;
END;
$_$;


--
-- Name: load_google_execution_permit_v1("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."load_google_execution_permit_v1"("p_permit_id" "uuid") RETURNS TABLE("id" "uuid", "capability" "text", "route_key" "text", "route_catalog_version" "text", "quota_policy_id" "text", "authorization_vector" "jsonb", "state" "text", "start_deadline_at" timestamp with time zone, "organization_id" "text", "property_id" "uuid", "connection_id" "uuid", "initiator_user_id" "text", "authority_revision" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  SELECT
    permit.id,
    permit.capability::text,
    permit.route_key::text,
    permit.route_catalog_version::text,
    permit.quota_policy_id::text,
    permit.authorization_vector,
    permit.state::text,
    permit.start_deadline_at,
    permit.organization_id::text,
    permit.property_id,
    permit.connection_id,
    permit.initiator_user_id::text,
    public.google_execution_permit_revision_v1(permit)
  FROM public.authorization_execution_permits AS permit
  WHERE permit.id = p_permit_id
  LIMIT 1
$$;


--
-- Name: lock_review_ai_analysis_head_v1("text", "uuid", integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."lock_review_ai_analysis_head_v1"("p_organization_id" "text", "p_property_id" "uuid", "p_source_epoch" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  property_epoch integer;
  next_sequence bigint;
BEGIN
  SELECT "source_epoch" INTO property_epoch
  FROM public."properties"
  WHERE "organization_id" = p_organization_id
    AND "id" = p_property_id
  FOR NO KEY UPDATE;

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
$$;


--
-- Name: merchant_ai_notice_material_changes_v1(character varying, character varying, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."merchant_ai_notice_material_changes_v1"("p_previous_version" character varying, "p_previous_digest" character varying, "p_next_version" character varying, "p_next_digest" character varying) RETURNS "text"[]
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $$
DECLARE
  cursor_version character varying := p_next_version;
  cursor_digest character varying := p_next_digest;
  prior_version character varying;
  prior_digest character varying;
  changed text[];
  affected text[] := ARRAY[]::text[];
  seen text[] := ARRAY[]::text[];
BEGIN
  WHILE (cursor_version, cursor_digest) IS DISTINCT FROM (p_previous_version, p_previous_digest) LOOP
    IF cursor_version || ':' || cursor_digest = ANY(seen) THEN
      RETURN ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[];
    END IF;
    seen := array_append(seen, cursor_version || ':' || cursor_digest);
    SELECT replaces_version, replaces_digest, materially_changes
      INTO prior_version, prior_digest, changed
    FROM (VALUES
      ('merchant-ai-notice-2026-11-06.v2', 'ede9faf088b4ce52da16d194639e780ab05b0349ac896f129f05fb185f53a5f7',
        'merchant-ai-notice-2026-11-06.v1', 'eb810fedbb445bf9361d03280cfa44f31c3a8a8563a905549c3a7bdaed1a88f3',
        ARRAY['property_trends']::text[]),
      ('merchant-ai-notice-2026-11-06.v1', 'eb810fedbb445bf9361d03280cfa44f31c3a8a8563a905549c3a7bdaed1a88f3',
       'merchant-ai-notice-2026-11-01.v1', 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef',
       ARRAY['review_analysis']::text[]),
      ('merchant-ai-notice-2026-11-01.v1', 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef',
       'merchant-ai-notice-2026-10-30.v1', 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
       ARRAY['reply_drafting']::text[]),
      ('merchant-ai-notice-2026-10-30.v1', 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
       'merchant-ai-notice-2026-10-17.v1', '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
       ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]),
      ('merchant-ai-notice-2026-10-17.v1', '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
       'merchant-ai-notice-2026-09-15.v1', '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
       ARRAY[]::text[])
    ) AS notices(version, digest, replaces_version, replaces_digest, materially_changes)
    WHERE version = cursor_version AND digest = cursor_digest;
    IF NOT FOUND OR prior_version IS NULL OR prior_digest IS NULL THEN
      RETURN ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[];
    END IF;
    affected := affected || changed;
    cursor_version := prior_version;
    cursor_digest := prior_digest;
  END LOOP;
  RETURN ARRAY(SELECT capability
    FROM unnest(ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]) AS capability
    WHERE capability = ANY(affected));
END;
$$;


--
-- Name: normalize_notification_source_content_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."normalize_notification_source_content_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_is_portal boolean;
  v_legacy_rating jsonb;
  v_guest_rating_valid boolean;
BEGIN
  NEW.payload := COALESCE(NEW.payload, '{}'::jsonb);
  v_is_portal := COALESCE(NEW.payload->>'platform' = 'portal', false);

  IF NEW.payload ? 'rating' THEN
    v_legacy_rating := NEW.payload->'rating';
    NEW.payload := NEW.payload - 'rating';
    IF v_is_portal
      AND jsonb_typeof(v_legacy_rating) = 'number'
      AND v_legacy_rating#>>'{}' IN ('1', '2', '3', '4', '5')
    THEN
      NEW.payload := jsonb_set(
        NEW.payload,
        '{guestRating}',
        v_legacy_rating,
        true
      );
    ELSE
      NEW.title := regexp_replace(
        NEW.title,
        '[1-5]-star[[:space:]]+',
        '',
        'g'
      );
      NEW.body := regexp_replace(
        NEW.body,
        '[1-5]-star[[:space:]]+',
        '',
        'g'
      );
      IF NEW.type = 'review.created' THEN
        NEW.body := 'Open it to read the review and reply.';
      END IF;
    END IF;
  END IF;

  v_guest_rating_valid :=
    v_is_portal
    AND NEW.payload ? 'guestRating'
    AND jsonb_typeof(NEW.payload->'guestRating') = 'number'
    AND NEW.payload->>'guestRating' IN ('1', '2', '3', '4', '5');
  IF NEW.payload ? 'guestRating' AND NOT v_guest_rating_valid THEN
    NEW.payload := NEW.payload - 'guestRating';
    NEW.title := regexp_replace(
      NEW.title,
      '[1-5]-star[[:space:]]+',
      '',
      'g'
    );
    NEW.body := regexp_replace(
      NEW.body,
      '[1-5]-star[[:space:]]+',
      '',
      'g'
    );
    IF NEW.type = 'review.created' THEN
      NEW.body := 'Open it to read the review and reply.';
    END IF;
  END IF;

  RETURN NEW;
END
$$;


--
-- Name: protect_review_reply_state_revision_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."protect_review_reply_state_revision_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW."reply_state_revision" IS DISTINCT FROM OLD."reply_state_revision"
    AND (
      pg_trigger_depth() < 2
      OR NEW."reply_state_revision" <> OLD."reply_state_revision" + 1
    )
  THEN
    RAISE EXCEPTION 'review reply state revision is trigger-owned';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: provision_organization_lifecycle_authority_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."provision_organization_lifecycle_authority_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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
$$;


--
-- Name: reject_ai_execution_control_head_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."reject_ai_execution_control_head_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI execution control heads cannot be deleted';
  END IF;
  IF NEW.scope_key <> OLD.scope_key
    OR NEW.scope_kind <> OLD.scope_kind
    OR NEW.scope_value IS DISTINCT FROM OLD.scope_value
    OR NEW.control_id <> OLD.control_id
    OR NEW.generation <> OLD.generation + 1
    OR NEW.updated_at < OLD.updated_at
    OR NOT EXISTS (
      SELECT 1
      FROM public.ai_execution_control_transitions AS transition
      WHERE transition.control_id = NEW.control_id
        AND transition.generation = NEW.generation
        AND transition.predecessor_generation = OLD.generation
        AND transition.scope_key = NEW.scope_key
        AND transition.scope_kind = NEW.scope_kind
        AND transition.scope_value IS NOT DISTINCT FROM NEW.scope_value
        AND transition.execution_state = NEW.execution_state
        AND transition.admission_state = NEW.admission_state
        AND transition.occurred_at = NEW.updated_at
    )
  THEN
    RAISE EXCEPTION 'Invalid AI execution control head transition';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: reject_backup_erasure_ledger_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."reject_backup_erasure_ledger_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = TG_TABLE_NAME || ' is append-only';
END;
$$;


--
-- Name: reject_identity_lifecycle_evidence_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."reject_identity_lifecycle_evidence_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = TG_TABLE_NAME || ' is append-only';
END;
$$;


--
-- Name: reject_organization_lifecycle_event_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."reject_organization_lifecycle_event_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'organization_lifecycle_events is append-only';
END;
$$;


--
-- Name: reject_privacy_request_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."reject_privacy_request_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
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

  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.subject_ref <> OLD.subject_ref
     OR NEW.subject_type <> OLD.subject_type
     OR NEW.request_kind <> OLD.request_kind
     OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'privacy request subject binding is immutable';
  END IF;

  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.state
    WHEN 'received' THEN NEW.state IN ('verified', 'refused')
    WHEN 'verified' THEN NEW.state IN ('in_progress', 'refused')
    WHEN 'in_progress' THEN NEW.state IN ('fulfilled', 'refused')
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'invalid privacy request transition ' || OLD.state || ' -> ' || NEW.state;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: reject_property_erase_authority_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."reject_property_erase_authority_mutation_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
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
$$;


--
-- Name: remove_review_provider_subject_hmac_key_v1("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."remove_review_provider_subject_hmac_key_v1"("p_expected_retiring_version" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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
$$;


--
-- Name: retire_guest_contact_on_response_terminal_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."retire_guest_contact_on_response_terminal_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  retired_at timestamp with time zone := COALESCE(
    NEW."feedback_withdrawn_at",
    NEW."deleted_at",
    NEW."updated_at",
    CURRENT_TIMESTAMP
  );
BEGIN
  IF NEW."status" = 'expired' THEN
    UPDATE "guest_contact_requests"
    SET "status" = 'expired',
        "consent_granted" = false,
        "encrypted_contact" = NULL,
        "withdrawn_at" = NULL,
        "purged_at" = retired_at,
        "updated_at" = retired_at
    WHERE "organization_id" = NEW."organization_id"
      AND "property_id" = NEW."property_id"
      AND "portal_id" = NEW."portal_id"
      AND "response_id" = NEW."id"
      AND "status" = 'active';
  ELSIF NEW."status" = 'deleted'
    OR NEW."deleted_at" IS NOT NULL
    OR (
      OLD."feedback_withdrawn_at" IS NULL
      AND NEW."feedback_withdrawn_at" IS NOT NULL
    ) THEN
    UPDATE "guest_contact_requests"
    SET "status" = 'withdrawn',
        "consent_granted" = false,
        "encrypted_contact" = NULL,
        "withdrawn_at" = retired_at,
        "purged_at" = NULL,
        "updated_at" = retired_at
    WHERE "organization_id" = NEW."organization_id"
      AND "property_id" = NEW."property_id"
      AND "portal_id" = NEW."portal_id"
      AND "response_id" = NEW."id"
      AND "status" = 'active';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: review_provider_subject_hmac_key_inventory_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."review_provider_subject_hmac_key_inventory_v1"() RETURNS TABLE("key_version" "text", "key_digest" "text", "state" "text", "generation" bigint, "reference_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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
$$;


--
-- Name: rotate_review_provider_subject_hmac_key_v1("text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."rotate_review_provider_subject_hmac_key_v1"("p_expected_active_version" "text", "p_expected_trusted_next_version" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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
$$;


--
-- Name: single_us_beta_supported_country_v3("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."single_us_beta_supported_country_v3"("country_value" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT upper(country_value) = ANY (ARRAY[
    'AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS', 'AT',
    'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI',
    'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ',
    'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO',
    'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO',
    'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM',
    'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM',
    'GN', 'GP', 'GQ', 'GR', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT',
    'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE',
    'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW',
    'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV',
    'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN',
    'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
    'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
    'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PR', 'PS', 'PT',
    'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD',
    'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
    'ST', 'SV', 'SX', 'SY', 'SZ', 'TA', 'TC', 'TD', 'TG', 'TH', 'TJ', 'TK',
    'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US',
    'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'XK',
    'YE', 'YT', 'ZA', 'ZM', 'ZW'
  ]::text[])
$$;


--
-- Name: start_google_execution_permit("uuid", "text", "text", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."start_google_execution_permit"("p_permit_id" "uuid", "p_route_key" "text", "p_route_catalog_version" "text", "p_quota_policy_id" "text", "p_authorization_vector" "jsonb") RETURNS TABLE("outcome" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation_deadline_at timestamptz := v_now + interval '30 seconds';
BEGIN
  IF p_route_key = 'oauth.revoke' AND EXISTS (
    SELECT 1
    FROM public.idempotency_receipts AS attempt
    WHERE attempt.scope = 'google_disconnect_revoke'
      AND attempt.payload->>'cleanupWorkPermitId' = p_permit_id::text
  ) THEN

  RETURN QUERY
  WITH candidate AS MATERIALIZED (
    SELECT permit.*,
      CASE
        WHEN permit.state <> 'admitted' THEN 'changed'
        WHEN permit.start_deadline_at <= v_now THEN 'expired'
        WHEN permit.capability::text = 'property.import_gbp_v2'
          AND permit.property_id IS NULL
          AND permit.connection_id IS NOT NULL
          AND permit.initiator_user_id IS NOT NULL
          AND permit.operation_key = 'provider.oauth.revoke'
          AND permit.route_key = 'oauth.revoke'
          AND EXISTS (
            SELECT 1
            FROM public.idempotency_receipts AS attempt
            INNER JOIN public.google_connections AS connection
              ON connection.organization_id = attempt.payload->>'organizationId'
             AND connection.id::text = attempt.payload->>'connectionId'
            WHERE attempt.scope = 'google_disconnect_revoke'
              AND attempt.payload->>'cleanupWorkPermitId' = permit.id::text
              AND attempt.payload->>'organizationId' = permit.organization_id
              AND attempt.payload->>'connectionId' = permit.connection_id::text
              AND attempt.payload->>'initiatorUserId' = permit.initiator_user_id
              AND attempt.payload->>'state' = 'dispatching'
              AND (attempt.payload->>'cleanupDeadlineAt')::timestamptz > v_now
              AND attempt.payload->>'dispatchingAt' IS NOT NULL
              AND attempt.payload->>'terminalAt' IS NULL
              AND attempt.payload->>'credentialBinding' IS NULL
              AND permit.admitted_at <=
                (attempt.payload->>'dispatchingAt')::timestamptz
              AND connection.status = 'disconnecting'
              AND connection.credential_use_state = 'cleanup_only'
              AND connection.cleanup_material_deadline_at =
                (attempt.payload->>'cleanupDeadlineAt')::timestamptz
              AND connection.lifecycle_version =
                (attempt.payload->>'expectedLifecycleVersion')::bigint + 1
              AND connection.access_version =
                (attempt.payload->>'expectedAccessVersion')::bigint
              AND connection.credential_generation =
                (attempt.payload->>'expectedCredentialGeneration')::bigint
              AND permit.authorization_vector->>'connectionLifecycleVersion' =
                attempt.payload->>'expectedLifecycleVersion'
              AND permit.authorization_vector->>'connectionAccessVersion' =
                attempt.payload->>'expectedAccessVersion'
              AND permit.authorization_vector->>'credentialGeneration' =
                attempt.payload->>'expectedCredentialGeneration'
          ) THEN 'started'
        ELSE 'changed'
      END AS admission_outcome
    FROM public.authorization_execution_permits AS permit
    WHERE permit.id = p_permit_id
    FOR UPDATE OF permit
  ), transition AS (
    UPDATE public.authorization_execution_permits AS permit
    SET state = CASE WHEN candidate.admission_outcome = 'started'
          THEN 'started'::public.authorization_execution_permit_state
          ELSE 'fenced'::public.authorization_execution_permit_state END,
        started_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN v_now ELSE permit.started_at END,
        operation_deadline_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN v_operation_deadline_at ELSE permit.operation_deadline_at END,
        fenced_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN permit.fenced_at ELSE v_now END,
        correlation_id = CASE
          WHEN candidate.admission_outcome = 'started' THEN permit.correlation_id
          WHEN candidate.admission_outcome = 'expired' THEN 'start_deadline_elapsed'
          ELSE 'authorization_changed' END
    FROM candidate
    WHERE permit.id = candidate.id
      AND candidate.state = 'admitted'
      AND candidate.route_key = p_route_key
      AND candidate.route_catalog_version = p_route_catalog_version
      AND candidate.quota_policy_id = p_quota_policy_id
      AND jsonb_typeof(p_authorization_vector) = 'object'
      AND (SELECT count(*) FROM jsonb_object_keys(p_authorization_vector)) = 5
      AND p_authorization_vector ?& ARRAY[
        'requestBindingSha256',
        'credentialBinding',
        'projectFingerprint',
        'requestBodySha256',
        'requestBodyBytes'
      ]::text[]
      AND p_authorization_vector->>'requestBindingSha256' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'credentialBinding' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'projectFingerprint' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'requestBodySha256' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(p_authorization_vector->'requestBodyBytes') = 'number'
      AND p_authorization_vector->>'requestBodyBytes' ~ '^[1-9][0-9]*$'
      AND candidate.authorization_vector @> p_authorization_vector
    RETURNING candidate.admission_outcome
  )
  SELECT transition.admission_outcome FROM transition
  UNION ALL
  SELECT CASE WHEN candidate.start_deadline_at <= v_now
    THEN 'expired' ELSE 'changed' END
  FROM candidate
  WHERE NOT EXISTS (SELECT 1 FROM transition)
  LIMIT 1;
    RETURN;
  END IF;

  IF p_route_key = 'oauth.token.exchange' THEN
  RETURN QUERY
  WITH candidate AS MATERIALIZED (
    SELECT permit.*,
      CASE
        WHEN permit.state <> 'admitted' THEN 'changed'
        WHEN permit.start_deadline_at <= v_now THEN 'expired'
        WHEN permit.capability::text = 'property.import_gbp_v2'
          AND permit.property_id IS NULL
          AND permit.connection_id IS NOT NULL
          AND permit.initiator_user_id IS NOT NULL
          AND permit.operation_key = 'provider.oauth.token.exchange'
          AND permit.route_key = 'oauth.token.exchange'
          AND EXISTS (
            SELECT 1
            FROM public.member AS member
            INNER JOIN public.permission_version AS permission
              ON permission.organization_id = permit.organization_id
            LEFT JOIN public.google_connections AS connection
              ON connection.organization_id = permit.organization_id
             AND connection.id = permit.connection_id
            WHERE member."organizationId" = permit.organization_id
              AND member."userId" = permit.initiator_user_id
              AND member.role = 'owner'
              AND permit.authorization_vector->>'principalKind' = 'user'
              AND permit.authorization_vector->>'role' = 'AccountAdmin'
              AND permit.authorization_vector->>'permissionDigest' ~ '^[a-f0-9]{64}$'
              AND jsonb_typeof(
                permit.authorization_vector->'permissionVersion'
              ) = 'number'
              AND permit.authorization_vector->>'permissionVersion' ~
                '^(0|[1-9][0-9]*)$'
              AND permission.version::text =
                permit.authorization_vector->>'permissionVersion'
              AND (
                (
                  permit.authorization_vector->>'oauthCredentialOperation' =
                    'exchange_new'
                  AND connection.id IS NULL
                  AND permit.authorization_vector->'connectionLifecycleVersion' =
                    '0'::jsonb
                  AND permit.authorization_vector->'connectionAccessVersion' =
                    '0'::jsonb
                  AND permit.authorization_vector->'credentialGeneration' =
                    '0'::jsonb
                )
                OR (
                  permit.authorization_vector->>'oauthCredentialOperation' =
                    'exchange_existing'
                  AND connection.id IS NOT NULL
                  AND connection.status::text IN (
                    'active', 'degraded', 'reauth_required', 'disconnected'
                  )
                  AND connection.credential_use_state::text IN ('active', 'none')
                  AND connection.status::text =
                    permit.authorization_vector->>'connectionStatus'
                  AND connection.credential_use_state::text =
                    permit.authorization_vector->>'credentialUseState'
                  AND connection.lifecycle_version::text =
                    permit.authorization_vector->>'connectionLifecycleVersion'
                  AND connection.access_version::text =
                    permit.authorization_vector->>'connectionAccessVersion'
                  AND connection.credential_generation::text =
                    permit.authorization_vector->>'credentialGeneration'
                )
              )
          ) THEN 'started'
        ELSE 'changed'
      END AS admission_outcome
    FROM public.authorization_execution_permits AS permit
    WHERE permit.id = p_permit_id
    FOR UPDATE OF permit
  ), transition AS (
    UPDATE public.authorization_execution_permits AS permit
    SET state = CASE WHEN candidate.admission_outcome = 'started'
          THEN 'started'::public.authorization_execution_permit_state
          ELSE 'fenced'::public.authorization_execution_permit_state END,
        started_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN v_now ELSE permit.started_at END,
        operation_deadline_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN v_operation_deadline_at ELSE permit.operation_deadline_at END,
        fenced_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN permit.fenced_at ELSE v_now END,
        correlation_id = CASE
          WHEN candidate.admission_outcome = 'started' THEN permit.correlation_id
          WHEN candidate.admission_outcome = 'expired' THEN 'start_deadline_elapsed'
          ELSE 'authorization_changed' END
    FROM candidate
    WHERE permit.id = candidate.id
      AND candidate.state = 'admitted'
      AND candidate.route_key = p_route_key
      AND candidate.route_catalog_version = p_route_catalog_version
      AND candidate.quota_policy_id = p_quota_policy_id
      AND jsonb_typeof(p_authorization_vector) = 'object'
      AND (
        SELECT count(*) FROM jsonb_object_keys(p_authorization_vector)
      ) = 5
      AND p_authorization_vector ?& ARRAY[
        'requestBindingSha256',
        'credentialBinding',
        'projectFingerprint',
        'requestBodySha256',
        'requestBodyBytes'
      ]::text[]
      AND p_authorization_vector->>'requestBindingSha256' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'credentialBinding' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'projectFingerprint' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'requestBodySha256' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(p_authorization_vector->'requestBodyBytes') = 'number'
      AND p_authorization_vector->>'requestBodyBytes' ~ '^[1-9][0-9]*$'
      AND candidate.authorization_vector @> p_authorization_vector
    RETURNING candidate.admission_outcome
  )
  SELECT transition.admission_outcome FROM transition
  UNION ALL
  SELECT CASE WHEN candidate.start_deadline_at <= v_now
    THEN 'expired' ELSE 'changed' END
  FROM candidate
  WHERE NOT EXISTS (SELECT 1 FROM transition)
  LIMIT 1;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS MATERIALIZED (
    SELECT permit.*,
      CASE
        WHEN permit.state <> 'admitted' THEN 'changed'
        WHEN permit.start_deadline_at <= v_now THEN 'expired'
        WHEN (
          permit.route_key <> 'oauth.revoke'
          AND EXISTS (
          SELECT 1
          FROM public.google_connections AS connection
          LEFT JOIN public.member AS member
            ON member."organizationId" = permit.organization_id
           AND member."userId" = permit.initiator_user_id
          LEFT JOIN public.permission_version AS permission
            ON permission.organization_id = permit.organization_id
          WHERE connection.id = permit.connection_id
            AND connection.organization_id = permit.organization_id
            AND (
              (
                permit.capability::text = 'property.import_gbp_v2'
                AND permit.initiator_user_id IS NOT NULL
                AND member.role = 'owner'
                AND permit.authorization_vector->>'principalKind' = 'user'
                AND permit.authorization_vector->>'role' = 'AccountAdmin'
                AND jsonb_typeof(
                  permit.authorization_vector->'permissionVersion'
                ) = 'number'
                AND permit.authorization_vector->>'permissionVersion' ~
                  '^(0|[1-9][0-9]*)$'
                AND permission.version::text =
                  permit.authorization_vector->>'permissionVersion'
              )
              OR (
                permit.capability::text = 'property.read_gbp_performance'
                AND permit.property_id IS NOT NULL
                AND permit.initiator_user_id IS NOT NULL
                AND permit.route_key = 'performance.fetch'
                AND permit.authorization_vector->>'principalKind' = 'user'
                AND (
                  (member.role = 'owner'
                    AND permit.authorization_vector->>'role' = 'AccountAdmin')
                  OR (member.role = 'admin'
                    AND permit.authorization_vector->>'role' = 'PropertyManager')
                )
                AND jsonb_typeof(
                  permit.authorization_vector->'permissionVersion'
                ) = 'number'
                AND permit.authorization_vector->>'permissionVersion' ~
                  '^(0|[1-9][0-9]*)$'
                AND permission.version::text =
                  permit.authorization_vector->>'permissionVersion'
              )
              OR (
                permit.capability::text = 'property.connect_gbp'
                AND permit.property_id IS NOT NULL
                AND permit.initiator_user_id IS NULL
                AND permit.route_key IN ('reviews.list', 'reviews.get')
                AND permit.authorization_vector->>'principalKind' = 'system'
                AND permit.authorization_vector->>'systemPrincipal' =
                  'review-sync-worker-v1'
                AND permit.authorization_vector->>'role' = 'System'
                AND permit.authorization_vector->'permissionVersion' = 'null'::jsonb
                AND permit.authorization_vector->>'permissionDigest' =
                  '65da4b7ff2904448056791e99cea6bcf83adee8507a501d9b22d042d41373899'
              )
              OR (
                -- GBP Pub/Sub notification settings: the notification
                -- principal, on its three routes only. Without this branch every
                -- notification permit was fenced `authorization_changed`.
                permit.capability::text = 'property.connect_gbp'
                AND permit.property_id IS NOT NULL
                AND permit.initiator_user_id IS NULL
                AND permit.route_key IN (
                  'notifications.get',
                  'notifications.subscribe',
                  'notifications.unsubscribe'
                )
                AND permit.authorization_vector->>'principalKind' = 'system'
                AND permit.authorization_vector->>'systemPrincipal' =
                  'notification-management-worker-v1'
                AND permit.authorization_vector->>'role' = 'System'
                AND permit.authorization_vector->'permissionVersion' = 'null'::jsonb
                AND permit.authorization_vector->>'permissionDigest' =
                  '2da8e0be3309dcbdb587386fa35106e8d078e12b0f1c872b17ca67cbf0b9c6f4'
              )
              OR (
                permit.capability::text = 'property.publish_reply'
                AND permit.property_id IS NOT NULL
                AND permit.initiator_user_id IS NULL
                AND permit.route_key = 'reviews.reply'
                AND permit.authorization_vector->>'principalKind' = 'system'
                AND permit.authorization_vector->>'systemPrincipal' =
                  'reply-publication-worker-v1'
                AND permit.authorization_vector->>'role' = 'System'
                AND permit.authorization_vector->'permissionVersion' = 'null'::jsonb
                AND permit.authorization_vector->>'permissionDigest' =
                  '78f5439a163ad5264b40a99b8d1b02d3fe433b47ea838049ae5806d10b8bbfe3'
                AND EXISTS (
                  SELECT 1
                  FROM public.reply_publication_attempts AS publication_attempt
                  INNER JOIN public.reply_publication_authorizations AS publication_authorization
                    ON publication_authorization.organization_id =
                      publication_attempt.organization_id
                   AND publication_authorization.property_id =
                      publication_attempt.property_id
                   AND publication_authorization.review_id =
                      publication_attempt.review_id
                   AND publication_authorization.reply_id =
                      publication_attempt.reply_id
                   AND publication_authorization.publication_cycle =
                      publication_attempt.publication_cycle
                   AND publication_authorization.source_epoch =
                      publication_attempt.source_epoch
                   AND publication_authorization.material_review_revision =
                      publication_attempt.material_review_revision
                   AND publication_authorization.reply_state_revision =
                      publication_attempt.reply_state_revision
                   AND publication_authorization.normalization_version =
                      publication_attempt.normalization_version
                   AND publication_authorization.expected_reply_digest =
                      publication_attempt.expected_reply_digest
                  INNER JOIN public.replies AS publication_reply
                    ON publication_reply.organization_id =
                      publication_attempt.organization_id
                   AND publication_reply.review_id = publication_attempt.review_id
                   AND publication_reply.id = publication_attempt.reply_id
                  INNER JOIN public.reviews AS publication_review
                    ON publication_review.organization_id =
                      publication_attempt.organization_id
                   AND publication_review.property_id =
                      publication_attempt.property_id
                   AND publication_review.id = publication_attempt.review_id
                  INNER JOIN public.member AS confirming_member
                    ON confirming_member."organizationId" =
                      publication_authorization.organization_id
                   AND confirming_member."userId" =
                      publication_authorization.authorized_by_user_id
                  INNER JOIN public.permission_version AS confirming_permission
                    ON confirming_permission.organization_id =
                      publication_authorization.organization_id
                  WHERE publication_attempt.organization_id = permit.organization_id
                    AND publication_attempt.property_id = permit.property_id
                    AND publication_review.google_connection_id = permit.connection_id
                    AND publication_attempt.outcome = 'sending'
                    AND publication_reply.status = 'approved'
                    AND publication_reply.publication_state = 'sending'
                    AND publication_reply.publication_cycle =
                      publication_attempt.publication_cycle
                    AND publication_reply.publication_attempts =
                      publication_attempt.attempt_number
                    AND publication_review.source_content_state = 'active'
                    AND publication_review.source_epoch =
                      publication_attempt.source_epoch
                    AND publication_review.source_revision =
                      publication_attempt.material_review_revision
                    AND permit.authorization_vector->>'reviewId' =
                      publication_attempt.review_id::text
                    AND permit.authorization_vector->>'replyId' =
                      publication_attempt.reply_id::text
                    AND permit.authorization_vector->>'publicationCycle' ~
                      '^[1-9][0-9]*$'
                    AND publication_attempt.publication_cycle::text =
                      permit.authorization_vector->>'publicationCycle'
                    AND permit.authorization_vector->>'publicationAttemptNumber' ~
                      '^[1-9][0-9]*$'
                    AND publication_attempt.attempt_number::text =
                      permit.authorization_vector->>'publicationAttemptNumber'
                    AND permit.authorization_vector->>'materialReviewRevision' ~
                      '^[1-9][0-9]*$'
                    AND publication_attempt.material_review_revision::text =
                      permit.authorization_vector->>'materialReviewRevision'
                    AND permit.authorization_vector->>'replyStateRevision' ~
                      '^[1-9][0-9]*$'
                    AND publication_attempt.reply_state_revision::text =
                      permit.authorization_vector->>'replyStateRevision'
                    AND permit.authorization_vector->>'baseObservationRevision' ~
                      '^(0|[1-9][0-9]*)$'
                    AND publication_attempt.base_observation_revision::text =
                      permit.authorization_vector->>'baseObservationRevision'
                    AND permit.authorization_vector->>'expectedReplyDigest' ~
                      '^[a-f0-9]{64}$'
                    AND publication_attempt.expected_reply_digest =
                      permit.authorization_vector->>'expectedReplyDigest'
                    AND permit.authorization_vector->>'confirmingActorUserId' =
                      publication_authorization.authorized_by_user_id
                    AND permit.authorization_vector->>'confirmingActorRole' = CASE
                      WHEN confirming_member.role = 'owner' THEN 'AccountAdmin'
                      WHEN confirming_member.role = 'admin' THEN 'PropertyManager'
                      ELSE ''
                    END
                    AND permit.authorization_vector->>'confirmingActorPermissionVersion' ~
                      '^(0|[1-9][0-9]*)$'
                    AND confirming_permission.version::text =
                      permit.authorization_vector->>'confirmingActorPermissionVersion'
                    AND (
                      confirming_member.role = 'owner'
                      OR (
                        confirming_member.role = 'admin'
                        AND EXISTS (
                          SELECT 1
                          FROM public.property_access_grant AS confirming_grant
                          WHERE confirming_grant.organization_id = permit.organization_id
                            AND confirming_grant.property_id = permit.property_id
                            AND confirming_grant.user_id =
                              publication_authorization.authorized_by_user_id
                            AND confirming_grant.revoked_at IS NULL
                            AND (
                              confirming_grant.expires_at IS NULL
                              OR confirming_grant.expires_at > v_now
                            )
                        )
                      )
                    )
                )
              )
            )
            AND permit.authorization_vector->>'permissionDigest' ~ '^[a-f0-9]{64}$'
            AND connection.status = 'active'
            AND connection.credential_use_state = 'active'
            AND permit.authorization_vector->>'connectionLifecycleVersion' ~
              '^[1-9][0-9]*$'
            AND connection.lifecycle_version::text =
              permit.authorization_vector->>'connectionLifecycleVersion'
            AND permit.authorization_vector->>'connectionAccessVersion' ~
              '^[1-9][0-9]*$'
            AND connection.access_version::text =
              permit.authorization_vector->>'connectionAccessVersion'
            AND permit.authorization_vector->>'credentialGeneration' ~
              '^[1-9][0-9]*$'
            AND connection.credential_generation::text =
              permit.authorization_vector->>'credentialGeneration'
            AND (
              permit.property_id IS NULL
              OR (
                (
                  member.role = 'owner'
                  OR permit.capability::text = 'property.connect_gbp'
                  OR permit.capability::text = 'property.publish_reply'
                  OR EXISTS (
                    SELECT 1
                    FROM public.property_access_grant AS access_grant
                    WHERE access_grant.organization_id = permit.organization_id
                      AND access_grant.property_id = permit.property_id
                      AND access_grant.user_id = permit.initiator_user_id
                      AND access_grant.revoked_at IS NULL
                      AND (
                        access_grant.expires_at IS NULL
                        OR access_grant.expires_at > v_now
                      )
                  )
                )
                AND EXISTS (
                  SELECT 1
                  FROM public.properties AS property
                  WHERE property.id = permit.property_id
                    AND property.organization_id = permit.organization_id
                    AND property.google_connection_id = permit.connection_id
                    AND property.gbp_location_id IS NOT NULL
                    AND property.deleted_at IS NULL
                    AND property.lifecycle_state = 'active'
                    AND property.google_binding_state = 'active'
                    AND permit.authorization_vector->>'propertySourceEpoch' ~
                      '^(0|[1-9][0-9]*)$'
                    AND property.source_epoch::text =
                      permit.authorization_vector->>'propertySourceEpoch'
                    AND permit.authorization_vector->>'propertyProfileVersion' ~
                      '^[1-9][0-9]*$'
                    AND property.profile_version::text =
                      permit.authorization_vector->>'propertyProfileVersion'
                    AND property.google_binding_state =
                      permit.authorization_vector->>'propertyBindingState'
                    AND property.lifecycle_state =
                      permit.authorization_vector->>'propertyLifecycleState'
                    AND property.profile_source =
                      permit.authorization_vector->>'propertyProfileSource'
                    AND (property.profile_confirmed_at IS NOT NULL)::text =
                      permit.authorization_vector->>'propertyTimezoneConfirmed'
                    AND (
                      permit.capability::text <> 'property.read_gbp_performance'
                      OR (
                        property.profile_source = 'tenant_confirmed'
                        AND property.profile_confirmed_at IS NOT NULL
                      )
                    )
                )
              )
            )
          )
        ) THEN 'started'
        ELSE 'changed'
      END AS admission_outcome
    FROM public.authorization_execution_permits AS permit
    WHERE permit.id = p_permit_id
    FOR UPDATE OF permit
  ), transition AS (
    UPDATE public.authorization_execution_permits AS permit
    SET state = CASE WHEN candidate.admission_outcome = 'started'
        THEN 'started'::public.authorization_execution_permit_state
        ELSE 'fenced'::public.authorization_execution_permit_state END,
      started_at = CASE WHEN candidate.admission_outcome = 'started'
        THEN v_now ELSE permit.started_at END,
      operation_deadline_at = CASE WHEN candidate.admission_outcome = 'started'
        THEN v_operation_deadline_at ELSE permit.operation_deadline_at END,
      fenced_at = CASE WHEN candidate.admission_outcome = 'started'
        THEN permit.fenced_at ELSE v_now END,
      correlation_id = CASE
        WHEN candidate.admission_outcome = 'started' THEN permit.correlation_id
        WHEN candidate.admission_outcome = 'expired' THEN 'start_deadline_elapsed'
        ELSE 'authorization_changed' END
    FROM candidate
    WHERE permit.id = candidate.id
      AND candidate.state = 'admitted'
      AND candidate.route_key = p_route_key
      AND candidate.route_catalog_version = p_route_catalog_version
      AND candidate.quota_policy_id = p_quota_policy_id
      AND jsonb_typeof(p_authorization_vector) = 'object'
      AND (
        SELECT count(*) FROM jsonb_object_keys(p_authorization_vector)
      ) = 5
      AND p_authorization_vector ?& ARRAY[
        'requestBindingSha256',
        'credentialBinding',
        'projectFingerprint',
        'requestBodySha256',
        'requestBodyBytes'
      ]::text[]
      AND p_authorization_vector->>'requestBindingSha256' ~ '^[a-f0-9]{64}$'
      AND (
        p_authorization_vector->>'credentialBinding' = 'none'
        OR p_authorization_vector->>'credentialBinding' ~ '^[a-f0-9]{64}$'
      )
      AND p_authorization_vector->>'projectFingerprint' ~ '^[a-f0-9]{64}$'
      AND (
        p_authorization_vector->'requestBodySha256' = 'null'::jsonb
        OR p_authorization_vector->>'requestBodySha256' ~ '^[a-f0-9]{64}$'
      )
      AND jsonb_typeof(p_authorization_vector->'requestBodyBytes') = 'number'
      AND p_authorization_vector->>'requestBodyBytes' ~ '^(0|[1-9][0-9]*)$'
      AND candidate.authorization_vector @> p_authorization_vector
    RETURNING candidate.admission_outcome
  )
  SELECT transition.admission_outcome FROM transition
  UNION ALL
  SELECT CASE WHEN candidate.start_deadline_at <= v_now
    THEN 'expired' ELSE 'changed' END
  FROM candidate
  WHERE NOT EXISTS (SELECT 1 FROM transition)
  LIMIT 1;
END
$_$;


--
-- Name: tgr_bump_perm_app(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."tgr_bump_perm_app"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_permission_version(NEW.organization_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM bump_permission_version(OLD.organization_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM bump_permission_version(NEW.organization_id);
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      PERFORM bump_permission_version(OLD.organization_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: tgr_bump_perm_ba(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."tgr_bump_perm_ba"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_permission_version(NEW."organizationId");
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM bump_permission_version(OLD."organizationId");
  ELSIF TG_OP = 'UPDATE' THEN
    -- Org transfer bumps both the source and destination org.
    PERFORM bump_permission_version(NEW."organizationId");
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
      PERFORM bump_permission_version(OLD."organizationId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: transition_ai_execution_control_v1("text", "text", "uuid", integer, "text", "text", "text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."transition_ai_execution_control_v1"("p_scope_key" "text", "p_provider_deployment_profile_version" "text", "p_expected_control_id" "uuid", "p_expected_generation" integer, "p_execution_state" "text", "p_admission_state" "text", "p_reason_code" "text", "p_actor_user_id" "text", "p_ticket_reference" "text", "p_candidate_release_sha" "text") RETURNS TABLE("scope_key" character varying, "scope_kind" character varying, "scope_value" character varying, "control_id" "uuid", "generation" integer, "execution_state" character varying, "admission_state" character varying, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
DECLARE
  v_global public.ai_execution_control_heads%ROWTYPE;
  v_provider public.ai_execution_control_heads%ROWTYPE;
  v_target public.ai_execution_control_heads%ROWTYPE;
  v_replay public.ai_execution_control_transitions%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
  v_is_capability_activation boolean;
BEGIN
  IF p_expected_control_id IS NULL
    OR p_expected_generation < 1
    OR p_execution_state NOT IN ('enabled', 'killed')
    OR p_admission_state NOT IN ('accepting', 'draining')
    OR p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$'
    OR p_ticket_reference IS NULL OR length(p_ticket_reference) NOT BETWEEN 1 AND 255
    OR (
      p_candidate_release_sha IS NOT NULL
      AND p_candidate_release_sha !~ '^[0-9a-f]{40}$'
    )
  THEN
    RAISE EXCEPTION 'Invalid AI execution control transition'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_global
  FROM public.ai_execution_control_heads
  WHERE ai_execution_control_heads.scope_key = 'global'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_scope_key = 'global' THEN
    v_target := v_global;
  ELSE
    IF p_provider_deployment_profile_version IS NULL
      OR p_provider_deployment_profile_version !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    THEN
      RETURN;
    END IF;
    SELECT *
    INTO v_provider
    FROM public.ai_execution_control_heads
    WHERE ai_execution_control_heads.scope_key =
      'provider:' || p_provider_deployment_profile_version
    FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    IF p_scope_key = 'provider:' || p_provider_deployment_profile_version THEN
      v_target := v_provider;
    ELSIF p_scope_key IN (
      'capability:review_analysis',
      'capability:reply_drafting',
      'capability:property_trends'
    ) THEN
      SELECT *
      INTO v_target
      FROM public.ai_execution_control_heads
      WHERE ai_execution_control_heads.scope_key = p_scope_key
      FOR UPDATE;
      IF NOT FOUND THEN RETURN; END IF;
    ELSE
      RETURN;
    END IF;
  END IF;

  IF v_target.control_id = p_expected_control_id
    AND v_target.generation = p_expected_generation + 1
  THEN
    SELECT *
    INTO v_replay
    FROM public.ai_execution_control_transitions
    WHERE ai_execution_control_transitions.control_id = v_target.control_id
      AND ai_execution_control_transitions.generation = v_target.generation;
    IF FOUND
      AND v_replay.predecessor_generation = p_expected_generation
      AND v_replay.execution_state = p_execution_state
      AND v_replay.admission_state = p_admission_state
      AND v_replay.reason_code = p_reason_code
      AND v_replay.actor_user_id IS NOT DISTINCT FROM p_actor_user_id
      AND v_replay.ticket_reference = p_ticket_reference
      AND v_replay.candidate_release_sha IS NOT DISTINCT FROM p_candidate_release_sha
    THEN
      scope_key := v_target.scope_key;
      scope_kind := v_target.scope_kind;
      scope_value := v_target.scope_value;
      control_id := v_target.control_id;
      generation := v_target.generation;
      execution_state := v_target.execution_state;
      admission_state := v_target.admission_state;
      updated_at := v_target.updated_at;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF v_target.control_id <> p_expected_control_id
    OR v_target.generation <> p_expected_generation
  THEN
    RETURN;
  END IF;

  v_is_capability_activation :=
    v_target.scope_kind = 'capability'
    AND p_execution_state = 'enabled'
    AND p_admission_state = 'accepting';
  IF v_is_capability_activation THEN
    IF p_candidate_release_sha IS NULL
      OR v_global.execution_state <> 'enabled'
      OR v_global.admission_state <> 'accepting'
      OR v_provider.execution_state <> 'enabled'
      OR v_provider.admission_state <> 'accepting'
    THEN
      RETURN;
    END IF;
  ELSIF p_candidate_release_sha IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.ai_execution_control_transitions (
    control_id, generation, predecessor_generation,
    scope_key, scope_kind, scope_value,
    execution_state, admission_state, reason_code, actor_user_id,
    ticket_reference, candidate_release_sha, occurred_at
  ) VALUES (
    v_target.control_id, v_target.generation + 1, v_target.generation,
    v_target.scope_key, v_target.scope_kind, v_target.scope_value,
    p_execution_state, p_admission_state, p_reason_code, p_actor_user_id,
    p_ticket_reference, p_candidate_release_sha, v_now
  );
  UPDATE public.ai_execution_control_heads
  SET
    generation = v_target.generation + 1,
    execution_state = p_execution_state,
    admission_state = p_admission_state,
    updated_at = v_now
  WHERE ai_execution_control_heads.scope_key = v_target.scope_key;

  scope_key := v_target.scope_key;
  scope_kind := v_target.scope_kind;
  scope_value := v_target.scope_value;
  control_id := v_target.control_id;
  generation := v_target.generation + 1;
  execution_state := p_execution_state;
  admission_state := p_admission_state;
  updated_at := v_now;
  RETURN NEXT;
END;
$_$;


--
-- Name: trust_next_review_provider_subject_hmac_key_v1("text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."trust_next_review_provider_subject_hmac_key_v1"("p_expected_active_version" "text", "p_trusted_next_version" "text", "p_trusted_next_key_digest" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
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
$$;


--
-- Name: validate_goal_result_revision_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."validate_goal_result_revision_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  result_status varchar(24);
  result_period_end timestamptz;
  prior_revision integer;
  prior_result_id uuid;
BEGIN
  SELECT "status", "period_end"
  INTO result_status, result_period_end
  FROM "goal_monthly_results"
  WHERE "organization_id" = NEW."organization_id"
    AND "property_id" = NEW."property_id"
    AND "id" = NEW."monthly_result_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal result revision target is unavailable'
      USING ERRCODE = '23503';
  END IF;
  IF result_status <> 'closed' THEN
    RAISE EXCEPTION 'only closed goal monthly results can be revised'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."source_complete_through" IS NOT NULL
    AND NEW."source_complete_through" > result_period_end
  THEN
    RAISE EXCEPTION 'goal result revision source watermark exceeds the result period'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."evaluation_state" IN ('eligible', 'insufficient_data')
    AND NEW."source_complete_through" IS DISTINCT FROM result_period_end
  THEN
    RAISE EXCEPTION 'eligible goal result revisions require exact source completeness'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" = 1 THEN
    IF NEW."supersedes_revision_id" IS NOT NULL THEN
      RAISE EXCEPTION 'first goal result revision cannot supersede another revision'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."supersedes_revision_id" IS NULL THEN
      RAISE EXCEPTION 'later goal result revisions must supersede the direct prior revision'
        USING ERRCODE = '23514';
    END IF;
    SELECT "revision", "monthly_result_id"
    INTO prior_revision, prior_result_id
    FROM "goal_result_revisions"
    WHERE "id" = NEW."supersedes_revision_id";
    IF NOT FOUND
      OR prior_result_id <> NEW."monthly_result_id"
      OR prior_revision <> NEW."revision" - 1
    THEN
      RAISE EXCEPTION 'goal result revision lineage must target the direct prior revision'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: validate_inbox_response_target_reminder_schedule_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."validate_inbox_response_target_reminder_schedule_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  target_start timestamptz;
  target_due timestamptz;
  target_duration integer;
  target_eligibility varchar(32);
BEGIN
  SELECT start_at, due_at, duration_minutes, performance_eligibility
    INTO target_start, target_due, target_duration, target_eligibility
  FROM public.inbox_handling_cycle_response_targets
  WHERE inbox_item_id = NEW.inbox_item_id
    AND cycle_number = NEW.cycle_number
    AND organization_id = NEW.organization_id
    AND property_id = NEW.property_id
    AND target_kind = NEW.target_kind;

  IF NOT FOUND THEN
    RETURN NEW; -- The composite foreign key provides the canonical error.
  END IF;

  IF target_eligibility <> 'measured'
     OR (NEW.reminder_kind = 'halfway'
         AND NEW.scheduled_for <> target_start + make_interval(secs => target_duration * 30))
     OR (NEW.reminder_kind = 'target_passed' AND NEW.scheduled_for <> target_due) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Response Target reminder schedule does not match its snapshot';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: verify_organization_export_retrieval_issuance_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."verify_organization_export_retrieval_issuance_v1"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
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
$$;


--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE "drizzle"."__drizzle_migrations" (
    "id" integer NOT NULL,
    "hash" "text" NOT NULL,
    "created_at" bigint,
    "is_contract" boolean DEFAULT false NOT NULL
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE "drizzle"."__drizzle_migrations_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE "drizzle"."__drizzle_migrations_id_seq" OWNED BY "drizzle"."__drizzle_migrations"."id";


--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."account" (
    "id" "text" NOT NULL,
    "accountId" "text" NOT NULL,
    "providerId" "text" NOT NULL,
    "userId" "text" NOT NULL,
    "accessToken" "text",
    "refreshToken" "text",
    "idToken" "text",
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    "scope" "text",
    "password" "text",
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: ai_draft_measurement_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_draft_measurement_links" (
    "reply_id" "uuid" NOT NULL,
    "reply_revision" bigint NOT NULL,
    "generation_id" "uuid",
    CONSTRAINT "ai_draft_measurement_links_revision_valid" CHECK ((("reply_revision" >= 1) AND ("reply_revision" <= '9007199254740991'::bigint)))
);


--
-- Name: ai_draft_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_draft_measurements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operation_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "actor_user_id" character varying(255) NOT NULL,
    "request_key" character varying(128) NOT NULL,
    "contract" character varying(2) NOT NULL,
    "intent" character varying(10) NOT NULL,
    "trigger" character varying(10) NOT NULL,
    "tone" character varying(20) NOT NULL,
    "language" character varying(35) NOT NULL,
    "rating_band" character varying(10) NOT NULL,
    "case" character varying(40),
    "provider_attempts" integer NOT NULL,
    "outcome" character varying(10) NOT NULL,
    "refusal_code" character varying(64),
    "latency_ms" integer NOT NULL,
    "base_reply_revision" bigint NOT NULL,
    "draft_pressed" boolean DEFAULT false NOT NULL,
    "try_again_pressed" boolean DEFAULT false NOT NULL,
    "shorter_pressed" boolean DEFAULT false NOT NULL,
    "tone_pressed" boolean DEFAULT false NOT NULL,
    "shown_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    "adopted_at" timestamp with time zone,
    "adopted_reply_id" "uuid",
    "adopted_revision" bigint,
    "submitted_at" timestamp with time zone,
    "submitted_revision" bigint,
    "edit_distance" double precision,
    "edited_before_submit" boolean,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_draft_measurements_bounds" CHECK ((("provider_attempts" >= 1) AND ("provider_attempts" <= 2) AND ("latency_ms" >= 0) AND ("base_reply_revision" >= 0) AND ("base_reply_revision" <= '9007199254740991'::bigint))),
    CONSTRAINT "ai_draft_measurements_contract_valid" CHECK ((("contract")::"text" = ANY (ARRAY['v1'::"text", 'v2'::"text"]))),
    CONSTRAINT "ai_draft_measurements_edit_valid" CHECK ((("edit_distance" IS NULL) OR (("edit_distance" >= (0)::double precision) AND ("edit_distance" <= (1)::double precision)))),
    CONSTRAINT "ai_draft_measurements_intent_valid" CHECK ((("intent")::"text" = ANY (ARRAY['explicit'::"text", 'background'::"text"]))),
    CONSTRAINT "ai_draft_measurements_outcome_valid" CHECK ((("outcome")::"text" = ANY (ARRAY['ready'::"text", 'refused'::"text"]))),
    CONSTRAINT "ai_draft_measurements_trigger_valid" CHECK ((("trigger")::"text" = ANY (ARRAY['draft'::"text", 'try_again'::"text", 'shorter'::"text", 'tone'::"text"])))
);


--
-- Name: ai_execution_control_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_execution_control_heads" (
    "scope_key" character varying(150) NOT NULL,
    "scope_kind" character varying(40) NOT NULL,
    "scope_value" character varying(100),
    "control_id" "uuid" NOT NULL,
    "generation" integer NOT NULL,
    "execution_state" character varying(20) NOT NULL,
    "admission_state" character varying(20) NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_execution_control_heads_generation_valid" CHECK (("generation" >= 1)),
    CONSTRAINT "ai_execution_control_heads_scope_valid" CHECK ((((("scope_kind")::"text" = 'global'::"text") AND (("scope_key")::"text" = 'global'::"text") AND ("scope_value" IS NULL)) OR ((("scope_kind")::"text" = 'provider_deployment_profile'::"text") AND (("scope_value")::"text" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'::"text") AND (("scope_value")::"text" <> ALL ((ARRAY['openai'::character varying, 'anthropic'::character varying])::"text"[])) AND (("scope_key")::"text" = ('provider:'::"text" || ("scope_value")::"text"))) OR ((("scope_kind")::"text" = 'provider'::"text") AND ("scope_value" IS NOT NULL) AND (("scope_value")::"text" = ANY ((ARRAY['openai'::character varying, 'anthropic'::character varying])::"text"[])) AND (("scope_key")::"text" = ('provider:'::"text" || ("scope_value")::"text"))) OR ((("scope_kind")::"text" = 'capability'::"text") AND (("scope_value")::"text" = ANY ((ARRAY['review_analysis'::character varying, 'reply_drafting'::character varying, 'property_trends'::character varying])::"text"[])) AND (("scope_key")::"text" = ('capability:'::"text" || ("scope_value")::"text"))))),
    CONSTRAINT "ai_execution_control_heads_state_valid" CHECK (((("execution_state")::"text" = ANY ((ARRAY['enabled'::character varying, 'killed'::character varying])::"text"[])) AND (("admission_state")::"text" = ANY ((ARRAY['accepting'::character varying, 'draining'::character varying])::"text"[]))))
);


--
-- Name: ai_execution_control_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_execution_control_transitions" (
    "control_id" "uuid" NOT NULL,
    "generation" integer NOT NULL,
    "predecessor_generation" integer,
    "scope_key" character varying(150) NOT NULL,
    "scope_kind" character varying(40) NOT NULL,
    "scope_value" character varying(100),
    "execution_state" character varying(20) NOT NULL,
    "admission_state" character varying(20) NOT NULL,
    "reason_code" character varying(64) NOT NULL,
    "actor_user_id" character varying(255),
    "ticket_reference" character varying(255) NOT NULL,
    "candidate_release_sha" character varying(40),
    "occurred_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_execution_control_transitions_generation_valid" CHECK ((("generation" >= 1) AND ((("generation" = 1) AND ("predecessor_generation" IS NULL)) OR (("generation" > 1) AND ("predecessor_generation" = ("generation" - 1)))))),
    CONSTRAINT "ai_execution_control_transitions_reason_valid" CHECK (((("reason_code")::"text" ~ '^[a-z][a-z0-9_]{2,63}$'::"text") AND (("length"(("ticket_reference")::"text") >= 1) AND ("length"(("ticket_reference")::"text") <= 255)))),
    CONSTRAINT "ai_execution_control_transitions_release_valid" CHECK ((("candidate_release_sha" IS NULL) OR (("candidate_release_sha")::"text" ~ '^[0-9a-f]{40}$'::"text"))),
    CONSTRAINT "ai_execution_control_transitions_scope_valid" CHECK ((((("scope_kind")::"text" = 'global'::"text") AND (("scope_key")::"text" = 'global'::"text") AND ("scope_value" IS NULL)) OR ((("scope_kind")::"text" = 'provider_deployment_profile'::"text") AND (("scope_value")::"text" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'::"text") AND (("scope_value")::"text" <> ALL ((ARRAY['openai'::character varying, 'anthropic'::character varying])::"text"[])) AND (("scope_key")::"text" = ('provider:'::"text" || ("scope_value")::"text"))) OR ((("scope_kind")::"text" = 'provider'::"text") AND ("scope_value" IS NOT NULL) AND (("scope_value")::"text" = ANY ((ARRAY['openai'::character varying, 'anthropic'::character varying])::"text"[])) AND (("scope_key")::"text" = ('provider:'::"text" || ("scope_value")::"text"))) OR ((("scope_kind")::"text" = 'capability'::"text") AND (("scope_value")::"text" = ANY ((ARRAY['review_analysis'::character varying, 'reply_drafting'::character varying, 'property_trends'::character varying])::"text"[])) AND (("scope_key")::"text" = ('capability:'::"text" || ("scope_value")::"text"))))),
    CONSTRAINT "ai_execution_control_transitions_state_valid" CHECK (((("execution_state")::"text" = ANY ((ARRAY['enabled'::character varying, 'killed'::character varying])::"text"[])) AND (("admission_state")::"text" = ANY ((ARRAY['accepting'::character varying, 'draining'::character varying])::"text"[]))))
);


--
-- Name: ai_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_operations" (
    "id" "uuid" NOT NULL,
    "idempotency_scope" character varying(255) NOT NULL,
    "idempotency_key" character varying(128) NOT NULL,
    "request_fingerprint" character varying(64) NOT NULL,
    "source_digest" character varying(64) NOT NULL,
    "source_byte_count" integer NOT NULL,
    "command" character varying(32) NOT NULL,
    "capability" character varying(40) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "actor_user_id" character varying(255),
    "system_principal" character varying(64),
    "review_id" "uuid",
    "origin_event_id" "uuid",
    "subject_hmac" character varying(64),
    "subject_hmac_key_version" character varying(100),
    "source_epoch" integer,
    "source_revision" bigint,
    "reviewed_at_epoch_millis" bigint,
    "analysis_sequence" bigint,
    "tone" character varying(20),
    "base_reply_state_revision" bigint,
    "due_local_date" "date",
    "terminal_analysis_sequence" bigint,
    "aggregate_revision" bigint,
    "authorization_lineage_id" "uuid",
    "notice_version" character varying(100),
    "notice_digest" character varying(64),
    "evaluated_language" character varying(35),
    "concrete_reply_language_tag" character varying(35),
    "concrete_reply_template_group" character varying(64),
    "language_catalogue_digest" character varying(64),
    "reply_language_verifier_digest" character varying(64),
    "language_script_consistency_digest" character varying(64),
    "zh_orthography_verifier_digest" character varying(64),
    "property_profile_version" integer,
    "reply_brand_profile_version" integer,
    "reply_brand_display_name_digest" character varying(64),
    "routing_policy_version" integer,
    "provider_deployment_profile_version" character varying(100) NOT NULL,
    "operation_profile_version" character varying(100) NOT NULL,
    "capability_runtime_profile_version" character varying(100),
    "source_policy_id" character varying(150),
    "source_canonicalizer_digest" character varying(64),
    "redaction_profile_version" character varying(100),
    "output_leakage_profile_version" character varying(100),
    "output_leakage_profile_digest" character varying(64),
    "reply_template_catalogue_version" character varying(100),
    "reply_template_catalogue_digest" character varying(64),
    "global_control_id" "uuid" NOT NULL,
    "global_control_generation" integer NOT NULL,
    "provider_control_id" "uuid" NOT NULL,
    "provider_control_generation" integer NOT NULL,
    "capability_control_id" "uuid" NOT NULL,
    "capability_control_generation" integer NOT NULL,
    "capability_fences" "jsonb" NOT NULL,
    "route_key" character varying(64),
    "execution_permit_id" "uuid",
    "admission_nonce" character varying(64),
    "request_binding_key_id" character varying(64),
    "request_binding_hmac" character varying(43),
    "grant_kid" character varying(32),
    "cost_window_id" "uuid",
    "reserved_micros" bigint DEFAULT 0 NOT NULL,
    "actual_micros" bigint,
    "budget_reserved_at" timestamp with time zone,
    "budget_settled_at" timestamp with time zone,
    "state" character varying(40) NOT NULL,
    "execution_attempt" integer NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "failure_code" character varying(64),
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "delivered_at" timestamp with time zone,
    "reply_adoption_disposition" character varying(20) DEFAULT 'none'::character varying NOT NULL,
    "adopted_reply_revision" bigint,
    "adopted_review_reply_state_revision" bigint,
    "provider_id" character varying(20),
    "provider_model" character varying(100),
    "provider_request_profile_version" character varying(100),
    "provider_request_profile_digest" character varying(64),
    "vocabulary_hint_set_id" character varying(100),
    "vocabulary_hint_set_version" character varying(100),
    "vocabulary_hint_set_digest" character varying(64),
    "normalization_profile_version" character varying(100),
    "normalization_profile_digest" character varying(64),
    "normalization_flags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "dropped_mention_count" integer DEFAULT 0 NOT NULL,
    "reply_drafting_v2" "jsonb",
    "rewrite_parent_operation_id" "uuid",
    CONSTRAINT "ai_operations_attempt_valid" CHECK ((("execution_attempt" >= 0) AND ("expires_at" > "created_at") AND ("updated_at" >= "created_at") AND (("next_attempt_at" IS NULL) OR ("next_attempt_at" >= "updated_at")))),
    CONSTRAINT "ai_operations_branch_valid" CHECK ((((("command")::"text" = 'analysis'::"text") AND (("capability")::"text" = 'review_analysis'::"text") AND ("actor_user_id" IS NULL) AND (("system_principal")::"text" = 'review_event_consumer'::"text") AND ("review_id" IS NOT NULL) AND ("origin_event_id" IS NOT NULL) AND (("subject_hmac")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("subject_hmac_key_version" IS NOT NULL) AND ("source_epoch" >= 0) AND ("source_revision" >= 1) AND ("analysis_sequence" >= 1)) OR ((("command")::"text" = 'reply'::"text") AND (("capability")::"text" = 'reply_drafting'::"text") AND ("actor_user_id" IS NOT NULL) AND ("system_principal" IS NULL) AND ("review_id" IS NOT NULL) AND ("source_epoch" >= 0) AND ("source_revision" >= 1) AND (("tone")::"text" = ANY ((ARRAY['professional'::character varying, 'friendly'::character varying, 'casual'::character varying])::"text"[])) AND ("base_reply_state_revision" >= 0)) OR ((("command")::"text" = 'trend'::"text") AND (("capability")::"text" = 'property_trends'::"text") AND ("actor_user_id" IS NULL) AND (("system_principal")::"text" = 'property_trend_coordinator'::"text") AND ("source_epoch" >= 0) AND ("due_local_date" IS NOT NULL) AND ("terminal_analysis_sequence" >= 0) AND ("aggregate_revision" >= 0)))),
    CONSTRAINT "ai_operations_budget_valid" CHECK (((("reserved_micros" >= 0) AND ("reserved_micros" <= '9007199254740991'::bigint)) AND (("actual_micros" IS NULL) OR (("actual_micros" >= 0) AND ("actual_micros" <= "reserved_micros"))) AND ((("cost_window_id" IS NULL) AND ("reserved_micros" = 0) AND ("budget_reserved_at" IS NULL)) OR (("cost_window_id" IS NOT NULL) AND ("reserved_micros" > 0) AND ("budget_reserved_at" IS NOT NULL))) AND ((("budget_settled_at" IS NULL) AND ("actual_micros" IS NULL)) OR (("budget_settled_at" IS NOT NULL) AND ("actual_micros" IS NOT NULL) AND ("budget_settled_at" >= "budget_reserved_at"))))),
    CONSTRAINT "ai_operations_control_fence_valid" CHECK ((("global_control_generation" >= 1) AND ("provider_control_generation" >= 1) AND ("capability_control_generation" >= 1) AND ("jsonb_typeof"("capability_fences") = 'object'::"text"))),
    CONSTRAINT "ai_operations_fingerprint_valid" CHECK ((("request_fingerprint")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "ai_operations_normalization_lineage_valid" CHECK (((("normalization_profile_version" IS NULL) AND ("normalization_profile_digest" IS NULL) AND ("normalization_flags" = '{}'::"text"[]) AND ("dropped_mention_count" = 0)) OR (("normalization_profile_version" IS NOT NULL) AND ("normalization_profile_digest" IS NOT NULL) AND (("char_length"(("normalization_profile_version")::"text") >= 1) AND ("char_length"(("normalization_profile_version")::"text") <= 100)) AND (("normalization_profile_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("normalization_flags" <@ ARRAY['mentions_capped'::"text", 'sentence_refs_capped'::"text", 'enum_case_repaired'::"text", 'mention_dropped_malformed'::"text", 'mention_dropped_enum'::"text", 'mention_dropped_cause'::"text", 'mention_dropped_sentences'::"text", 'sentence_refs_repaired'::"text", 'cause_refused_name'::"text", 'cause_refused_quotation'::"text", 'cause_refused_shape'::"text", 'names_person_invalid'::"text", 'names_person_raised'::"text", 'mentions_merged'::"text", 'urgent_reason_unknown'::"text"]) AND (("dropped_mention_count" >= 0) AND ("dropped_mention_count" <= 48))))),
    CONSTRAINT "ai_operations_provider_lineage_valid" CHECK (((("provider_id" IS NULL) AND ("provider_model" IS NULL) AND ("provider_request_profile_version" IS NULL) AND ("provider_request_profile_digest" IS NULL)) OR (("provider_id" IS NOT NULL) AND ("provider_model" IS NOT NULL) AND ("provider_request_profile_version" IS NOT NULL) AND ("provider_request_profile_digest" IS NOT NULL) AND (("provider_id")::"text" = ANY ((ARRAY['openai'::character varying, 'anthropic'::character varying])::"text"[])) AND (("char_length"(("provider_model")::"text") >= 1) AND ("char_length"(("provider_model")::"text") <= 100)) AND (("char_length"(("provider_request_profile_version")::"text") >= 1) AND ("char_length"(("provider_request_profile_version")::"text") <= 100)) AND (("provider_request_profile_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")))),
    CONSTRAINT "ai_operations_reply_adoption_valid" CHECK ((((("command")::"text" = 'reply'::"text") AND (("reply_adoption_disposition")::"text" = ANY ((ARRAY['none'::character varying, 'adopted'::character varying, 'invalidated'::character varying])::"text"[])) AND (((("reply_adoption_disposition")::"text" = 'none'::"text") AND ("adopted_reply_revision" IS NULL) AND ("adopted_review_reply_state_revision" IS NULL)) OR ((("reply_adoption_disposition")::"text" = 'adopted'::"text") AND ("adopted_reply_revision" >= 1) AND ("adopted_review_reply_state_revision" >= 1)) OR ((("reply_adoption_disposition")::"text" = 'invalidated'::"text") AND ((("adopted_reply_revision" IS NULL) AND ("adopted_review_reply_state_revision" IS NULL)) OR (("adopted_reply_revision" >= 1) AND ("adopted_review_reply_state_revision" >= 1)))))) OR ((("command")::"text" <> 'reply'::"text") AND (("reply_adoption_disposition")::"text" = 'none'::"text") AND ("adopted_reply_revision" IS NULL) AND ("adopted_review_reply_state_revision" IS NULL)))),
    CONSTRAINT "ai_operations_reply_brand_binding_valid" CHECK ((((("command")::"text" = 'reply'::"text") AND ((("reply_brand_profile_version" IS NULL) AND ("reply_brand_display_name_digest" IS NULL)) OR (("reply_brand_profile_version" >= 1) AND (("reply_brand_display_name_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")))) OR ((("command")::"text" <> 'reply'::"text") AND ("reply_brand_profile_version" IS NULL) AND ("reply_brand_display_name_digest" IS NULL)))),
    CONSTRAINT "ai_operations_reply_v2_valid" CHECK (((((("operation_profile_version")::"text" <> 'reply-suggestion-v2'::"text") AND ("reply_drafting_v2" IS NULL) AND ("rewrite_parent_operation_id" IS NULL)) OR ((("operation_profile_version")::"text" = 'reply-suggestion-v2'::"text") AND ("reply_drafting_v2" IS NOT NULL) AND ("jsonb_typeof"("reply_drafting_v2") = 'object'::"text") AND ("reply_drafting_v2" ?& ARRAY['options'::"text", 'voiceDigest'::"text", 'generationSeed'::"text", 'parentOperationId'::"text", 'rewriteOrdinal'::"text", 'rewriteIssues'::"text"]) AND (("reply_drafting_v2" - ARRAY['options'::"text", 'voiceDigest'::"text", 'generationSeed'::"text", 'parentOperationId'::"text", 'rewriteOrdinal'::"text", 'rewriteIssues'::"text"]) = '{}'::"jsonb") AND ("jsonb_typeof"(("reply_drafting_v2" -> 'options'::"text")) = 'object'::"text") AND (("reply_drafting_v2" -> 'options'::"text") ?& ARRAY['variation'::"text", 'length'::"text", 'opening'::"text", 'apologyStart'::"text"]) AND ((("reply_drafting_v2" -> 'options'::"text") - ARRAY['variation'::"text", 'length'::"text", 'maxWords'::"text", 'opening'::"text", 'apologyStart'::"text"]) = '{}'::"jsonb") AND ("jsonb_typeof"(("reply_drafting_v2" -> 'voiceDigest'::"text")) = 'string'::"text") AND ("jsonb_typeof"(("reply_drafting_v2" -> 'generationSeed'::"text")) = 'string'::"text") AND ("jsonb_typeof"((("reply_drafting_v2" -> 'options'::"text") -> 'apologyStart'::"text")) = 'string'::"text") AND ("jsonb_typeof"((("reply_drafting_v2" -> 'options'::"text") -> 'length'::"text")) = 'string'::"text") AND ("jsonb_typeof"((("reply_drafting_v2" -> 'options'::"text") -> 'variation'::"text")) = 'number'::"text") AND ("jsonb_typeof"((("reply_drafting_v2" -> 'options'::"text") -> 'opening'::"text")) = 'number'::"text") AND ("jsonb_typeof"(("reply_drafting_v2" -> 'rewriteOrdinal'::"text")) = 'number'::"text") AND (("reply_drafting_v2" ->> 'voiceDigest'::"text") ~ '^[0-9a-f]{64}$'::"text") AND (("reply_drafting_v2" ->> 'generationSeed'::"text") ~ '^[0-9a-f]{64}$'::"text") AND ((("reply_drafting_v2" -> 'options'::"text") ->> 'apologyStart'::"text") = ANY (ARRAY['We''re sorry'::"text", 'We''re so sorry'::"text", 'We apologize'::"text", 'We''re truly sorry'::"text", 'Sentimos'::"text", 'Lamentamos'::"text", 'Nos apena'::"text", 'Le pedimos disculpas'::"text", 'Съжаляваме'::"text", 'Искрено съжаляваме'::"text", 'Извиняваме се'::"text", 'Много съжаляваме'::"text"])) AND ((("reply_drafting_v2" -> 'options'::"text") ->> 'length'::"text") = ANY (ARRAY['standard'::"text", 'short'::"text"])) AND ("trunc"(((("reply_drafting_v2" -> 'options'::"text") ->> 'variation'::"text"))::numeric) = ((("reply_drafting_v2" -> 'options'::"text") ->> 'variation'::"text"))::numeric) AND (((("reply_drafting_v2" -> 'options'::"text") ->> 'variation'::"text"))::numeric >= (0)::numeric) AND (((("reply_drafting_v2" -> 'options'::"text") ->> 'variation'::"text"))::numeric <= '9007199254740991'::numeric) AND (((("reply_drafting_v2" -> 'options'::"text") ->> 'opening'::"text"))::numeric >= (1)::numeric) AND (((("reply_drafting_v2" -> 'options'::"text") ->> 'opening'::"text"))::numeric <= (3)::numeric) AND ("trunc"(((("reply_drafting_v2" -> 'options'::"text") ->> 'opening'::"text"))::numeric) = ((("reply_drafting_v2" -> 'options'::"text") ->> 'opening'::"text"))::numeric) AND ((NOT (("reply_drafting_v2" -> 'options'::"text") ? 'maxWords'::"text")) OR (("jsonb_typeof"((("reply_drafting_v2" -> 'options'::"text") -> 'maxWords'::"text")) = 'number'::"text") AND ((("reply_drafting_v2" -> 'options'::"text") ->> 'length'::"text") = 'short'::"text") AND (((("reply_drafting_v2" -> 'options'::"text") ->> 'maxWords'::"text"))::numeric >= (8)::numeric) AND (((("reply_drafting_v2" -> 'options'::"text") ->> 'maxWords'::"text"))::numeric <= (80)::numeric) AND ("trunc"(((("reply_drafting_v2" -> 'options'::"text") ->> 'maxWords'::"text"))::numeric) = ((("reply_drafting_v2" -> 'options'::"text") ->> 'maxWords'::"text"))::numeric))) AND ("jsonb_typeof"(("reply_drafting_v2" -> 'rewriteIssues'::"text")) = 'array'::"text") AND (("reply_drafting_v2" -> 'rewriteIssues'::"text") <@ '["empty_body", "digits", "symbols", "emoji", "avoidance", "damaging_words", "singular_voice", "invitation", "greeting", "sign_off", "complaint_exclamation", "gendered_guest", "invented_name", "serious_praise", "bulgarian_calque", "bulgarian_unwell", "multiple_apologies", "max_words", "sentence_reference", "prohibited_content", "private_data"]'::"jsonb") AND ((("rewrite_parent_operation_id" IS NULL) AND ("jsonb_typeof"(("reply_drafting_v2" -> 'parentOperationId'::"text")) = 'null'::"text") AND ("jsonb_array_length"(("reply_drafting_v2" -> 'rewriteIssues'::"text")) = 0)) OR (("rewrite_parent_operation_id" IS NOT NULL) AND ("jsonb_typeof"(("reply_drafting_v2" -> 'parentOperationId'::"text")) = 'string'::"text") AND (("jsonb_array_length"(("reply_drafting_v2" -> 'rewriteIssues'::"text")) >= 1) AND ("jsonb_array_length"(("reply_drafting_v2" -> 'rewriteIssues'::"text")) <= 28)))) AND (NOT ("rewrite_parent_operation_id" IS DISTINCT FROM (("reply_drafting_v2" ->> 'parentOperationId'::"text"))::"uuid")) AND ((("reply_drafting_v2" ->> 'rewriteOrdinal'::"text"))::numeric = (
CASE
    WHEN ("rewrite_parent_operation_id" IS NULL) THEN 0
    ELSE 1
END)::numeric))) IS TRUE)),
    CONSTRAINT "ai_operations_safe_integers" CHECK ((((COALESCE("source_revision", (0)::bigint) >= 0) AND (COALESCE("source_revision", (0)::bigint) <= '9007199254740991'::bigint)) AND ((COALESCE("reviewed_at_epoch_millis", (0)::bigint) >= 0) AND (COALESCE("reviewed_at_epoch_millis", (0)::bigint) <= '9007199254740991'::bigint)) AND ((COALESCE("analysis_sequence", (0)::bigint) >= 0) AND (COALESCE("analysis_sequence", (0)::bigint) <= '9007199254740991'::bigint)) AND ((COALESCE("base_reply_state_revision", (0)::bigint) >= 0) AND (COALESCE("base_reply_state_revision", (0)::bigint) <= '9007199254740991'::bigint)) AND ((COALESCE("terminal_analysis_sequence", (0)::bigint) >= 0) AND (COALESCE("terminal_analysis_sequence", (0)::bigint) <= '9007199254740991'::bigint)) AND ((COALESCE("aggregate_revision", (0)::bigint) >= 0) AND (COALESCE("aggregate_revision", (0)::bigint) <= '9007199254740991'::bigint)) AND ((COALESCE("adopted_reply_revision", (0)::bigint) >= 0) AND (COALESCE("adopted_reply_revision", (0)::bigint) <= '9007199254740991'::bigint)) AND ((COALESCE("adopted_review_reply_state_revision", (0)::bigint) >= 0) AND (COALESCE("adopted_review_reply_state_revision", (0)::bigint) <= '9007199254740991'::bigint)))),
    CONSTRAINT "ai_operations_source_provenance_valid" CHECK (((("source_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("source_byte_count" >= 1) AND ("source_byte_count" <= 131072)))),
    CONSTRAINT "ai_operations_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['pending'::character varying, 'executing'::character varying, 'succeeded_pending_delivery'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'cancelled'::character varying])::"text"[]))),
    CONSTRAINT "ai_operations_v3_lineage_required" CHECK (((("operation_profile_version")::"text" <> 'review-analysis-v3'::"text") OR ((("command")::"text" = 'analysis'::"text") AND ("provider_id" IS NOT NULL) AND ("vocabulary_hint_set_id" IS NOT NULL) AND ("normalization_profile_version" IS NOT NULL)))),
    CONSTRAINT "ai_operations_vocabulary_lineage_valid" CHECK (((("vocabulary_hint_set_id" IS NULL) AND ("vocabulary_hint_set_version" IS NULL) AND ("vocabulary_hint_set_digest" IS NULL)) OR (("vocabulary_hint_set_id" IS NOT NULL) AND ("vocabulary_hint_set_version" IS NOT NULL) AND ("vocabulary_hint_set_digest" IS NOT NULL) AND (("vocabulary_hint_set_id")::"text" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'::"text") AND (("char_length"(("vocabulary_hint_set_version")::"text") >= 1) AND ("char_length"(("vocabulary_hint_set_version")::"text") <= 100)) AND (("vocabulary_hint_set_digest")::"text" ~ '^[0-9a-f]{64}$'::"text"))))
);


--
-- Name: ai_organization_cost_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_organization_cost_windows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "reserved_micros" bigint DEFAULT 0 NOT NULL,
    "settled_micros" bigint DEFAULT 0 NOT NULL,
    "cap_micros" bigint DEFAULT 50000000 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_organization_cost_windows_valid" CHECK (((("reserved_micros" >= 0) AND ("reserved_micros" <= "cap_micros")) AND (("settled_micros" >= 0) AND ("settled_micros" <= "cap_micros")) AND (("reserved_micros" + "settled_micros") <= "cap_micros") AND (("cap_micros" >= 1) AND ("cap_micros" <= '9007199254740991'::bigint)) AND ("window_start" = "date_trunc"('month'::"text", "window_start"))))
);


--
-- Name: ai_property_aggregate_contribution_aspects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_aggregate_contribution_aspects" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "aspect" character varying(40) NOT NULL,
    "polarity" character varying(20) NOT NULL,
    "intensity" integer NOT NULL,
    CONSTRAINT "ai_property_aggregate_contribution_aspects_aspect_valid" CHECK ((("aspect")::"text" = ANY ((ARRAY['service'::character varying, 'staff'::character varying, 'quality'::character varying, 'value'::character varying, 'cleanliness'::character varying, 'wait_time'::character varying, 'atmosphere'::character varying, 'location'::character varying, 'accessibility'::character varying, 'other'::character varying, 'room'::character varying, 'food_and_drink'::character varying, 'noise'::character varying, 'wifi_and_tech'::character varying, 'check_in_out'::character varying, 'parking'::character varying, 'amenities'::character varying, 'events'::character varying])::"text"[]))),
    CONSTRAINT "ai_property_contribution_aspects_polarity_intensity_valid" CHECK ((((("polarity")::"text" = 'positive'::"text") AND (("intensity" >= 20) AND ("intensity" <= 100))) OR ((("polarity")::"text" = 'neutral'::"text") AND ("abs"("intensity") <= 19)) OR ((("polarity")::"text" = 'negative'::"text") AND ("intensity" < 0) AND (("abs"("intensity") >= 20) AND ("abs"("intensity") <= 100)))))
);


--
-- Name: ai_property_aggregate_contribution_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_aggregate_contribution_mentions" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "mention_ordinal" smallint NOT NULL,
    "topic" character varying(40) NOT NULL,
    "polarity" character varying(10) NOT NULL,
    "strength" character varying(10) NOT NULL,
    "thing" character varying(80),
    "issue" character varying(80),
    "names_person" character varying(20),
    "issue_group_id" "uuid",
    CONSTRAINT "ai_property_aggregate_contribution_mentions_cause_valid" CHECK (((("thing" IS NULL) OR (("thing")::"text" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$'::"text")) AND (("issue" IS NULL) OR (("issue")::"text" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$'::"text")) AND (("issue" IS NOT NULL) OR ("thing" IS NULL)))),
    CONSTRAINT "ai_property_aggregate_contribution_mentions_values_valid" CHECK ((("source_epoch" >= 0) AND (("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND (("analysis_sequence" >= 1) AND ("analysis_sequence" <= '9007199254740991'::bigint)) AND (("mention_ordinal" >= 0) AND ("mention_ordinal" <= 47)) AND (("topic")::"text" = ANY ((ARRAY['staff_service'::character varying, 'speed_waiting'::character varying, 'booking_arrival'::character varying, 'main_service'::character varying, 'food_drink'::character varying, 'cleanliness'::character varying, 'facilities_equipment'::character varying, 'price_billing'::character varying, 'atmosphere_noise'::character varying, 'location_access'::character varying, 'safety'::character varying, 'communication'::character varying])::"text"[])) AND (("polarity")::"text" = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying])::"text"[])) AND (("strength")::"text" = ANY ((ARRAY['mild'::character varying, 'clear'::character varying, 'strong'::character varying])::"text"[])) AND (("names_person" IS NULL) OR (("names_person")::"text" = ANY ((ARRAY['team_member'::character varying, 'other'::character varying])::"text"[])))))
);


--
-- Name: ai_property_aggregate_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_aggregate_contributions" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "property_profile_version" integer NOT NULL,
    "calendar_profile_version" character varying(100) NOT NULL,
    "local_date" "date" NOT NULL,
    "status" character varying(20) NOT NULL,
    "rating" integer NOT NULL,
    "sentiment" character varying(20),
    "primary_category" character varying(40),
    "attention" character varying(20),
    "applied_aggregate_revision" bigint NOT NULL,
    "applied_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_property_aggregate_contributions_result_valid" CHECK ((((("status")::"text" = 'ready'::"text") AND (("sentiment")::"text" = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying, 'mixed'::character varying])::"text"[])) AND (("primary_category" IS NULL) OR (("primary_category")::"text" = ANY ((ARRAY['service'::character varying, 'staff'::character varying, 'quality'::character varying, 'value'::character varying, 'cleanliness'::character varying, 'wait_time'::character varying, 'atmosphere'::character varying, 'location'::character varying, 'accessibility'::character varying, 'other'::character varying, 'room'::character varying, 'food_and_drink'::character varying, 'noise'::character varying, 'wifi_and_tech'::character varying, 'check_in_out'::character varying, 'parking'::character varying, 'amenities'::character varying, 'events'::character varying])::"text"[]))) AND (("attention")::"text" = ANY ((ARRAY['urgent'::character varying, 'high'::character varying, 'medium'::character varying, 'low'::character varying])::"text"[]))) OR ((("status")::"text" = 'unavailable'::"text") AND ("sentiment" IS NULL) AND ("primary_category" IS NULL) AND ("attention" IS NULL)))),
    CONSTRAINT "ai_property_aggregate_contributions_values_valid" CHECK ((("source_epoch" >= 0) AND (("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND (("analysis_sequence" >= 1) AND ("analysis_sequence" <= '9007199254740991'::bigint)) AND ("review_analysis_epoch" >= 1) AND ("property_profile_version" >= 1) AND (("rating" >= 1) AND ("rating" <= 5)) AND (("applied_aggregate_revision" >= 1) AND ("applied_aggregate_revision" <= '9007199254740991'::bigint))))
);


--
-- Name: ai_property_aggregate_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_aggregate_heads" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "property_profile_version" integer NOT NULL,
    "aggregate_revision" bigint NOT NULL,
    "terminal_analysis_sequence" bigint NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "settled_analysis_count" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "ai_property_aggregate_heads_settled_count_valid" CHECK ((("settled_analysis_count" >= 0) AND ("settled_analysis_count" <= '9007199254740991'::bigint))),
    CONSTRAINT "ai_property_aggregate_heads_versions_valid" CHECK ((("source_epoch" >= 0) AND ("review_analysis_epoch" >= 1) AND ("property_profile_version" >= 1) AND (("aggregate_revision" >= 0) AND ("aggregate_revision" <= '9007199254740991'::bigint)) AND (("terminal_analysis_sequence" >= 0) AND ("terminal_analysis_sequence" <= '9007199254740991'::bigint))))
);


--
-- Name: ai_property_aggregate_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_aggregate_settlements" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "settled_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_property_aggregate_settlements_versions_valid" CHECK ((("source_epoch" >= 0) AND ("review_analysis_epoch" >= 1) AND (("analysis_sequence" >= 1) AND ("analysis_sequence" <= '9007199254740991'::bigint))))
);


--
-- Name: ai_property_daily_aggregates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_daily_aggregates" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "source_epoch" integer NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "property_profile_version" integer NOT NULL,
    "calendar_profile_version" character varying(100) NOT NULL,
    "aggregate_revision" bigint NOT NULL,
    "terminal_analysis_sequence" bigint NOT NULL,
    "review_count" integer NOT NULL,
    "rating_sum" integer NOT NULL,
    "positive_count" integer NOT NULL,
    "neutral_count" integer NOT NULL,
    "negative_count" integer NOT NULL,
    "mixed_count" integer NOT NULL,
    "urgent_count" integer NOT NULL,
    "high_count" integer NOT NULL,
    "medium_count" integer NOT NULL,
    "low_count" integer NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_property_daily_aggregates_count_sums_valid" CHECK (((((("positive_count" + "neutral_count") + "negative_count") + "mixed_count") = "review_count") AND (((("urgent_count" + "high_count") + "medium_count") + "low_count") = "review_count") AND ("rating_sum" <= ("review_count" * 5)))),
    CONSTRAINT "ai_property_daily_aggregates_counts_nonnegative" CHECK ((("review_count" >= 0) AND ("rating_sum" >= 0) AND ("positive_count" >= 0) AND ("neutral_count" >= 0) AND ("negative_count" >= 0) AND ("mixed_count" >= 0) AND ("urgent_count" >= 0) AND ("high_count" >= 0) AND ("medium_count" >= 0) AND ("low_count" >= 0))),
    CONSTRAINT "ai_property_daily_aggregates_versions_valid" CHECK ((("source_epoch" >= 0) AND ("review_analysis_epoch" >= 1) AND ("property_profile_version" >= 1) AND (("aggregate_revision" >= 0) AND ("aggregate_revision" <= '9007199254740991'::bigint)) AND (("terminal_analysis_sequence" >= 0) AND ("terminal_analysis_sequence" <= '9007199254740991'::bigint))))
);


--
-- Name: ai_property_daily_aspect_aggregates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_daily_aspect_aggregates" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "source_epoch" integer NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "property_profile_version" integer NOT NULL,
    "aspect" character varying(40) NOT NULL,
    "polarity" character varying(20) NOT NULL,
    "mention_count" integer NOT NULL,
    CONSTRAINT "ai_property_daily_aspect_aggregates_values_valid" CHECK ((("source_epoch" >= 0) AND ("review_analysis_epoch" >= 1) AND ("property_profile_version" >= 1) AND (("aspect")::"text" = ANY ((ARRAY['service'::character varying, 'staff'::character varying, 'quality'::character varying, 'value'::character varying, 'cleanliness'::character varying, 'wait_time'::character varying, 'atmosphere'::character varying, 'location'::character varying, 'accessibility'::character varying, 'other'::character varying, 'room'::character varying, 'food_and_drink'::character varying, 'noise'::character varying, 'wifi_and_tech'::character varying, 'check_in_out'::character varying, 'parking'::character varying, 'amenities'::character varying, 'events'::character varying])::"text"[])) AND (("polarity")::"text" = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying])::"text"[])) AND ("mention_count" >= 0)))
);


--
-- Name: ai_property_issue_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_issue_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "topic" character varying(40) NOT NULL,
    "canonical_thing" character varying(80),
    "canonical_key" character varying(100) NOT NULL,
    "display_name" character varying(80),
    "merged_into_issue_id" "uuid",
    "hidden_at" timestamp with time zone,
    "hidden_by" character varying(255),
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "last_seen_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "normalization_version" character varying(100) NOT NULL,
    CONSTRAINT "ai_property_issue_groups_canonical_valid" CHECK ((((("canonical_key")::"text" = '__topic__'::"text") AND ("canonical_thing" IS NULL)) OR (("canonical_thing" IS NOT NULL) AND (("canonical_key")::"text" = ("canonical_thing")::"text") AND (("canonical_thing")::"text" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$'::"text")))),
    CONSTRAINT "ai_property_issue_groups_display_name_valid" CHECK ((("display_name" IS NULL) OR ((("char_length"(("display_name")::"text") >= 1) AND ("char_length"(("display_name")::"text") <= 80)) AND (("display_name")::"text" = "btrim"(("display_name")::"text"))))),
    CONSTRAINT "ai_property_issue_groups_hidden_valid" CHECK (((("hidden_at" IS NULL) AND ("hidden_by" IS NULL)) OR (("hidden_at" IS NOT NULL) AND ("hidden_by" IS NOT NULL) AND (("char_length"(("hidden_by")::"text") >= 1) AND ("char_length"(("hidden_by")::"text") <= 255))))),
    CONSTRAINT "ai_property_issue_groups_normalization_version_valid" CHECK ((("char_length"(("normalization_version")::"text") >= 1) AND ("char_length"(("normalization_version")::"text") <= 100))),
    CONSTRAINT "ai_property_issue_groups_not_self_merged" CHECK ((("merged_into_issue_id" IS NULL) OR ("merged_into_issue_id" <> "id"))),
    CONSTRAINT "ai_property_issue_groups_topic_valid" CHECK ((("topic")::"text" = ANY ((ARRAY['staff_service'::character varying, 'speed_waiting'::character varying, 'booking_arrival'::character varying, 'main_service'::character varying, 'food_drink'::character varying, 'cleanliness'::character varying, 'facilities_equipment'::character varying, 'price_billing'::character varying, 'atmosphere_noise'::character varying, 'location_access'::character varying, 'safety'::character varying, 'communication'::character varying])::"text"[])))
);


--
-- Name: ai_property_issue_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_issue_members" (
    "issue_group_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "topic" character varying(40) NOT NULL,
    "member_key" character varying(100) NOT NULL,
    "member_thing" character varying(80),
    "source" character varying(20) NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "last_seen_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_property_issue_members_identity_valid" CHECK ((((("member_key")::"text" = '__topic__'::"text") AND ("member_thing" IS NULL)) OR (("member_thing" IS NOT NULL) AND (("member_key")::"text" = ("member_thing")::"text") AND (("member_thing")::"text" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$'::"text")))),
    CONSTRAINT "ai_property_issue_members_source_valid" CHECK ((("source")::"text" = ANY ((ARRAY['deterministic'::character varying, 'manager'::character varying])::"text"[]))),
    CONSTRAINT "ai_property_issue_members_topic_valid" CHECK ((("topic")::"text" = ANY ((ARRAY['staff_service'::character varying, 'speed_waiting'::character varying, 'booking_arrival'::character varying, 'main_service'::character varying, 'food_drink'::character varying, 'cleanliness'::character varying, 'facilities_equipment'::character varying, 'price_billing'::character varying, 'atmosphere_noise'::character varying, 'location_access'::character varying, 'safety'::character varying, 'communication'::character varying])::"text"[])))
);


--
-- Name: ai_property_processing_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_processing_profiles" (
    "property_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "country_code" character varying(2) NOT NULL,
    "timezone" character varying(64) NOT NULL,
    "processing_region" character varying(20) NOT NULL,
    "routing_policy_version" integer NOT NULL,
    "provider_deployment_profile_version" character varying(100) NOT NULL,
    "source_epoch" integer NOT NULL,
    "profile_version" integer NOT NULL,
    "lifecycle_state" character varying(20) NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_property_profiles_country_valid" CHECK ((("country_code")::"text" ~ '^[A-Z]{2}$'::"text")),
    CONSTRAINT "ai_property_profiles_lifecycle_valid" CHECK ((("lifecycle_state")::"text" = ANY ((ARRAY['active'::character varying, 'deleting'::character varying])::"text"[]))),
    CONSTRAINT "ai_property_profiles_region_valid" CHECK ((("processing_region")::"text" = 'global'::"text")),
    CONSTRAINT "ai_property_profiles_timezone_valid" CHECK ((("length"(("timezone")::"text") >= 1) AND ("length"(("timezone")::"text") <= 64))),
    CONSTRAINT "ai_property_profiles_versions_valid" CHECK ((("source_epoch" >= 0) AND ("profile_version" >= 1)))
);


--
-- Name: ai_property_review_population_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_review_population_daily" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "source_epoch" integer NOT NULL,
    "property_profile_version" integer NOT NULL,
    "calendar_profile_version" character varying(100) NOT NULL,
    "review_count" integer NOT NULL,
    "text_review_count" integer NOT NULL,
    "rating_1_count" integer NOT NULL,
    "rating_2_count" integer NOT NULL,
    "rating_3_count" integer NOT NULL,
    "rating_4_count" integer NOT NULL,
    "rating_5_count" integer NOT NULL,
    "population_revision" bigint NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_property_review_population_daily_counts_valid" CHECK ((("review_count" >= 0) AND ("text_review_count" >= 0) AND ("text_review_count" <= "review_count") AND ("rating_1_count" >= 0) AND ("rating_2_count" >= 0) AND ("rating_3_count" >= 0) AND ("rating_4_count" >= 0) AND ("rating_5_count" >= 0) AND ((((("rating_1_count" + "rating_2_count") + "rating_3_count") + "rating_4_count") + "rating_5_count") = "review_count"))),
    CONSTRAINT "ai_property_review_population_daily_versions_valid" CHECK ((("source_epoch" >= 0) AND ("property_profile_version" >= 1) AND (("char_length"(("calendar_profile_version")::"text") >= 1) AND ("char_length"(("calendar_profile_version")::"text") <= 100)) AND (("population_revision" >= 1) AND ("population_revision" <= '9007199254740991'::bigint))))
);


--
-- Name: ai_property_trend_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_trend_outcomes" (
    "schedule_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "disposition" character varying(32) NOT NULL,
    "operation_id" "uuid",
    "selected_signal_ids" "jsonb",
    "signal_key" character varying(64),
    "direction" character varying(20),
    "confidence_basis_points" integer,
    "supporting_review_count" integer,
    "headline" character varying(80),
    "sentences" "jsonb",
    "summary" "text",
    "render_profile_version" character varying(100),
    "render_profile_digest" character varying(64),
    "definition_version" character varying(100),
    "definition_digest" character varying(64),
    "evidence" "jsonb",
    "provider_selection_recorded_at" timestamp with time zone,
    "recorded_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone,
    CONSTRAINT "ai_property_trend_outcomes_valid" CHECK ((((("disposition")::"text" = 'ready'::"text") AND (("operation_id" IS NOT NULL) OR ("provider_selection_recorded_at" IS NULL)) AND ("jsonb_typeof"("selected_signal_ids") = 'array'::"text") AND (("jsonb_array_length"("selected_signal_ids") >= 1) AND ("jsonb_array_length"("selected_signal_ids") <= 4)) AND (("signal_key")::"text" ~ '^[a-z][a-z0-9_.]{2,63}$'::"text") AND (("direction")::"text" = ANY ((ARRAY['improving'::character varying, 'stable'::character varying, 'declining'::character varying])::"text"[])) AND (("confidence_basis_points" >= 0) AND ("confidence_basis_points" <= 10000)) AND ("supporting_review_count" >= 0) AND (("headline")::"text" = ANY ((ARRAY['Review signals improved'::character varying, 'Review signals need attention'::character varying, 'Notable review changes'::character varying])::"text"[])) AND ("jsonb_typeof"("sentences") = 'array'::"text") AND (("jsonb_array_length"("sentences") >= 1) AND ("jsonb_array_length"("sentences") <= 4)) AND (("length"("summary") >= 1) AND ("length"("summary") <= 1000)) AND (("render_profile_version")::"text" = 'trend-render-v1'::"text") AND (("render_profile_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ((("definition_version" IS NULL) AND ("definition_digest" IS NULL) AND ("evidence" IS NULL)) OR ((("definition_version")::"text" = 'property-trend-definition-v1'::"text") AND (("definition_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("jsonb_typeof"("evidence") = 'object'::"text"))) AND ((("operation_id" IS NOT NULL) AND ("provider_selection_recorded_at" IS NOT NULL) AND ("recorded_at" = "provider_selection_recorded_at")) OR (("operation_id" IS NULL) AND ("provider_selection_recorded_at" IS NULL))) AND ("expires_at" > "recorded_at")) OR ((("disposition")::"text" = ANY ((ARRAY['updating'::character varying, 'insufficient_data'::character varying, 'no_material_change'::character varying])::"text"[])) AND ("operation_id" IS NULL) AND ("selected_signal_ids" IS NULL) AND ("signal_key" IS NULL) AND ("direction" IS NULL) AND ("confidence_basis_points" IS NULL) AND ("supporting_review_count" IS NULL) AND ("headline" IS NULL) AND ("sentences" IS NULL) AND ("summary" IS NULL) AND ("render_profile_version" IS NULL) AND ("render_profile_digest" IS NULL) AND ((("definition_version" IS NULL) AND ("definition_digest" IS NULL) AND ("evidence" IS NULL) AND ("expires_at" IS NULL)) OR ((("definition_version")::"text" = 'property-trend-definition-v1'::"text") AND (("definition_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("jsonb_typeof"("evidence") = 'object'::"text") AND ("expires_at" > "recorded_at"))) AND ("provider_selection_recorded_at" IS NULL))))
);


--
-- Name: ai_property_trend_scheduler_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_trend_scheduler_heads" (
    "scheduler_key" character varying(64) NOT NULL,
    "generation" bigint NOT NULL,
    "cursor_organization_id" character varying(255),
    "cursor_property_id" "uuid",
    "lease_owner" "uuid",
    "claimed_at" timestamp with time zone,
    "lease_expires_at" timestamp with time zone,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_property_trend_scheduler_heads_valid" CHECK (((("scheduler_key")::"text" = 'property-trend-v1'::"text") AND (("generation" >= 0) AND ("generation" <= '9007199254740991'::bigint)) AND ((("cursor_organization_id" IS NULL) AND ("cursor_property_id" IS NULL)) OR (("cursor_organization_id" IS NOT NULL) AND ("cursor_property_id" IS NOT NULL))) AND ((("lease_owner" IS NULL) AND ("claimed_at" IS NULL) AND ("lease_expires_at" IS NULL)) OR (("lease_owner" IS NOT NULL) AND ("claimed_at" IS NOT NULL) AND ("lease_expires_at" > "claimed_at")))))
);


--
-- Name: ai_property_trend_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_property_trend_schedules" (
    "id" "uuid" NOT NULL,
    "outbox_event_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "due_local_date" "date" NOT NULL,
    "source_epoch" integer NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "property_trends_epoch" integer NOT NULL,
    "property_profile_version" integer NOT NULL,
    "terminal_analysis_sequence" bigint NOT NULL,
    "aggregate_revision" bigint NOT NULL,
    "timezone" character varying(64) NOT NULL,
    "calendar_profile_version" character varying(100) NOT NULL,
    "report_profile_version" character varying(100) NOT NULL,
    "scheduler_generation" bigint NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_property_trend_schedules_versions_valid" CHECK ((("source_epoch" >= 0) AND ("review_analysis_epoch" >= 1) AND ("property_trends_epoch" >= 1) AND ("property_profile_version" >= 1) AND (("terminal_analysis_sequence" >= 0) AND ("terminal_analysis_sequence" <= '9007199254740991'::bigint)) AND (("aggregate_revision" >= 0) AND ("aggregate_revision" <= '9007199254740991'::bigint)) AND (("scheduler_generation" >= 1) AND ("scheduler_generation" <= '9007199254740991'::bigint)) AND (("timezone")::"text" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'::"text")))
);


--
-- Name: ai_review_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_review_analyses" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "operation_id" "uuid" NOT NULL,
    "authorization_lineage_id" "uuid" NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "property_profile_version" integer NOT NULL,
    "analysis_profile_version" character varying(100) NOT NULL,
    "status" character varying(20) NOT NULL,
    "unavailable_reason" character varying(40),
    "sentiment" character varying(20),
    "primary_category" character varying(40),
    "attention" character varying(20),
    "generated_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "issue_label" character varying(40),
    "urgent_reason" character varying(30),
    CONSTRAINT "ai_review_analyses_result_valid" CHECK ((((("analysis_profile_version")::"text" <> 'review-analysis-v3'::"text") AND ("urgent_reason" IS NULL) AND (((("status")::"text" = 'ready'::"text") AND ("unavailable_reason" IS NULL) AND (("sentiment")::"text" = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying, 'mixed'::character varying])::"text"[])) AND (("primary_category")::"text" = ANY ((ARRAY['service'::character varying, 'staff'::character varying, 'quality'::character varying, 'value'::character varying, 'cleanliness'::character varying, 'wait_time'::character varying, 'atmosphere'::character varying, 'location'::character varying, 'accessibility'::character varying, 'other'::character varying, 'room'::character varying, 'food_and_drink'::character varying, 'noise'::character varying, 'wifi_and_tech'::character varying, 'check_in_out'::character varying, 'parking'::character varying, 'amenities'::character varying, 'events'::character varying])::"text"[])) AND (("attention")::"text" = ANY ((ARRAY['urgent'::character varying, 'high'::character varying, 'medium'::character varying, 'low'::character varying])::"text"[])) AND (("issue_label" IS NULL) OR (("issue_label")::"text" ~ '^[a-z]+( [a-z]+){0,3}$'::"text"))) OR ((("status")::"text" = 'unavailable'::"text") AND (("unavailable_reason")::"text" = 'language_not_supported'::"text") AND ("sentiment" IS NULL) AND ("primary_category" IS NULL) AND ("attention" IS NULL) AND ("issue_label" IS NULL)))) OR ((("analysis_profile_version")::"text" = 'review-analysis-v3'::"text") AND (((("status")::"text" = 'ready'::"text") AND ("unavailable_reason" IS NULL) AND ("sentiment" IS NOT NULL) AND (("sentiment")::"text" = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying, 'mixed'::character varying])::"text"[])) AND ("primary_category" IS NULL) AND ("issue_label" IS NULL) AND ("attention" IS NOT NULL) AND (("attention")::"text" = ANY ((ARRAY['urgent'::character varying, 'high'::character varying, 'medium'::character varying, 'low'::character varying])::"text"[])) AND (((("attention")::"text" = 'urgent'::"text") AND ("urgent_reason" IS NOT NULL) AND (("urgent_reason")::"text" = ANY ((ARRAY['safety'::character varying, 'health'::character varying, 'discrimination'::character varying, 'legal_threat'::character varying])::"text"[]))) OR ((("attention")::"text" <> 'urgent'::"text") AND ("urgent_reason" IS NULL)))) OR ((("status")::"text" = 'unavailable'::"text") AND ("unavailable_reason" IS NOT NULL) AND (("unavailable_reason")::"text" = 'language_not_supported'::"text") AND ("sentiment" IS NULL) AND ("primary_category" IS NULL) AND ("attention" IS NULL) AND ("issue_label" IS NULL) AND ("urgent_reason" IS NULL)))))),
    CONSTRAINT "ai_review_analyses_retention_valid" CHECK (("expires_at" > "generated_at")),
    CONSTRAINT "ai_review_analyses_versions_valid" CHECK ((("source_epoch" >= 0) AND (("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND (("analysis_sequence" >= 1) AND ("analysis_sequence" <= '9007199254740991'::bigint)) AND ("review_analysis_epoch" >= 1) AND ("property_profile_version" >= 1)))
);


--
-- Name: ai_review_analysis_aspects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_review_analysis_aspects" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "aspect" character varying(40) NOT NULL,
    "polarity" character varying(20) NOT NULL,
    "intensity" integer NOT NULL,
    CONSTRAINT "ai_review_analysis_aspects_aspect_valid" CHECK ((("aspect")::"text" = ANY ((ARRAY['service'::character varying, 'staff'::character varying, 'quality'::character varying, 'value'::character varying, 'cleanliness'::character varying, 'wait_time'::character varying, 'atmosphere'::character varying, 'location'::character varying, 'accessibility'::character varying, 'other'::character varying, 'room'::character varying, 'food_and_drink'::character varying, 'noise'::character varying, 'wifi_and_tech'::character varying, 'check_in_out'::character varying, 'parking'::character varying, 'amenities'::character varying, 'events'::character varying])::"text"[]))),
    CONSTRAINT "ai_review_analysis_aspects_polarity_intensity_valid" CHECK ((((("polarity")::"text" = 'positive'::"text") AND (("intensity" >= 20) AND ("intensity" <= 100))) OR ((("polarity")::"text" = 'neutral'::"text") AND ("abs"("intensity") <= 19)) OR ((("polarity")::"text" = 'negative'::"text") AND ("intensity" < 0) AND (("abs"("intensity") >= 20) AND ("abs"("intensity") <= 100)))))
);


--
-- Name: ai_review_analysis_backlog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_review_analysis_backlog" (
    "event_envelope_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" integer NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "origin" character varying(32) NOT NULL,
    "priority" character varying(16) DEFAULT 'background'::character varying NOT NULL,
    "state" character varying(16) DEFAULT 'queued'::character varying NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone NOT NULL,
    "claimed_until" timestamp with time zone,
    "first_started_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_review_analysis_backlog_values_valid" CHECK (((("origin")::"text" = ANY ((ARRAY['historical_onboarding'::character varying, 'backfill'::character varying, 'deferred_live'::character varying])::"text"[])) AND (("priority")::"text" = ANY ((ARRAY['background'::character varying, 'interactive'::character varying])::"text"[])) AND (("state")::"text" = ANY ((ARRAY['queued'::character varying, 'claimed'::character varying])::"text"[])) AND ((("state")::"text" = 'claimed'::"text") = ("claimed_until" IS NOT NULL)) AND (("attempts" >= 0) AND ("attempts" <= 2147483647)) AND (("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("source_revision" >= 1) AND ("source_revision" <= 2147483647)) AND (("analysis_sequence" >= 1) AND ("analysis_sequence" <= '9007199254740991'::bigint))))
);


--
-- Name: ai_review_analysis_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_review_analysis_enrollments" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "authorization_lineage_id" "uuid" NOT NULL,
    "authorization_state_version" integer NOT NULL,
    "source_epoch" integer NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "analysis_start_sequence" bigint NOT NULL,
    "provider_deployment_profile_version" character varying(100) NOT NULL,
    "trigger_event_envelope_id" "uuid" NOT NULL,
    "state" character varying(32) NOT NULL,
    "snapshot_revision_count" bigint NOT NULL,
    "snapshot_revision_set_digest" character varying(64) NOT NULL,
    "snapshot_captured_at" timestamp with time zone NOT NULL,
    "safety_ceiling" integer DEFAULT 10000 NOT NULL,
    "assisted_approval_required" boolean DEFAULT false NOT NULL,
    "assisted_approved_at" timestamp with time zone,
    "assisted_approved_by" character varying(255),
    "assisted_approval_evidence_digest" character varying(64),
    "assisted_approval_correlation_id" "uuid",
    "enrolled_revision_count" bigint DEFAULT 0 NOT NULL,
    "caught_up_eligible_revision_count" bigint,
    "caught_up_analysis_sequence" bigint,
    "caught_up_revision_set_digest" character varying(64),
    "caught_up_at" timestamp with time zone,
    "terminal_reason" character varying(64),
    "terminal_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_review_analysis_enrollments_assisted_approval_valid" CHECK ((("safety_ceiling" = 10000) AND ("assisted_approval_required" = ("snapshot_revision_count" > "safety_ceiling")) AND ((("assisted_approved_at" IS NULL) AND ("assisted_approved_by" IS NULL) AND ("assisted_approval_evidence_digest" IS NULL) AND ("assisted_approval_correlation_id" IS NULL)) OR ("assisted_approval_required" AND ("assisted_approved_at" IS NOT NULL) AND (("length"(("assisted_approved_by")::"text") >= 1) AND ("length"(("assisted_approved_by")::"text") <= 255)) AND ("btrim"(("assisted_approved_by")::"text") = ("assisted_approved_by")::"text") AND (("assisted_approval_evidence_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("assisted_approval_correlation_id" IS NOT NULL))) AND (((("state")::"text" = 'awaiting_assisted_approval'::"text") AND "assisted_approval_required" AND ("assisted_approved_at" IS NULL)) OR ((("state")::"text" = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'caught_up'::character varying])::"text"[])) AND ((NOT "assisted_approval_required") OR ("assisted_approved_at" IS NOT NULL))) OR (("state")::"text" = ANY ((ARRAY['superseded'::character varying, 'stalled'::character varying])::"text"[]))))),
    CONSTRAINT "ai_review_analysis_enrollments_fence_safe" CHECK (((("authorization_state_version" >= 1) AND ("authorization_state_version" <= 2147483647)) AND (("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("review_analysis_epoch" >= 1) AND ("review_analysis_epoch" <= 2147483647)) AND (("analysis_start_sequence" >= 0) AND ("analysis_start_sequence" <= '9007199254740991'::bigint)))),
    CONSTRAINT "ai_review_analysis_enrollments_snapshot_valid" CHECK (((("snapshot_revision_count" >= 0) AND ("snapshot_revision_count" <= '9007199254740991'::bigint)) AND (("snapshot_revision_set_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ((("snapshot_revision_count" = 0) AND (("snapshot_revision_set_digest")::"text" = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'::"text")) OR (("snapshot_revision_count" > 0) AND (("snapshot_revision_set_digest")::"text" <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'::"text"))) AND (("enrolled_revision_count" >= 0) AND ("enrolled_revision_count" <= "snapshot_revision_count")))),
    CONSTRAINT "ai_review_analysis_enrollments_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['awaiting_assisted_approval'::character varying, 'queued'::character varying, 'running'::character varying, 'caught_up'::character varying, 'superseded'::character varying, 'stalled'::character varying])::"text"[]))),
    CONSTRAINT "ai_review_analysis_enrollments_terminal_valid" CHECK ((((("state")::"text" = ANY ((ARRAY['awaiting_assisted_approval'::character varying, 'queued'::character varying, 'running'::character varying])::"text"[])) AND ("caught_up_eligible_revision_count" IS NULL) AND ("caught_up_analysis_sequence" IS NULL) AND ("caught_up_revision_set_digest" IS NULL) AND ("caught_up_at" IS NULL) AND ("terminal_reason" IS NULL) AND ("terminal_at" IS NULL)) OR ((("state")::"text" = 'caught_up'::"text") AND (("caught_up_eligible_revision_count" >= 0) AND ("caught_up_eligible_revision_count" <= '9007199254740991'::bigint)) AND (("caught_up_analysis_sequence" >= "analysis_start_sequence") AND ("caught_up_analysis_sequence" <= '9007199254740991'::bigint)) AND (("caught_up_revision_set_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ((("caught_up_eligible_revision_count" = 0) AND (("caught_up_revision_set_digest")::"text" = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'::"text")) OR (("caught_up_eligible_revision_count" > 0) AND (("caught_up_revision_set_digest")::"text" <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'::"text"))) AND ("caught_up_at" IS NOT NULL) AND (("terminal_reason")::"text" = 'eligible_revision_set_caught_up'::"text") AND ("terminal_at" = "caught_up_at")) OR ((("state")::"text" = ANY ((ARRAY['superseded'::character varying, 'stalled'::character varying])::"text"[])) AND ("caught_up_eligible_revision_count" IS NULL) AND ("caught_up_analysis_sequence" IS NULL) AND ("caught_up_revision_set_digest" IS NULL) AND ("caught_up_at" IS NULL) AND (("terminal_reason")::"text" ~ '^[a-z][a-z0-9_]{2,63}$'::"text") AND ("terminal_at" IS NOT NULL)))),
    CONSTRAINT "ai_review_analysis_enrollments_time_valid" CHECK ((("snapshot_captured_at" >= "created_at") AND ("updated_at" >= "created_at") AND (("caught_up_at" IS NULL) OR ("caught_up_at" >= "snapshot_captured_at")) AND (("assisted_approved_at" IS NULL) OR ("assisted_approved_at" >= "snapshot_captured_at")) AND (("terminal_at" IS NULL) OR ("terminal_at" >= "snapshot_captured_at"))))
);


--
-- Name: ai_review_analysis_mention_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_review_analysis_mention_corrections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "mention_ordinal" smallint NOT NULL,
    "topic" character varying(40) NOT NULL,
    "kind" character varying(30) NOT NULL,
    "replacement_thing" character varying(80),
    "replacement_issue" character varying(80),
    "replacement_issue_group_id" "uuid",
    "corrected_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ai_review_analysis_mention_corrections_kind_valid" CHECK ((((("kind")::"text" = ANY ((ARRAY['remove_topic'::character varying, 'not_a_problem'::character varying])::"text"[])) AND ("replacement_thing" IS NULL) AND ("replacement_issue" IS NULL) AND ("replacement_issue_group_id" IS NULL)) OR ((("kind")::"text" = 'change_cause'::"text") AND ("replacement_issue_group_id" IS NOT NULL) AND (("replacement_thing" IS NOT NULL) OR ("replacement_issue" IS NOT NULL)) AND (("replacement_thing" IS NULL) OR (("replacement_thing")::"text" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$'::"text")) AND (("replacement_issue" IS NULL) OR (("replacement_issue")::"text" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$'::"text")) AND (("replacement_issue" IS NOT NULL) OR ("replacement_thing" IS NULL))))),
    CONSTRAINT "ai_review_analysis_mention_corrections_timestamps_valid" CHECK (("updated_at" >= "created_at")),
    CONSTRAINT "ai_review_analysis_mention_corrections_values_valid" CHECK ((("source_epoch" >= 0) AND (("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND (("analysis_sequence" >= 1) AND ("analysis_sequence" <= '9007199254740991'::bigint)) AND (("mention_ordinal" >= 0) AND ("mention_ordinal" <= 47)) AND (("topic")::"text" = ANY ((ARRAY['staff_service'::character varying, 'speed_waiting'::character varying, 'booking_arrival'::character varying, 'main_service'::character varying, 'food_drink'::character varying, 'cleanliness'::character varying, 'facilities_equipment'::character varying, 'price_billing'::character varying, 'atmosphere_noise'::character varying, 'location_access'::character varying, 'safety'::character varying, 'communication'::character varying])::"text"[])) AND (("char_length"(("corrected_by")::"text") >= 1) AND ("char_length"(("corrected_by")::"text") <= 255))))
);


--
-- Name: ai_review_analysis_mention_sentences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_review_analysis_mention_sentences" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "mention_ordinal" smallint NOT NULL,
    "sentence_number" integer NOT NULL,
    CONSTRAINT "ai_review_analysis_mention_sentences_number_valid" CHECK ((("sentence_number" >= 1) AND ("sentence_number" <= 10000)))
);


--
-- Name: ai_review_analysis_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_review_analysis_mentions" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "mention_ordinal" smallint NOT NULL,
    "topic" character varying(40) NOT NULL,
    "polarity" character varying(10) NOT NULL,
    "strength" character varying(10) NOT NULL,
    "thing" character varying(80),
    "issue" character varying(80),
    "names_person" character varying(20),
    CONSTRAINT "ai_review_analysis_mentions_cause_valid" CHECK (((("thing" IS NULL) OR (("thing")::"text" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$'::"text")) AND (("issue" IS NULL) OR (("issue")::"text" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$'::"text")) AND (("issue" IS NOT NULL) OR ("thing" IS NULL)))),
    CONSTRAINT "ai_review_analysis_mentions_values_valid" CHECK ((("source_epoch" >= 0) AND (("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND (("analysis_sequence" >= 1) AND ("analysis_sequence" <= '9007199254740991'::bigint)) AND (("mention_ordinal" >= 0) AND ("mention_ordinal" <= 47)) AND (("topic")::"text" = ANY ((ARRAY['staff_service'::character varying, 'speed_waiting'::character varying, 'booking_arrival'::character varying, 'main_service'::character varying, 'food_drink'::character varying, 'cleanliness'::character varying, 'facilities_equipment'::character varying, 'price_billing'::character varying, 'atmosphere_noise'::character varying, 'location_access'::character varying, 'safety'::character varying, 'communication'::character varying])::"text"[])) AND (("polarity")::"text" = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying])::"text"[])) AND (("strength")::"text" = ANY ((ARRAY['mild'::character varying, 'clear'::character varying, 'strong'::character varying])::"text"[])) AND (("names_person" IS NULL) OR (("names_person")::"text" = ANY ((ARRAY['team_member'::character varying, 'other'::character varying])::"text"[])))))
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "text" NOT NULL,
    "property_id" "text",
    "actor_type" "text" NOT NULL,
    "actor_id" "text",
    "action" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "source_kind" "text" NOT NULL,
    "source_id" "text" NOT NULL,
    "source_event_type" "text",
    "source_event_version" integer,
    "source_context" "text",
    "source_aggregate_id" "text",
    "occurred_at" timestamp with time zone NOT NULL,
    CONSTRAINT "audit_events_action_valid" CHECK (("action" ~ '^[a-z][a-z0-9_.:-]{0,79}$'::"text")),
    CONSTRAINT "audit_events_actor_attribution_valid" CHECK ((("actor_type" !~ '^(system|public)$'::"text") OR ("actor_id" IS NULL))),
    CONSTRAINT "audit_events_actor_id_valid" CHECK (("actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")),
    CONSTRAINT "audit_events_actor_type_valid" CHECK (("actor_type" ~ '^(user|system|operator|service|public)$'::"text")),
    CONSTRAINT "audit_events_organization_id_valid" CHECK (("organization_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")),
    CONSTRAINT "audit_events_outcome_valid" CHECK (("outcome" ~ '^(succeeded|denied|failed)$'::"text")),
    CONSTRAINT "audit_events_property_id_valid" CHECK (("property_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")),
    CONSTRAINT "audit_events_resource_id_valid" CHECK (("resource_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")),
    CONSTRAINT "audit_events_resource_type_valid" CHECK (("resource_type" ~ '^[a-z][a-z0-9_.:-]{0,39}$'::"text")),
    CONSTRAINT "audit_events_source_aggregate_id_valid" CHECK (("source_aggregate_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")),
    CONSTRAINT "audit_events_source_context_valid" CHECK (("source_context" ~ '^[a-z][a-z0-9_.:-]{0,127}$'::"text")),
    CONSTRAINT "audit_events_source_event_type_valid" CHECK (("source_event_type" ~ '^[a-z][a-z0-9_.:-]{0,127}$'::"text")),
    CONSTRAINT "audit_events_source_id_valid" CHECK (("source_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")),
    CONSTRAINT "audit_events_source_valid" CHECK (((("source_kind" = 'domain_fact'::"text") AND ("source_event_type" IS NOT NULL) AND ("source_event_version" IS NOT NULL) AND ("source_event_version" >= 1) AND ("source_context" IS NOT NULL) AND ("source_aggregate_id" IS NOT NULL)) OR (("source_kind" ~ '^(policy_decision|interactive_command|worker_command|operator_command|history_access|history_lifecycle)$'::"text") AND ("source_event_type" IS NULL) AND ("source_event_version" IS NULL) AND ("source_context" IS NULL) AND ("source_aggregate_id" IS NULL))))
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."audit_logs" (
    "id" "text" NOT NULL,
    "organization_id" "text" NOT NULL,
    "user_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "details" "jsonb",
    "success" boolean DEFAULT true NOT NULL,
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: backup_erasure_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."backup_erasure_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject_class" character varying(32) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid",
    "subject_ref" character(64),
    "context" character varying(32) NOT NULL,
    "closure_lineage_id" "uuid" NOT NULL,
    "lifecycle_revision" integer NOT NULL,
    "effective_erasure_at" timestamp with time zone NOT NULL,
    "erased_row_count" integer NOT NULL,
    "evidence_ref" character varying(200) NOT NULL,
    "hold_reference" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "backup_erasure_ledger_context_valid" CHECK ((("context")::"text" = ANY ((ARRAY['activity'::character varying, 'ai'::character varying, 'dashboard'::character varying, 'goal'::character varying, 'guest'::character varying, 'identity'::character varying, 'inbox'::character varying, 'integration'::character varying, 'metric'::character varying, 'notification'::character varying, 'portal'::character varying, 'property'::character varying, 'review'::character varying, 'staff'::character varying])::"text"[]))),
    CONSTRAINT "backup_erasure_ledger_count_nonnegative" CHECK (("erased_row_count" >= 0)),
    CONSTRAINT "backup_erasure_ledger_evidence_valid" CHECK ((("evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text")),
    CONSTRAINT "backup_erasure_ledger_hold_valid" CHECK ((("hold_reference" IS NULL) OR (("hold_reference")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text"))),
    CONSTRAINT "backup_erasure_ledger_revision_positive" CHECK (("lifecycle_revision" > 0)),
    CONSTRAINT "backup_erasure_ledger_scope_valid" CHECK ((((("subject_class")::"text" = 'organization'::"text") AND ("property_id" IS NULL) AND ("subject_ref" IS NULL)) OR ((("subject_class")::"text" = 'property'::"text") AND ("property_id" IS NOT NULL) AND ("subject_ref" IS NULL)) OR ((("subject_class")::"text" = 'privacy_subject'::"text") AND ("subject_ref" IS NOT NULL)))),
    CONSTRAINT "backup_erasure_ledger_subject_class_valid" CHECK ((("subject_class")::"text" = ANY ((ARRAY['organization'::character varying, 'property'::character varying, 'privacy_subject'::character varying])::"text"[]))),
    CONSTRAINT "backup_erasure_ledger_subject_ref_valid" CHECK ((("subject_ref" IS NULL) OR ("subject_ref" ~ '^[a-f0-9]{64}$'::"text")))
);


--
-- Name: beta_feedback_masked_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."beta_feedback_masked_layouts" (
    "feedback_reference" "uuid" NOT NULL,
    "viewport_width" integer NOT NULL,
    "viewport_height" integer NOT NULL,
    "box_count" integer NOT NULL,
    "boxes" "jsonb" NOT NULL,
    "captured_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "beta_feedback_masked_layout_box_count_valid" CHECK (((("box_count" >= 1) AND ("box_count" <= 240)) AND ("jsonb_array_length"("boxes") = "box_count"))),
    CONSTRAINT "beta_feedback_masked_layout_boxes_are_array" CHECK (("jsonb_typeof"("boxes") = 'array'::"text")),
    CONSTRAINT "beta_feedback_masked_layout_retention_valid" CHECK ((("expires_at" > "captured_at") AND ("expires_at" <= ("captured_at" + '30 days'::interval)))),
    CONSTRAINT "beta_feedback_masked_layout_viewport_valid" CHECK (((("viewport_width" >= 1) AND ("viewport_width" <= 20000)) AND (("viewport_height" >= 1) AND ("viewport_height" <= 20000))))
);


--
-- Name: beta_feedback_triage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."beta_feedback_triage" (
    "reference" "uuid" NOT NULL,
    "organization_pseudonym" character(64) NOT NULL,
    "actor_pseudonym" character(64) NOT NULL,
    "feedback_type" character varying(16) NOT NULL,
    "impact_code" character varying(32) NOT NULL,
    "route_key" character varying(80) NOT NULL,
    "viewport" character varying(16) NOT NULL,
    "reporter_role" character varying(32) NOT NULL,
    "delivery_state" character varying(16) NOT NULL,
    "provider_reference" character varying(64),
    "delivery_failure_code" character varying(48),
    "attachment_kind" character varying(32) NOT NULL,
    "attachment_captured_at" timestamp with time zone,
    "attachment_expires_at" timestamp with time zone,
    "triage_state" character varying(24) DEFAULT 'new'::character varying NOT NULL,
    "severity" character varying(16) DEFAULT 'unclassified'::character varying NOT NULL,
    "privacy_class" character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "security_class" character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "reproduction" character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    "dedupe_disposition" character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "duplicate_of_reference" "uuid",
    "owner_queue" character varying(24) DEFAULT 'beta_support'::character varying NOT NULL,
    "owner_pseudonym" character(64),
    "customer_response" character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    "engineering_issue_ref" character varying(200),
    "revision" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_error_event_id" character(32),
    CONSTRAINT "beta_feedback_triage_attachment_kind_valid" CHECK ((("attachment_kind")::"text" = ANY ((ARRAY['none'::character varying, 'masked_layout_v1'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_attachment_shape" CHECK ((((("attachment_kind")::"text" = 'none'::"text") AND ("attachment_captured_at" IS NULL) AND ("attachment_expires_at" IS NULL)) OR ((("attachment_kind")::"text" = 'masked_layout_v1'::"text") AND (("feedback_type")::"text" = 'bug'::"text") AND ("attachment_captured_at" IS NOT NULL) AND ("attachment_expires_at" > "attachment_captured_at") AND ("attachment_expires_at" <= ("attachment_captured_at" + '30 days'::interval))))),
    CONSTRAINT "beta_feedback_triage_classification_shape" CHECK (((("triage_state")::"text" = 'new'::"text") OR ((("severity")::"text" <> 'unclassified'::"text") AND (("privacy_class")::"text" <> 'pending'::"text") AND (("security_class")::"text" <> 'pending'::"text") AND ("owner_pseudonym" IS NOT NULL)))),
    CONSTRAINT "beta_feedback_triage_client_error_shape" CHECK ((("client_error_event_id" IS NULL) OR (("client_error_event_id" ~ '^[a-f0-9]{32}$'::"text") AND (("feedback_type")::"text" = 'bug'::"text")))),
    CONSTRAINT "beta_feedback_triage_customer_response_valid" CHECK ((("customer_response")::"text" = ANY ((ARRAY['pending'::character varying, 'not_required'::character varying, 'sent'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_decision_shape" CHECK (((("triage_state")::"text" <> ALL ((ARRAY['accepted'::character varying, 'declined'::character varying, 'resolved'::character varying])::"text"[])) OR ((("reproduction")::"text" <> 'pending'::"text") AND (("dedupe_disposition")::"text" <> 'pending'::"text")))),
    CONSTRAINT "beta_feedback_triage_dedupe_valid" CHECK (((("dedupe_disposition")::"text" = ANY ((ARRAY['pending'::character varying, 'unique'::character varying, 'duplicate'::character varying])::"text"[])) AND (((("dedupe_disposition")::"text" = 'duplicate'::"text") AND ("duplicate_of_reference" IS NOT NULL) AND ("duplicate_of_reference" <> "reference")) OR ((("dedupe_disposition")::"text" <> 'duplicate'::"text") AND ("duplicate_of_reference" IS NULL))))),
    CONSTRAINT "beta_feedback_triage_delivery_shape" CHECK ((((("delivery_state")::"text" = 'prepared'::"text") AND ("provider_reference" IS NULL) AND ("delivery_failure_code" IS NULL)) OR ((("delivery_state")::"text" = 'delivered'::"text") AND (("provider_reference")::"text" ~ '^[a-f0-9]{32,64}$'::"text") AND ("delivery_failure_code" IS NULL)) OR ((("delivery_state")::"text" = 'failed'::"text") AND ("provider_reference" IS NULL) AND (("delivery_failure_code")::"text" ~ '^[a-z][a-z0-9_]{0,47}$'::"text")))),
    CONSTRAINT "beta_feedback_triage_delivery_valid" CHECK ((("delivery_state")::"text" = ANY ((ARRAY['prepared'::character varying, 'delivered'::character varying, 'failed'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_feedback_type_valid" CHECK ((("feedback_type")::"text" = ANY ((ARRAY['bug'::character varying, 'suggestion'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_impact_valid" CHECK ((("impact_code")::"text" = ANY ((ARRAY['cannot_complete'::character varying, 'workaround_available'::character varying, 'small_issue'::character varying, 'important'::character varying, 'helpful'::character varying, 'nice_to_have'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_issue_ref_valid" CHECK ((("engineering_issue_ref" IS NULL) OR (("engineering_issue_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text"))),
    CONSTRAINT "beta_feedback_triage_issue_shape" CHECK ((("engineering_issue_ref" IS NULL) OR (("triage_state")::"text" = ANY ((ARRAY['accepted'::character varying, 'resolved'::character varying])::"text"[])))),
    CONSTRAINT "beta_feedback_triage_owner_valid" CHECK ((("owner_queue")::"text" = ANY ((ARRAY['beta_support'::character varying, 'privacy'::character varying, 'security'::character varying, 'engineering'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_privacy_owner_shape" CHECK (((("privacy_class")::"text" <> 'escalated'::"text") OR (("owner_queue")::"text" = ANY ((ARRAY['privacy'::character varying, 'security'::character varying])::"text"[])))),
    CONSTRAINT "beta_feedback_triage_privacy_valid" CHECK ((("privacy_class")::"text" = ANY ((ARRAY['pending'::character varying, 'clear'::character varying, 'restricted'::character varying, 'escalated'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_pseudonyms_valid" CHECK ((("organization_pseudonym" ~ '^[a-f0-9]{64}$'::"text") AND ("actor_pseudonym" ~ '^[a-f0-9]{64}$'::"text") AND (("owner_pseudonym" IS NULL) OR ("owner_pseudonym" ~ '^[a-f0-9]{64}$'::"text")))),
    CONSTRAINT "beta_feedback_triage_reporter_role_valid" CHECK ((("reporter_role")::"text" = ANY ((ARRAY['AccountAdmin'::character varying, 'PropertyManager'::character varying, 'Member'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_reproduction_valid" CHECK ((("reproduction")::"text" = ANY ((ARRAY['pending'::character varying, 'reproduced'::character varying, 'not_reproduced'::character varying, 'not_applicable'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_resolution_shape" CHECK (((("triage_state")::"text" <> 'resolved'::"text") OR (("customer_response")::"text" <> 'pending'::"text"))),
    CONSTRAINT "beta_feedback_triage_revision_nonnegative" CHECK (("revision" >= 0)),
    CONSTRAINT "beta_feedback_triage_security_owner_shape" CHECK (((("security_class")::"text" <> ALL ((ARRAY['suspected'::character varying, 'confirmed'::character varying])::"text"[])) OR (("owner_queue")::"text" = 'security'::"text"))),
    CONSTRAINT "beta_feedback_triage_security_valid" CHECK ((("security_class")::"text" = ANY ((ARRAY['pending'::character varying, 'none'::character varying, 'suspected'::character varying, 'confirmed'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_severity_valid" CHECK ((("severity")::"text" = ANY ((ARRAY['unclassified'::character varying, 'P0'::character varying, 'P1'::character varying, 'P2'::character varying, 'P3'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_state_valid" CHECK ((("triage_state")::"text" = ANY ((ARRAY['new'::character varying, 'screened'::character varying, 'reproducing'::character varying, 'accepted'::character varying, 'declined'::character varying, 'resolved'::character varying])::"text"[]))),
    CONSTRAINT "beta_feedback_triage_viewport_valid" CHECK ((("viewport")::"text" = ANY ((ARRAY['compact'::character varying, 'regular'::character varying, 'wide'::character varying])::"text"[])))
);


--
-- Name: beta_feedback_triage_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."beta_feedback_triage_transitions" (
    "transition_id" "uuid" NOT NULL,
    "feedback_reference" "uuid" NOT NULL,
    "from_state" character varying(24) NOT NULL,
    "to_state" character varying(24) NOT NULL,
    "result_revision" integer NOT NULL,
    "severity" character varying(16) NOT NULL,
    "privacy_class" character varying(16) NOT NULL,
    "security_class" character varying(16) NOT NULL,
    "reproduction" character varying(24) NOT NULL,
    "dedupe_disposition" character varying(16) NOT NULL,
    "duplicate_of_reference" "uuid",
    "owner_queue" character varying(24) NOT NULL,
    "owner_pseudonym" character(64),
    "customer_response" character varying(24) NOT NULL,
    "engineering_issue_ref" character varying(200),
    "operator_pseudonym" character(64) NOT NULL,
    "reason_code" character varying(64) NOT NULL,
    "support_evidence_ref" character varying(200) NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beta_feedback_triage_transition_classification_shape" CHECK (((("severity")::"text" = ANY ((ARRAY['unclassified'::character varying, 'P0'::character varying, 'P1'::character varying, 'P2'::character varying, 'P3'::character varying])::"text"[])) AND (("privacy_class")::"text" = ANY ((ARRAY['pending'::character varying, 'clear'::character varying, 'restricted'::character varying, 'escalated'::character varying])::"text"[])) AND (("security_class")::"text" = ANY ((ARRAY['pending'::character varying, 'none'::character varying, 'suspected'::character varying, 'confirmed'::character varying])::"text"[])) AND (("reproduction")::"text" = ANY ((ARRAY['pending'::character varying, 'reproduced'::character varying, 'not_reproduced'::character varying, 'not_applicable'::character varying])::"text"[])) AND (("owner_queue")::"text" = ANY ((ARRAY['beta_support'::character varying, 'privacy'::character varying, 'security'::character varying, 'engineering'::character varying])::"text"[])) AND (("customer_response")::"text" = ANY ((ARRAY['pending'::character varying, 'not_required'::character varying, 'sent'::character varying])::"text"[])) AND ((("to_state")::"text" = 'new'::"text") OR ((("severity")::"text" <> 'unclassified'::"text") AND (("privacy_class")::"text" <> 'pending'::"text") AND (("security_class")::"text" <> 'pending'::"text") AND ("owner_pseudonym" IS NOT NULL))))),
    CONSTRAINT "beta_feedback_triage_transition_decision_shape" CHECK (((("to_state")::"text" <> ALL ((ARRAY['accepted'::character varying, 'declined'::character varying, 'resolved'::character varying])::"text"[])) OR ((("reproduction")::"text" <> 'pending'::"text") AND (("dedupe_disposition")::"text" <> 'pending'::"text")))),
    CONSTRAINT "beta_feedback_triage_transition_dedupe_shape" CHECK (((("dedupe_disposition")::"text" = ANY ((ARRAY['pending'::character varying, 'unique'::character varying, 'duplicate'::character varying])::"text"[])) AND (((("dedupe_disposition")::"text" = 'duplicate'::"text") AND ("duplicate_of_reference" IS NOT NULL) AND ("duplicate_of_reference" <> "feedback_reference")) OR ((("dedupe_disposition")::"text" <> 'duplicate'::"text") AND ("duplicate_of_reference" IS NULL))))),
    CONSTRAINT "beta_feedback_triage_transition_issue_shape" CHECK ((("engineering_issue_ref" IS NULL) OR ((("engineering_issue_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text") AND (("to_state")::"text" = ANY ((ARRAY['accepted'::character varying, 'resolved'::character varying])::"text"[]))))),
    CONSTRAINT "beta_feedback_triage_transition_operator_valid" CHECK ((("operator_pseudonym" ~ '^[a-f0-9]{64}$'::"text") AND (("owner_pseudonym" IS NULL) OR ("owner_pseudonym" ~ '^[a-f0-9]{64}$'::"text")))),
    CONSTRAINT "beta_feedback_triage_transition_owner_shape" CHECK ((((("security_class")::"text" <> ALL ((ARRAY['suspected'::character varying, 'confirmed'::character varying])::"text"[])) OR (("owner_queue")::"text" = 'security'::"text")) AND ((("privacy_class")::"text" <> 'escalated'::"text") OR (("owner_queue")::"text" = ANY ((ARRAY['privacy'::character varying, 'security'::character varying])::"text"[]))))),
    CONSTRAINT "beta_feedback_triage_transition_reason_valid" CHECK (((("reason_code")::"text" ~ '^[a-z][a-z0-9_]{0,63}$'::"text") AND (("support_evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text"))),
    CONSTRAINT "beta_feedback_triage_transition_resolution_shape" CHECK (((("to_state")::"text" <> 'resolved'::"text") OR (("customer_response")::"text" <> 'pending'::"text"))),
    CONSTRAINT "beta_feedback_triage_transition_revision_positive" CHECK (("result_revision" > 0)),
    CONSTRAINT "beta_feedback_triage_transition_states_valid" CHECK (((("from_state")::"text" = ANY ((ARRAY['new'::character varying, 'screened'::character varying, 'reproducing'::character varying, 'accepted'::character varying, 'declined'::character varying, 'resolved'::character varying])::"text"[])) AND (("to_state")::"text" = ANY ((ARRAY['new'::character varying, 'screened'::character varying, 'reproducing'::character varying, 'accepted'::character varying, 'declined'::character varying, 'resolved'::character varying])::"text"[]))))
);


--
-- Name: capability_execution_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."capability_execution_control" (
    "capability" "public"."google_content_capability" NOT NULL,
    "denied" boolean DEFAULT true NOT NULL,
    "emergency_kill_version" bigint DEFAULT 0 NOT NULL,
    "denied_at" timestamp with time zone,
    "drained_at" timestamp with time zone,
    "cleanup_drained_at" timestamp with time zone,
    "operator_id" character varying(255),
    "reason" character varying(500),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "capability_execution_control_denied_check" CHECK ((("denied" AND ("denied_at" IS NOT NULL)) OR ((NOT "denied") AND ("denied_at" IS NULL) AND ("drained_at" IS NULL) AND ("cleanup_drained_at" IS NULL))))
);


--
-- Name: event_consumer_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."event_consumer_receipts" (
    "event_id" "uuid" NOT NULL,
    "consumer_name" "text" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "event_consumer_receipts_status_check" CHECK (("status" = ANY (ARRAY['applied'::"text", 'duplicate'::"text", 'obsolete'::"text"])))
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "property_id" character varying(255) NOT NULL,
    "session_id" character varying(255),
    "rating_id" "uuid",
    "comment" "text" NOT NULL,
    "source" character varying(10) NOT NULL,
    "ip_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: goal_month_target_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."goal_month_target_changes" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "program_id" "uuid" NOT NULL,
    "monthly_result_id" "uuid" NOT NULL,
    "change_id" "uuid" NOT NULL,
    "previous_target_value" numeric(30,10) NOT NULL,
    "new_target_value" numeric(30,10) NOT NULL,
    "following_outcome" character varying(32) NOT NULL,
    "following_reason" character varying(40),
    "following_version_id" "uuid",
    "note" "text",
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_source" character varying(16),
    CONSTRAINT "goal_month_target_changes_note_check" CHECK ((("note" IS NULL) OR (("char_length"("btrim"("note")) >= 1) AND ("char_length"("btrim"("note")) <= 500)))),
    CONSTRAINT "goal_month_target_changes_outcome_check" CHECK ((("following_outcome")::"text" = ANY ((ARRAY['applied'::character varying, 'replaced_scheduled_change'::character varying, 'kept_scheduled_change'::character varying, 'not_applied'::character varying, 'not_requested'::character varying])::"text"[]))),
    CONSTRAINT "goal_month_target_changes_target_source_check" CHECK ((("target_source" IS NULL) OR (("target_source")::"text" = ANY ((ARRAY['recommended'::character varying, 'own'::character varying])::"text"[])))),
    CONSTRAINT "goal_month_target_changes_value_check" CHECK ((("new_target_value" > (0)::numeric) AND ("new_target_value" <> "previous_target_value")))
);


--
-- Name: goal_monthly_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."goal_monthly_results" (
    "id" "uuid" NOT NULL,
    "assignment_id" "uuid" NOT NULL,
    "program_id" "uuid" NOT NULL,
    "program_version_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "period_start" timestamp with time zone NOT NULL,
    "period_end" timestamp with time zone NOT NULL,
    "property_timezone" character varying(64) NOT NULL,
    "status" character varying(24) DEFAULT 'open'::character varying NOT NULL,
    "evaluation_state" character varying(24) DEFAULT 'updating'::character varying NOT NULL,
    "value" numeric(30,10),
    "sample_count" integer DEFAULT 0 NOT NULL,
    "achieved" boolean,
    "reason" "text",
    "source_complete_through" timestamp with time zone,
    "evaluation_watermark" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_value" numeric(30,10),
    CONSTRAINT "goal_monthly_results_bounds_check" CHECK (("period_end" > "period_start")),
    CONSTRAINT "goal_monthly_results_closed_check" CHECK ((((("status")::"text" = 'closed'::"text") AND ("closed_at" IS NOT NULL) AND ("evaluation_watermark" IS NOT NULL) AND (("evaluation_state")::"text" <> 'updating'::"text")) OR ((("status")::"text" <> 'closed'::"text") AND ("closed_at" IS NULL)))),
    CONSTRAINT "goal_monthly_results_sample_check" CHECK (("sample_count" >= 0)),
    CONSTRAINT "goal_monthly_results_source_check" CHECK (((("source_complete_through" IS NULL) OR ("source_complete_through" <= "period_end")) AND ((("status")::"text" <> 'closed'::"text") OR (("evaluation_state")::"text" <> ALL ((ARRAY['eligible'::character varying, 'insufficient_data'::character varying])::"text"[])) OR ("source_complete_through" = "period_end")))),
    CONSTRAINT "goal_monthly_results_state_check" CHECK ((("evaluation_state")::"text" = ANY ((ARRAY['eligible'::character varying, 'updating'::character varying, 'insufficient_data'::character varying, 'unavailable'::character varying, 'quarantined'::character varying])::"text"[]))),
    CONSTRAINT "goal_monthly_results_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['open'::character varying, 'reconciling'::character varying, 'closed'::character varying])::"text"[]))),
    CONSTRAINT "goal_monthly_results_target_value_check" CHECK ((("target_value" IS NULL) OR ("target_value" > (0)::numeric))),
    CONSTRAINT "goal_monthly_results_value_state_check" CHECK ((((("evaluation_state")::"text" = 'eligible'::"text") AND ("value" IS NOT NULL) AND ("achieved" IS NOT NULL) AND ("reason" IS NULL)) OR ((("evaluation_state")::"text" <> 'eligible'::"text") AND ("achieved" IS NULL))))
);


--
-- Name: goal_program_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."goal_program_versions" (
    "id" "uuid" NOT NULL,
    "program_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "metric_definition_id" "uuid" NOT NULL,
    "metric_definition_version_id" "uuid" NOT NULL,
    "metric_key" character varying(40) NOT NULL,
    "metric_minimum_sample" integer NOT NULL,
    "target_value" numeric(30,10) NOT NULL,
    "property_timezone" character varying(64) NOT NULL,
    "effective_from" timestamp with time zone NOT NULL,
    "effective_to" timestamp with time zone,
    "change_reason" "text" NOT NULL,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_source" character varying(16),
    CONSTRAINT "goal_program_versions_effective_check" CHECK ((("effective_to" IS NULL) OR ("effective_to" >= "effective_from"))),
    CONSTRAINT "goal_program_versions_metric_check" CHECK ((("metric_key")::"text" = ANY ((ARRAY['qualified_scans'::character varying, 'portal_rating_count'::character varying, 'portal_rating_average'::character varying])::"text"[]))),
    CONSTRAINT "goal_program_versions_metric_version_check" CHECK ((((("metric_key")::"text" = 'qualified_scans'::"text") AND ("metric_definition_version_id" = '11111111-1111-4111-8111-111111111301'::"uuid")) OR ((("metric_key")::"text" = 'portal_rating_count'::"text") AND ("metric_definition_version_id" = '11111111-1111-4111-8111-111111111302'::"uuid")) OR ((("metric_key")::"text" = 'portal_rating_average'::"text") AND ("metric_definition_version_id" = '11111111-1111-4111-8111-111111111303'::"uuid")))),
    CONSTRAINT "goal_program_versions_reason_check" CHECK (("length"("btrim"("change_reason")) > 0)),
    CONSTRAINT "goal_program_versions_sample_check" CHECK ((((("metric_key")::"text" = ANY ((ARRAY['qualified_scans'::character varying, 'portal_rating_count'::character varying])::"text"[])) AND ("metric_minimum_sample" = 0)) OR ((("metric_key")::"text" = 'portal_rating_average'::"text") AND ("metric_minimum_sample" = 10)))),
    CONSTRAINT "goal_program_versions_target_check" CHECK ((((("metric_key")::"text" = ANY ((ARRAY['qualified_scans'::character varying, 'portal_rating_count'::character varying])::"text"[])) AND ("target_value" > (0)::numeric) AND ("target_value" = "trunc"("target_value"))) OR ((("metric_key")::"text" = 'portal_rating_average'::"text") AND (("target_value" >= (1)::numeric) AND ("target_value" <= (5)::numeric)) AND (("target_value" * (10)::numeric) = "trunc"(("target_value" * (10)::numeric)))))),
    CONSTRAINT "goal_program_versions_target_source_check" CHECK ((("target_source" IS NULL) OR (("target_source")::"text" = ANY ((ARRAY['recommended'::character varying, 'own'::character varying])::"text"[])))),
    CONSTRAINT "goal_program_versions_timezone_check" CHECK (("length"("btrim"(("property_timezone")::"text")) > 0)),
    CONSTRAINT "goal_program_versions_version_check" CHECK (("version" >= 1))
);


--
-- Name: goal_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."goal_programs" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "name" character varying(200) NOT NULL,
    "description" "text",
    "status" character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    "status_reason" "text",
    "current_version" integer DEFAULT 1 NOT NULL,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "check_in_answered_month" character varying(7),
    "ended_at" timestamp with time zone,
    "ended_by" character varying(255),
    CONSTRAINT "goal_programs_check_in_answered_month_check" CHECK ((("check_in_answered_month" IS NULL) OR (("check_in_answered_month")::"text" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::"text"))),
    CONSTRAINT "goal_programs_ended_record_check" CHECK (((("ended_at" IS NULL) = ("ended_by" IS NULL)) AND (("ended_at" IS NULL) OR (("status")::"text" = 'ended'::"text")))),
    CONSTRAINT "goal_programs_name_check" CHECK (("length"("btrim"(("name")::"text")) > 0)),
    CONSTRAINT "goal_programs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['scheduled'::character varying, 'active'::character varying, 'paused'::character varying, 'ended'::character varying])::"text"[]))),
    CONSTRAINT "goal_programs_version_check" CHECK (("current_version" >= 1))
);


--
-- Name: goal_result_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."goal_result_revisions" (
    "id" "uuid" NOT NULL,
    "monthly_result_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "revision" integer NOT NULL,
    "supersedes_revision_id" "uuid",
    "evaluation_state" character varying(24) NOT NULL,
    "value" numeric(30,10),
    "sample_count" integer NOT NULL,
    "achieved" boolean,
    "reason" "text",
    "source_complete_through" timestamp with time zone,
    "evaluation_watermark" timestamp with time zone NOT NULL,
    "change_reason" "text" NOT NULL,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "goal_result_revisions_reason_check" CHECK (("length"("btrim"("change_reason")) > 0)),
    CONSTRAINT "goal_result_revisions_revision_check" CHECK (("revision" >= 1)),
    CONSTRAINT "goal_result_revisions_sample_check" CHECK (("sample_count" >= 0)),
    CONSTRAINT "goal_result_revisions_state_check" CHECK ((("evaluation_state")::"text" = ANY ((ARRAY['eligible'::character varying, 'insufficient_data'::character varying, 'unavailable'::character varying, 'quarantined'::character varying])::"text"[]))),
    CONSTRAINT "goal_result_revisions_value_state_check" CHECK ((((("evaluation_state")::"text" = 'eligible'::"text") AND ("value" IS NOT NULL) AND ("achieved" IS NOT NULL) AND ("reason" IS NULL)) OR ((("evaluation_state")::"text" <> 'eligible'::"text") AND ("achieved" IS NULL))))
);


--
-- Name: goal_subject_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."goal_subject_assignments" (
    "id" "uuid" NOT NULL,
    "program_id" "uuid" NOT NULL,
    "program_version_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "metric_key" character varying(40) NOT NULL,
    "subject_kind" character varying(24) NOT NULL,
    "property_subject_id" "uuid",
    "portal_group_id" "uuid",
    "portal_id" "uuid",
    "effective_from" timestamp with time zone NOT NULL,
    "effective_to" timestamp with time zone,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "goal_subject_assignments_effective_check" CHECK ((("effective_to" IS NULL) OR ("effective_to" >= "effective_from"))),
    CONSTRAINT "goal_subject_assignments_metric_check" CHECK ((("metric_key")::"text" = ANY ((ARRAY['qualified_scans'::character varying, 'portal_rating_count'::character varying, 'portal_rating_average'::character varying])::"text"[]))),
    CONSTRAINT "goal_subject_assignments_subject_check" CHECK ((((("subject_kind")::"text" = 'property'::"text") AND ("property_subject_id" = "property_id") AND ("portal_group_id" IS NULL) AND ("portal_id" IS NULL)) OR ((("subject_kind")::"text" = 'portal_group'::"text") AND ("property_subject_id" IS NULL) AND ("portal_group_id" IS NOT NULL) AND ("portal_id" IS NULL)) OR ((("subject_kind")::"text" = 'portal'::"text") AND ("property_subject_id" IS NULL) AND ("portal_group_id" IS NULL) AND ("portal_id" IS NOT NULL))))
);


--
-- Name: google_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."google_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "google_subject" character varying(255),
    "encrypted_access_token" "text" NOT NULL,
    "encrypted_refresh_token" "text" NOT NULL,
    "token_expires_at" timestamp with time zone NOT NULL,
    "scopes" "text"[] NOT NULL,
    "connected_by" character varying(255) NOT NULL,
    "credential_authorized_by" character varying(255),
    "credential_authorized_at" timestamp with time zone,
    "visibility" "public"."connection_visibility" DEFAULT 'organization'::"public"."connection_visibility" NOT NULL,
    "status" "public"."connection_status" DEFAULT 'active'::"public"."connection_status" NOT NULL,
    "credential_use_state" "public"."google_credential_use_state" DEFAULT 'active'::"public"."google_credential_use_state" NOT NULL,
    "cleanup_material_deadline_at" timestamp with time zone,
    "lifecycle_version" integer DEFAULT 1 NOT NULL,
    "access_version" integer DEFAULT 1 NOT NULL,
    "credential_generation" integer DEFAULT 1 NOT NULL,
    "encryption_key_id" character varying(50) DEFAULT 'v1'::character varying NOT NULL,
    "last_successful_sync_at" timestamp with time zone,
    "status_reason" "text",
    "status_changed_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "google_account_email" character varying(320),
    CONSTRAINT "google_connections_account_email_check" CHECK ((("google_account_email" IS NULL) OR ("google_subject" IS NOT NULL))),
    CONSTRAINT "google_connections_identity_check" CHECK ((("google_subject" IS NOT NULL) OR ("status" = 'disconnected'::"public"."connection_status"))),
    CONSTRAINT "google_connections_organization_owned_check" CHECK (("visibility" = 'organization'::"public"."connection_visibility")),
    CONSTRAINT "google_connections_versions_check" CHECK ((("lifecycle_version" >= 1) AND ("access_version" >= 1) AND ("credential_generation" >= 1)))
);


--
-- Name: google_import_discovery_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."google_import_discovery_records" (
    "reference_key" character varying(43) NOT NULL,
    "key_version" character varying(32) NOT NULL,
    "audience" character varying(32) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "connection_lifecycle_version" integer NOT NULL,
    "connection_access_version" integer NOT NULL,
    "credential_generation" integer NOT NULL,
    "authorization_vector" "jsonb" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "affected_property_id" "uuid",
    "remaining_redemptions" integer,
    "claim_request_id" "uuid",
    "claimed_at" timestamp with time zone,
    "issued_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "google_import_discovery_records_audience_valid" CHECK ((("audience")::"text" = ANY ((ARRAY['account_selection'::character varying, 'accounts_cursor'::character varying, 'locations_cursor'::character varying, 'import_candidate'::character varying])::"text"[]))),
    CONSTRAINT "google_import_discovery_records_claim_valid" CHECK (((("claim_request_id" IS NULL) AND ("claimed_at" IS NULL)) OR ((("audience")::"text" = 'import_candidate'::"text") AND ("claim_request_id" IS NOT NULL) AND ("claimed_at" IS NOT NULL)))),
    CONSTRAINT "google_import_discovery_records_cursor_budget_valid" CHECK ((((("audience")::"text" = ANY ((ARRAY['accounts_cursor'::character varying, 'locations_cursor'::character varying])::"text"[])) AND (("remaining_redemptions" >= 0) AND ("remaining_redemptions" <= 50))) OR ((("audience")::"text" <> ALL ((ARRAY['accounts_cursor'::character varying, 'locations_cursor'::character varying])::"text"[])) AND ("remaining_redemptions" IS NULL)))),
    CONSTRAINT "google_import_discovery_records_key_valid" CHECK (((("reference_key")::"text" ~ '^[A-Za-z0-9_-]{43}$'::"text") AND (("key_version")::"text" ~ '^[a-z][a-z0-9_-]{0,31}$'::"text"))),
    CONSTRAINT "google_import_discovery_records_versions_valid" CHECK ((("connection_lifecycle_version" >= 1) AND ("connection_access_version" >= 1) AND ("credential_generation" >= 1))),
    CONSTRAINT "google_import_discovery_records_window_valid" CHECK ((("expires_at" > "issued_at") AND ("expires_at" <= ("issued_at" + '24:00:00'::interval))))
);


--
-- Name: google_import_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."google_import_items" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "import_id" "uuid" NOT NULL,
    "connection_id" "uuid",
    "existing_property_id" "uuid",
    "destination_property_id" "uuid",
    "provider_account_suffix" character varying(255),
    "provider_location_suffix" character varying(255),
    "google_review_uri" character varying(2048),
    "google_primary_category" character varying(512),
    "expected_connection_lifecycle_version" integer,
    "expected_connection_access_version" integer,
    "expected_credential_generation" integer,
    "expected_execution_policy_version" character varying(32),
    "expected_actor_role" character varying(50),
    "expected_permission_digest" character varying(64),
    "expected_principal_kind" character varying(32),
    "expected_permission_version" integer,
    "expected_source_epoch" integer,
    "expected_profile_version" integer,
    "action" "public"."google_import_v2_action" NOT NULL,
    "update_existing_profile" boolean NOT NULL,
    "property_name" character varying(100) NOT NULL,
    "property_address" "text",
    "country_code" character varying(2),
    "timezone" character varying(64) NOT NULL,
    "status" "public"."google_import_v2_item_status" DEFAULT 'pending'::"public"."google_import_v2_item_status" NOT NULL,
    "outcome_code" "public"."google_import_v2_outcome",
    "invalid_profile_field" character varying(16),
    "effect_deadline_at" timestamp with time zone NOT NULL,
    "retry_revision" integer DEFAULT 0 NOT NULL,
    "dispatch_epoch" integer DEFAULT 0 NOT NULL,
    "next_dispatch_at" timestamp with time zone,
    "highest_attempt_for_revision" integer DEFAULT 0 NOT NULL,
    "claim_fence" "uuid",
    "claim_lease_expires_at" timestamp with time zone,
    "first_terminal_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "google_import_items_appointment_valid" CHECK ((("status" = ANY (ARRAY['pending'::"public"."google_import_v2_item_status", 'processing'::"public"."google_import_v2_item_status"])) = ("next_dispatch_at" IS NOT NULL))),
    CONSTRAINT "google_import_items_attempt_fence_valid" CHECK (((("highest_attempt_for_revision" >= 0) AND ("highest_attempt_for_revision" <= 5)) AND (("claim_fence" IS NULL) = ("claim_lease_expires_at" IS NULL)) AND (("status" = 'processing'::"public"."google_import_v2_item_status") = ("claim_fence" IS NOT NULL)) AND (("status" <> 'processing'::"public"."google_import_v2_item_status") OR (("claim_fence" IS NOT NULL) AND (("highest_attempt_for_revision" >= 1) AND ("highest_attempt_for_revision" <= 5)))))),
    CONSTRAINT "google_import_items_authorization_snapshot_valid" CHECK (((("expected_execution_policy_version" IS NULL) AND ("expected_actor_role" IS NULL) AND ("expected_permission_digest" IS NULL) AND ("expected_principal_kind" IS NULL) AND ("expected_permission_version" IS NULL)) OR ((("char_length"(("expected_execution_policy_version")::"text") >= 1) AND ("char_length"(("expected_execution_policy_version")::"text") <= 32)) AND (("char_length"(("expected_actor_role")::"text") >= 1) AND ("char_length"(("expected_actor_role")::"text") <= 50)) AND (("expected_permission_digest")::"text" ~ '^[a-f0-9]{64}$'::"text") AND (("char_length"(("expected_principal_kind")::"text") >= 1) AND ("char_length"(("expected_principal_kind")::"text") <= 32)) AND ("expected_permission_version" >= 0)))),
    CONSTRAINT "google_import_items_checkpoint_state_valid" CHECK (((((("status" = ANY (ARRAY['pending'::"public"."google_import_v2_item_status", 'processing'::"public"."google_import_v2_item_status"])) OR ("outcome_code" = 'temporarily_unavailable'::"public"."google_import_v2_outcome")) AND ("connection_id" IS NOT NULL) AND ("provider_account_suffix" IS NOT NULL) AND ("provider_location_suffix" IS NOT NULL) AND ("expected_connection_lifecycle_version" IS NOT NULL) AND ("expected_connection_access_version" IS NOT NULL) AND ("expected_credential_generation" IS NOT NULL) AND ("expected_execution_policy_version" IS NOT NULL) AND ("expected_actor_role" IS NOT NULL) AND ("expected_permission_digest" IS NOT NULL) AND ("expected_principal_kind" IS NOT NULL) AND ("expected_permission_version" IS NOT NULL)) OR (("status" <> ALL (ARRAY['pending'::"public"."google_import_v2_item_status", 'processing'::"public"."google_import_v2_item_status"])) AND ("outcome_code" <> 'temporarily_unavailable'::"public"."google_import_v2_outcome") AND ("connection_id" IS NULL) AND ("provider_account_suffix" IS NULL) AND ("provider_location_suffix" IS NULL) AND ("google_review_uri" IS NULL) AND ("google_primary_category" IS NULL) AND ("expected_connection_lifecycle_version" IS NULL) AND ("expected_connection_access_version" IS NULL) AND ("expected_credential_generation" IS NULL) AND ("expected_execution_policy_version" IS NULL) AND ("expected_actor_role" IS NULL) AND ("expected_permission_digest" IS NULL) AND ("expected_principal_kind" IS NULL) AND ("expected_permission_version" IS NULL))) IS TRUE)),
    CONSTRAINT "google_import_items_deadline_valid" CHECK (("effect_deadline_at" = ("created_at" + '24:00:00'::interval))),
    CONSTRAINT "google_import_items_dispatch_epoch_valid" CHECK (("dispatch_epoch" >= 0)),
    CONSTRAINT "google_import_items_generations_valid" CHECK ((((("expected_connection_lifecycle_version" >= 1) AND ("expected_connection_access_version" >= 1) AND ("expected_credential_generation" >= 1)) OR (("status" <> ALL (ARRAY['pending'::"public"."google_import_v2_item_status", 'processing'::"public"."google_import_v2_item_status"])) AND ("outcome_code" <> 'temporarily_unavailable'::"public"."google_import_v2_outcome") AND ("expected_connection_lifecycle_version" IS NULL) AND ("expected_connection_access_version" IS NULL) AND ("expected_credential_generation" IS NULL))) AND ("retry_revision" >= 0))),
    CONSTRAINT "google_import_items_google_primary_category_valid" CHECK ((("google_primary_category" IS NULL) OR ((("char_length"(("google_primary_category")::"text") >= 1) AND ("char_length"(("google_primary_category")::"text") <= 512)) AND (("google_primary_category")::"text" = "btrim"(("google_primary_category")::"text"))))),
    CONSTRAINT "google_import_items_google_review_uri_valid" CHECK ((("google_review_uri" IS NULL) OR (("google_review_uri")::"text" ~ '^https://'::"text"))),
    CONSTRAINT "google_import_items_invalid_profile_field_valid" CHECK ((((("invalid_profile_field" IS NULL) AND (("outcome_code" IS NULL) OR (("outcome_code")::"text" <> 'tenant_profile_invalid'::"text"))) OR ((("outcome_code")::"text" = 'tenant_profile_invalid'::"text") AND (("invalid_profile_field")::"text" = ANY ((ARRAY['name'::character varying, 'timezone'::character varying, 'country'::character varying])::"text"[])))) IS TRUE)),
    CONSTRAINT "google_import_items_profile_valid" CHECK ((((("char_length"("btrim"(("property_name")::"text")) >= 1) AND ("char_length"("btrim"(("property_name")::"text")) <= 100)) AND (("char_length"(("timezone")::"text") >= 1) AND ("char_length"(("timezone")::"text") <= 64)) AND (("country_code" IS NULL) OR (("country_code")::"text" ~ '^[A-Z]{2}$'::"text")) AND ((("action" = 'create'::"public"."google_import_v2_action") AND ("existing_property_id" IS NULL) AND ("destination_property_id" IS NOT NULL) AND ("country_code" IS NOT NULL) AND ("update_existing_profile" = true) AND ("expected_source_epoch" IS NULL) AND ("expected_profile_version" IS NULL)) OR (("action" = 'relink'::"public"."google_import_v2_action") AND ("existing_property_id" IS NOT NULL) AND ("destination_property_id" = "existing_property_id") AND ("expected_source_epoch" >= 0) AND ("expected_profile_version" >= 1)) OR (("status" <> ALL (ARRAY['pending'::"public"."google_import_v2_item_status", 'processing'::"public"."google_import_v2_item_status"])) AND ("outcome_code" <> 'temporarily_unavailable'::"public"."google_import_v2_outcome") AND ("existing_property_id" IS NULL) AND (("status" = ANY (ARRAY['imported'::"public"."google_import_v2_item_status", 'relinked'::"public"."google_import_v2_item_status", 'already_exists'::"public"."google_import_v2_item_status"])) OR ("destination_property_id" IS NULL)) AND ("expected_source_epoch" IS NULL) AND ("expected_profile_version" IS NULL)))) IS TRUE)),
    CONSTRAINT "google_import_items_provider_reference_retention_valid" CHECK (((("status" = ANY (ARRAY['pending'::"public"."google_import_v2_item_status", 'processing'::"public"."google_import_v2_item_status"])) AND ("connection_id" IS NOT NULL) AND ("provider_account_suffix" IS NOT NULL) AND ("provider_location_suffix" IS NOT NULL)) OR (("status" <> ALL (ARRAY['pending'::"public"."google_import_v2_item_status", 'processing'::"public"."google_import_v2_item_status"])) AND (("provider_account_suffix" IS NULL) = ("provider_location_suffix" IS NULL))))),
    CONSTRAINT "google_import_items_provider_suffix_valid" CHECK (((("provider_account_suffix" IS NULL) OR (("provider_account_suffix")::"text" !~ '[/?#[:space:][:cntrl:]]'::"text")) AND (("provider_location_suffix" IS NULL) OR (("provider_location_suffix")::"text" !~ '[/?#[:space:][:cntrl:]]'::"text")))),
    CONSTRAINT "google_import_items_status_outcome_valid" CHECK (((("status" = ANY (ARRAY['pending'::"public"."google_import_v2_item_status", 'processing'::"public"."google_import_v2_item_status"])) AND ("outcome_code" IS NULL)) OR (("status" = 'imported'::"public"."google_import_v2_item_status") AND ("outcome_code" = 'imported'::"public"."google_import_v2_outcome")) OR (("status" = 'relinked'::"public"."google_import_v2_item_status") AND ("outcome_code" = 'relinked'::"public"."google_import_v2_outcome")) OR (("status" = 'already_exists'::"public"."google_import_v2_item_status") AND ("outcome_code" = 'already_exists'::"public"."google_import_v2_outcome")) OR (("status" = 'failed'::"public"."google_import_v2_item_status") AND (("outcome_code")::"text" = ANY (ARRAY['active_binding_conflict'::"text", 'stale_binding'::"text", 'reauthentication_required'::"text", 'reconnect_required'::"text", 'temporarily_unavailable'::"text", 'cleanup_required'::"text", 'internal_error'::"text", 'tenant_profile_invalid'::"text"]))) OR (("status" = 'cancelled'::"public"."google_import_v2_item_status") AND (("outcome_code")::"text" = ANY (ARRAY['authorization_changed'::"text", 'user_cancelled'::"text", 'policy_disabled'::"text", 'organization_suspended'::"text", 'property_suspended'::"text", 'property_deleted'::"text"]))))),
    CONSTRAINT "google_import_items_terminal_valid" CHECK ((("outcome_code" IS NULL) OR ("first_terminal_at" IS NOT NULL)))
);


--
-- Name: google_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."google_imports" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "request_id" "uuid" NOT NULL,
    "initiated_by" character varying(255) NOT NULL,
    "total_count" integer NOT NULL,
    "wire_replay_key_version" character varying(32) NOT NULL,
    "wire_replay_digest" character varying(43) NOT NULL,
    "semantic_replay_key_version" character varying(32) NOT NULL,
    "semantic_replay_digest" character varying(43) NOT NULL,
    "deletion_fence" integer DEFAULT 0 NOT NULL,
    "first_terminal_at" timestamp with time zone,
    "purge_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "google_imports_counts_valid" CHECK ((("total_count" >= 1) AND ("deletion_fence" >= 0))),
    CONSTRAINT "google_imports_replay_encoding_valid" CHECK (((("wire_replay_key_version")::"text" ~ '^[a-z][a-z0-9_-]{0,31}$'::"text") AND (("semantic_replay_key_version")::"text" ~ '^[a-z][a-z0-9_-]{0,31}$'::"text") AND (("wire_replay_digest")::"text" ~ '^[A-Za-z0-9_-]{43}$'::"text") AND (("semantic_replay_digest")::"text" ~ '^[A-Za-z0-9_-]{43}$'::"text"))),
    CONSTRAINT "google_imports_terminal_times_valid" CHECK (((("first_terminal_at" IS NULL) = ("purge_at" IS NULL)) AND (("first_terminal_at" IS NULL) OR ("purge_at" = ("first_terminal_at" + '30 days'::interval)))))
);


--
-- Name: google_notification_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."google_notification_accounts" (
    "account_key" character varying(64) NOT NULL,
    "attempted_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "configuration" "text"
);


--
-- Name: google_reply_observation_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."google_reply_observation_heads" (
    "review_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "observation_id" "uuid" NOT NULL,
    "observation_revision" bigint NOT NULL,
    "source_epoch" integer NOT NULL,
    "material_review_revision" bigint NOT NULL,
    "state" character varying(16) NOT NULL,
    "provenance" character varying(32) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "google_reply_observation_heads_provenance_valid" CHECK ((("provenance")::"text" = ANY ((ARRAY['repkey_confirmed'::character varying, 'external_or_unknown'::character varying, 'none'::character varying])::"text"[]))),
    CONSTRAINT "google_reply_observation_heads_revisions_safe" CHECK (((("observation_revision" >= 1) AND ("observation_revision" <= '9007199254740991'::bigint)) AND (("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("material_review_revision" >= 1) AND ("material_review_revision" <= '9007199254740991'::bigint)))),
    CONSTRAINT "google_reply_observation_heads_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['live'::character varying, 'absent'::character varying])::"text"[])))
);


--
-- Name: google_reply_observation_read_generation_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."google_reply_observation_read_generation_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 9007199254740991
    CACHE 1;


--
-- Name: google_reply_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."google_reply_observations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "observation_revision" bigint NOT NULL,
    "observation_key" character varying(64) NOT NULL,
    "input_digest" character varying(64) NOT NULL,
    "source_epoch" integer NOT NULL,
    "material_review_revision" bigint NOT NULL,
    "read_generation" bigint NOT NULL,
    "state" character varying(16) NOT NULL,
    "change" character varying(16) NOT NULL,
    "resolution" character varying(32) NOT NULL,
    "source" character varying(32) NOT NULL,
    "provenance" character varying(32) NOT NULL,
    "normalized_text" "text",
    "normalization_version" character varying(64) NOT NULL,
    "normalized_digest" character varying(64),
    "matched_reply_id" "uuid",
    "matched_publication_cycle" bigint,
    "matched_attempt_number" integer,
    "provider_updated_at" timestamp with time zone,
    "observed_at" timestamp with time zone NOT NULL,
    "content_expires_at" timestamp with time zone NOT NULL,
    "content_state" character varying(24) DEFAULT 'active'::character varying NOT NULL,
    "content_erased_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "google_reply_observations_change_valid" CHECK ((("change")::"text" = ANY ((ARRAY['added'::character varying, 'edited'::character varying, 'deleted'::character varying, 'unchanged'::character varying])::"text"[]))),
    CONSTRAINT "google_reply_observations_content_valid" CHECK ((((("content_state")::"text" = 'active'::"text") AND ("content_erased_at" IS NULL) AND (("normalization_version")::"text" = 'google-reply-v1'::"text") AND (((("state")::"text" = 'live'::"text") AND ("normalized_text" IS NOT NULL) AND (("normalized_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")) OR ((("state")::"text" = 'absent'::"text") AND ("normalized_text" IS NULL) AND ("normalized_digest" IS NULL)))) OR ((("content_state")::"text" = ANY ((ARRAY['source_expired'::character varying, 'provider_deleted'::character varying])::"text"[])) AND ("content_erased_at" IS NOT NULL) AND ("normalized_text" IS NULL) AND ("normalized_digest" IS NULL)))),
    CONSTRAINT "google_reply_observations_identity_valid" CHECK (((("observation_key")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("input_digest")::"text" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "google_reply_observations_match_valid" CHECK ((((("resolution")::"text" = 'confirmed_on_google'::"text") AND (("provenance")::"text" = 'repkey_confirmed'::"text") AND ("matched_reply_id" IS NOT NULL) AND ("matched_publication_cycle" IS NOT NULL) AND ("matched_attempt_number" IS NOT NULL)) OR ((("resolution")::"text" <> 'confirmed_on_google'::"text") AND (("provenance")::"text" <> 'repkey_confirmed'::"text") AND ("matched_reply_id" IS NULL) AND ("matched_publication_cycle" IS NULL) AND ("matched_attempt_number" IS NULL)))),
    CONSTRAINT "google_reply_observations_provenance_valid" CHECK ((("provenance")::"text" = ANY ((ARRAY['repkey_confirmed'::character varying, 'external_or_unknown'::character varying, 'none'::character varying])::"text"[]))),
    CONSTRAINT "google_reply_observations_resolution_valid" CHECK ((("resolution")::"text" = ANY ((ARRAY['confirmed_on_google'::character varying, 'external_current_live'::character varying, 'diverged'::character varying, 'absent'::character varying, 'unchanged'::character varying])::"text"[]))),
    CONSTRAINT "google_reply_observations_revisions_safe" CHECK (((("observation_revision" >= 1) AND ("observation_revision" <= '9007199254740991'::bigint)) AND (("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("material_review_revision" >= 1) AND ("material_review_revision" <= '9007199254740991'::bigint)) AND (("read_generation" >= 1) AND ("read_generation" <= '9007199254740991'::bigint)))),
    CONSTRAINT "google_reply_observations_semantics_valid" CHECK ((((("resolution")::"text" = 'confirmed_on_google'::"text") AND (("state")::"text" = 'live'::"text") AND (("change")::"text" <> 'deleted'::"text") AND (("provenance")::"text" = 'repkey_confirmed'::"text") AND ("matched_reply_id" IS NOT NULL) AND ("matched_publication_cycle" IS NOT NULL) AND ("matched_attempt_number" IS NOT NULL)) OR ((("resolution")::"text" = 'external_current_live'::"text") AND (("state")::"text" = 'live'::"text") AND (("change")::"text" <> 'deleted'::"text") AND (("provenance")::"text" = 'external_or_unknown'::"text") AND ("matched_reply_id" IS NULL) AND ("matched_publication_cycle" IS NULL) AND ("matched_attempt_number" IS NULL)) OR ((("resolution")::"text" = 'diverged'::"text") AND (("state")::"text" = 'live'::"text") AND (("change")::"text" <> 'deleted'::"text") AND (("provenance")::"text" = 'external_or_unknown'::"text") AND ("matched_reply_id" IS NULL) AND ("matched_publication_cycle" IS NULL) AND ("matched_attempt_number" IS NULL)) OR ((("resolution")::"text" = 'absent'::"text") AND (("state")::"text" = 'absent'::"text") AND (("change")::"text" = 'deleted'::"text") AND (("provenance")::"text" = 'none'::"text") AND ("matched_reply_id" IS NULL) AND ("matched_publication_cycle" IS NULL) AND ("matched_attempt_number" IS NULL)) OR ((("resolution")::"text" = 'unchanged'::"text") AND (("change")::"text" = 'unchanged'::"text") AND (((("state")::"text" = 'absent'::"text") AND (("provenance")::"text" = 'none'::"text")) OR ((("state")::"text" = 'live'::"text") AND (("provenance")::"text" = 'external_or_unknown'::"text"))) AND ("matched_reply_id" IS NULL) AND ("matched_publication_cycle" IS NULL) AND ("matched_attempt_number" IS NULL)))),
    CONSTRAINT "google_reply_observations_source_valid" CHECK ((("source")::"text" = ANY ((ARRAY['provider_snapshot'::character varying, 'targeted_reconciliation'::character varying])::"text"[]))),
    CONSTRAINT "google_reply_observations_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['live'::character varying, 'absent'::character varying])::"text"[])))
);


--
-- Name: guest_contact_request_reveal_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_contact_request_reveal_audits" (
    "id" "uuid" NOT NULL,
    "contact_request_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "actor_id" character varying(255) NOT NULL,
    "access_purpose" character varying(50) NOT NULL,
    "authority_basis" character varying(32) NOT NULL,
    "revealed_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "guest_contact_reveal_audits_authority_valid" CHECK ((("authority_basis")::"text" = ANY ((ARRAY['account_admin'::character varying, 'portal_creator'::character varying, 'responsible_manager'::character varying])::"text"[]))),
    CONSTRAINT "guest_contact_reveal_audits_purpose_valid" CHECK ((("access_purpose")::"text" = 'respond_to_contact_request'::"text"))
);


--
-- Name: guest_contact_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_contact_requests" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "response_id" "uuid" NOT NULL,
    "publication_snapshot_id" "uuid" NOT NULL,
    "publication_version" integer NOT NULL,
    "publication_digest" character varying(64) NOT NULL,
    "contact_request_enabled" boolean NOT NULL,
    "notice_id" character varying(100) NOT NULL,
    "notice_version" character varying(100) NOT NULL,
    "notice_digest" character varying(64) NOT NULL,
    "notice_locale" character varying(35) NOT NULL,
    "retention_policy_version" character varying(100) NOT NULL,
    "purpose" character varying(50) NOT NULL,
    "consent_granted" boolean DEFAULT false NOT NULL,
    "encrypted_contact" "text",
    "encryption_key_id" character varying(50),
    "status" character varying(20) DEFAULT 'active'::character varying NOT NULL,
    "submitted_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "withdrawn_at" timestamp with time zone,
    "purged_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "guest_contact_requests_key_id_valid" CHECK ((("encryption_key_id" IS NULL) OR (("encryption_key_id")::"text" ~ '^[a-z0-9][a-z0-9._-]{0,49}$'::"text"))),
    CONSTRAINT "guest_contact_requests_lifecycle_valid" CHECK ((((("status")::"text" = 'active'::"text") AND ("consent_granted" = true) AND ("encrypted_contact" IS NOT NULL) AND ("encryption_key_id" IS NOT NULL) AND ("withdrawn_at" IS NULL) AND ("purged_at" IS NULL)) OR ((("status")::"text" = 'withdrawn'::"text") AND ("consent_granted" = false) AND ("encrypted_contact" IS NULL) AND ("withdrawn_at" IS NOT NULL) AND ("purged_at" IS NULL)) OR ((("status")::"text" = 'expired'::"text") AND ("consent_granted" = false) AND ("encrypted_contact" IS NULL) AND ("withdrawn_at" IS NULL) AND ("purged_at" IS NOT NULL)))),
    CONSTRAINT "guest_contact_requests_publication_evidence_valid" CHECK ((("publication_version" >= 1) AND (("publication_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("contact_request_enabled" = true) AND (("char_length"(("notice_id")::"text") >= 1) AND ("char_length"(("notice_id")::"text") <= 100)) AND (("char_length"(("notice_version")::"text") >= 1) AND ("char_length"(("notice_version")::"text") <= 100)) AND (("notice_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("notice_locale")::"text" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text") AND (("retention_policy_version")::"text" = 'guest-contact-retention-30d-v1'::"text"))),
    CONSTRAINT "guest_contact_requests_purpose_valid" CHECK ((("purpose")::"text" = 'manager_follow_up'::"text")),
    CONSTRAINT "guest_contact_requests_retention_exact" CHECK (("expires_at" = ("submitted_at" + '720:00:00'::interval)))
);


--
-- Name: guest_network_pressure_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_network_pressure_records" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "pseudonym" character varying(64) NOT NULL,
    "action" character varying(24) NOT NULL,
    "observed_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "guest_network_pressure_action_valid" CHECK ((("action")::"text" = ANY ((ARRAY['rating'::character varying, 'private_feedback'::character varying, 'destination_action'::character varying, 'qualified_scan'::character varying])::"text"[]))),
    CONSTRAINT "guest_network_pressure_pseudonym_valid" CHECK ((("pseudonym")::"text" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "guest_network_pressure_retention_valid" CHECK (("expires_at" = ("observed_at" + '7 days'::interval)))
);


--
-- Name: guest_qualified_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_qualified_scans" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "portal_group_id" "uuid",
    "access_artifact_id" "uuid" NOT NULL,
    "source_event_id" "uuid" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "retracted_at" timestamp with time zone,
    "attributed_staff_participant_id" "uuid",
    "attributed_staff_participation_id" "uuid",
    "attribution_responsibility_id" "uuid",
    "staff_attribution_effective_from" timestamp with time zone,
    "staff_attribution_effective_to" timestamp with time zone,
    CONSTRAINT "guest_qualified_scans_retraction_valid" CHECK ((("retracted_at" IS NULL) OR ("retracted_at" >= "occurred_at"))),
    CONSTRAINT "guest_qualified_scans_staff_attribution_complete" CHECK (((("attributed_staff_participant_id" IS NULL) AND ("attributed_staff_participation_id" IS NULL) AND ("attribution_responsibility_id" IS NULL) AND ("staff_attribution_effective_from" IS NULL) AND ("staff_attribution_effective_to" IS NULL)) OR (("attributed_staff_participant_id" IS NOT NULL) AND ("attributed_staff_participation_id" IS NOT NULL) AND ("attribution_responsibility_id" IS NOT NULL) AND ("staff_attribution_effective_from" IS NOT NULL) AND (("staff_attribution_effective_to" IS NULL) OR ("staff_attribution_effective_to" > "staff_attribution_effective_from")) AND ("occurred_at" >= "staff_attribution_effective_from") AND (("staff_attribution_effective_to" IS NULL) OR ("occurred_at" < "staff_attribution_effective_to")))))
);


--
-- Name: guest_response_experience_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_response_experience_snapshots" (
    "response_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "publication_state" character varying(20) NOT NULL,
    "publication_snapshot_id" "uuid",
    "publication_version" integer,
    "publication_digest" character varying(64),
    "configuration_digest" character varying(64) NOT NULL,
    "guest_locale" character varying(35) NOT NULL,
    "language_pack_version" character varying(100) NOT NULL,
    "private_feedback_threshold" integer NOT NULL,
    "captured_at" timestamp with time zone NOT NULL,
    CONSTRAINT "guest_response_experience_snapshots_configuration_digest_valid" CHECK ((("configuration_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "guest_response_experience_snapshots_guest_locale_valid" CHECK ((("guest_locale")::"text" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text")),
    CONSTRAINT "guest_response_experience_snapshots_publication_reference_valid" CHECK (((("publication_snapshot_id" IS NULL) AND ("publication_version" IS NULL) AND ("publication_digest" IS NULL)) OR (("publication_snapshot_id" IS NOT NULL) AND ("publication_version" >= 1) AND (("publication_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")))),
    CONSTRAINT "guest_response_experience_snapshots_publication_state_valid" CHECK ((("publication_state")::"text" = 'published'::"text")),
    CONSTRAINT "guest_response_experience_snapshots_threshold_valid" CHECK ((("private_feedback_threshold" >= 1) AND ("private_feedback_threshold" <= 5)))
);


--
-- Name: guest_response_integrity_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_response_integrity_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "response_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "revision" integer NOT NULL,
    "previous_outcome" character varying(32),
    "outcome" character varying(32) NOT NULL,
    "reason_code" character varying(100) NOT NULL,
    "source" character varying(20) NOT NULL,
    "actor_id" character varying(255) NOT NULL,
    "decided_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "guest_response_integrity_decisions_initial_revision_valid" CHECK (((("revision" = 1) AND ("previous_outcome" IS NULL)) OR (("revision" > 1) AND ("previous_outcome" IS NOT NULL)))),
    CONSTRAINT "guest_response_integrity_decisions_outcome_valid" CHECK ((("outcome")::"text" = ANY ((ARRAY['accepted'::character varying, 'filtered_automatically'::character varying, 'under_review'::character varying])::"text"[]))),
    CONSTRAINT "guest_response_integrity_decisions_previous_outcome_valid" CHECK ((("previous_outcome" IS NULL) OR (("previous_outcome")::"text" = ANY ((ARRAY['accepted'::character varying, 'filtered_automatically'::character varying, 'under_review'::character varying])::"text"[])))),
    CONSTRAINT "guest_response_integrity_decisions_reason_valid" CHECK ((("reason_code")::"text" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'::"text")),
    CONSTRAINT "guest_response_integrity_decisions_revision_valid" CHECK (("revision" >= 1)),
    CONSTRAINT "guest_response_integrity_decisions_source_valid" CHECK ((("source")::"text" = ANY ((ARRAY['system'::character varying, 'automatic'::character varying, 'reviewer'::character varying, 'migration'::character varying])::"text"[])))
);


--
-- Name: guest_response_private_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_response_private_feedback" (
    "response_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "submitted_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "guest_response_private_feedback_body_length" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 2000))),
    CONSTRAINT "guest_response_private_feedback_live_window" CHECK (("expires_at" > "submitted_at"))
);


--
-- Name: guest_response_session_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_response_session_bindings" (
    "response_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "guest_response_session_bindings_live_window" CHECK (("expires_at" > "created_at"))
);


--
-- Name: guest_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."guest_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "integrity_outcome" character varying(32) DEFAULT 'accepted'::character varying NOT NULL,
    "integrity_reason_code" character varying(100) DEFAULT 'legacy_included'::character varying NOT NULL,
    "integrity_revision" integer DEFAULT 1 NOT NULL,
    "integrity_assessed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rating" integer,
    "category_id" "uuid",
    "response_consent" boolean DEFAULT false NOT NULL,
    "text_consent" boolean DEFAULT false NOT NULL,
    "media_consent" boolean DEFAULT false NOT NULL,
    "private_feedback_threshold" integer,
    "rating_source_event_id" character varying(255),
    "feedback_source_event_id" character varying(255),
    "correction_count" integer DEFAULT 0 NOT NULL,
    "submitted_at" timestamp with time zone,
    "corrected_at" timestamp with time zone,
    "feedback_submitted_at" timestamp with time zone,
    "feedback_submission_revision" integer,
    "feedback_withdrawn_at" timestamp with time zone,
    "moderated_at" timestamp with time zone,
    "retention_deadline" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "attributed_staff_participant_id" "uuid",
    "attributed_staff_participation_id" "uuid",
    "attribution_responsibility_id" "uuid",
    "staff_attribution_effective_from" timestamp with time zone,
    "staff_attribution_effective_to" timestamp with time zone,
    CONSTRAINT "guest_responses_correction_count_valid" CHECK ((("correction_count" >= 0) AND ("correction_count" <= 1))),
    CONSTRAINT "guest_responses_feedback_submission_revision_valid" CHECK (((("feedback_submitted_at" IS NULL) AND ("feedback_submission_revision" IS NULL)) OR (("feedback_submitted_at" IS NOT NULL) AND (("feedback_submission_revision" >= 1) AND ("feedback_submission_revision" <= ("correction_count" + 1)))))),
    CONSTRAINT "guest_responses_feedback_withdrawal_valid" CHECK ((("feedback_withdrawn_at" IS NULL) OR (("feedback_submitted_at" IS NOT NULL) AND ("text_consent" = false) AND ("feedback_source_event_id" IS NULL)))),
    CONSTRAINT "guest_responses_integrity_outcome_valid" CHECK ((("integrity_outcome")::"text" = ANY ((ARRAY['accepted'::character varying, 'filtered_automatically'::character varying, 'under_review'::character varying])::"text"[]))),
    CONSTRAINT "guest_responses_integrity_reason_valid" CHECK ((("integrity_reason_code")::"text" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'::"text")),
    CONSTRAINT "guest_responses_integrity_revision_valid" CHECK (("integrity_revision" >= 1)),
    CONSTRAINT "guest_responses_private_feedback_threshold_valid" CHECK ((("private_feedback_threshold" IS NULL) OR (("private_feedback_threshold" >= 1) AND ("private_feedback_threshold" <= 5)))),
    CONSTRAINT "guest_responses_rating_valid" CHECK ((("rating" IS NULL) OR (("rating" >= 1) AND ("rating" <= 5)))),
    CONSTRAINT "guest_responses_staff_attribution_complete" CHECK (((("attributed_staff_participant_id" IS NULL) AND ("attributed_staff_participation_id" IS NULL) AND ("attribution_responsibility_id" IS NULL) AND ("staff_attribution_effective_from" IS NULL) AND ("staff_attribution_effective_to" IS NULL)) OR (("attributed_staff_participant_id" IS NOT NULL) AND ("attributed_staff_participation_id" IS NOT NULL) AND ("attribution_responsibility_id" IS NOT NULL) AND ("staff_attribution_effective_from" IS NOT NULL) AND ("submitted_at" IS NOT NULL) AND ("submitted_at" >= "staff_attribution_effective_from") AND (("staff_attribution_effective_to" IS NULL) OR ("staff_attribution_effective_to" > "staff_attribution_effective_from")) AND (("staff_attribution_effective_to" IS NULL) OR ("submitted_at" < "staff_attribution_effective_to"))))),
    CONSTRAINT "guest_responses_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'submitted'::character varying, 'corrected'::character varying, 'moderated'::character varying, 'deleted'::character varying, 'expired'::character varying])::"text"[])))
);


--
-- Name: idempotency_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."idempotency_receipts" (
    "scope" "text" NOT NULL,
    "key" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: inbox_assignment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_assignment_history" (
    "inbox_item_id" "uuid" NOT NULL,
    "resulting_command_revision" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" character varying(255) NOT NULL,
    "handling_cycle_number" bigint,
    "previous_assignee" character varying(255),
    "next_assignee" character varying(255),
    "reason" "public"."inbox_assignment_reason" NOT NULL,
    "actor_user_id" character varying(255),
    "bulk_id" "uuid",
    "occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_assignment_history_changes_assignee" CHECK ((("previous_assignee")::"text" IS DISTINCT FROM ("next_assignee")::"text")),
    CONSTRAINT "inbox_assignment_history_revision_safe" CHECK (((("resulting_command_revision" >= 2) AND ("resulting_command_revision" <= '9007199254740991'::bigint)) AND (("handling_cycle_number" IS NULL) OR (("handling_cycle_number" >= 1) AND ("handling_cycle_number" <= '9007199254740991'::bigint)))))
);


--
-- Name: inbox_escalation_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_escalation_history" (
    "inbox_item_id" "uuid" NOT NULL,
    "resulting_command_revision" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" character varying(255) NOT NULL,
    "handling_cycle_number" bigint,
    "kind" character varying(16) NOT NULL,
    "actor_user_id" character varying(255),
    "occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_escalation_history_kind_valid" CHECK ((("kind")::"text" = ANY ((ARRAY['escalated'::character varying, 'resolved'::character varying])::"text"[]))),
    CONSTRAINT "inbox_escalation_history_revision_safe" CHECK (((("resulting_command_revision" >= 2) AND ("resulting_command_revision" <= '9007199254740991'::bigint)) AND (("handling_cycle_number" IS NULL) OR (("handling_cycle_number" >= 1) AND ("handling_cycle_number" <= '9007199254740991'::bigint)))))
);


--
-- Name: inbox_feedback_handling_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_feedback_handling_outcomes" (
    "id" "uuid" NOT NULL,
    "inbox_item_id" "uuid" NOT NULL,
    "cycle_number" bigint NOT NULL,
    "outcome_revision" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_type" "public"."inbox_source_type" DEFAULT 'feedback'::"public"."inbox_source_type" NOT NULL,
    "feedback_id" "uuid" NOT NULL,
    "source_revision" bigint NOT NULL,
    "outcome" character varying(48) NOT NULL,
    "internal_note" "text",
    "recorded_by" character varying(255) NOT NULL,
    "recorded_at" timestamp with time zone NOT NULL,
    "completion_at" timestamp with time zone NOT NULL,
    "completion_state_revision" bigint NOT NULL,
    "deadline_result" character varying(24) NOT NULL,
    "resulting_command_revision" bigint NOT NULL,
    "supersedes_outcome_id" "uuid",
    "supersedes_outcome_revision" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_feedback_handling_outcomes_values_valid" CHECK ((("source_type" = 'feedback'::"public"."inbox_source_type") AND (("cycle_number" >= 1) AND ("cycle_number" <= '9007199254740991'::bigint)) AND (("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND (("outcome_revision" >= 1) AND ("outcome_revision" <= '9007199254740991'::bigint)) AND (("completion_state_revision" >= 2) AND ("completion_state_revision" <= '9007199254740991'::bigint)) AND (("resulting_command_revision" >= 2) AND ("resulting_command_revision" <= '9007199254740991'::bigint)) AND (("outcome")::"text" = ANY ((ARRAY['follow_up_completed'::character varying, 'follow_up_attempted'::character varying, 'handled_with_team'::character varying, 'reviewed_no_additional_step'::character varying, 'content_concern_reviewed'::character varying])::"text"[])) AND (("deadline_result")::"text" = ANY ((ARRAY['on_time'::character varying, 'late'::character varying, 'not_measured'::character varying])::"text"[])) AND (("internal_note" IS NULL) OR (("length"("btrim"("internal_note")) >= 1) AND ("length"("btrim"("internal_note")) <= 2000))) AND ("recorded_at" >= "completion_at") AND ((("outcome_revision" = 1) AND ("supersedes_outcome_id" IS NULL) AND ("supersedes_outcome_revision" IS NULL)) OR (("outcome_revision" > 1) AND ("supersedes_outcome_id" IS NOT NULL) AND ("supersedes_outcome_revision" = ("outcome_revision" - 1))))))
);


--
-- Name: inbox_handling_cycle_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_handling_cycle_heads" (
    "inbox_item_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_type" "public"."inbox_source_type" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "current_source_revision" bigint NOT NULL,
    "review_id" "uuid",
    "current_cycle_number" bigint NOT NULL,
    "current_material_review_revision" bigint,
    "state_revision" bigint DEFAULT 1 NOT NULL,
    "status" "public"."inbox_status" DEFAULT 'open'::"public"."inbox_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_handling_cycle_heads_revisions_safe" CHECK (((("current_cycle_number" >= 1) AND ("current_cycle_number" <= '9007199254740991'::bigint)) AND (("current_source_revision" >= 1) AND ("current_source_revision" <= '9007199254740991'::bigint)) AND (("state_revision" >= 1) AND ("state_revision" <= '9007199254740991'::bigint)))),
    CONSTRAINT "inbox_handling_cycle_heads_source_anchor_valid" CHECK (((("source_type" = 'review'::"public"."inbox_source_type") AND ("review_id" = "source_id") AND ("current_material_review_revision" = "current_source_revision")) OR (("source_type" = 'feedback'::"public"."inbox_source_type") AND ("review_id" IS NULL) AND ("current_material_review_revision" IS NULL))))
);


--
-- Name: inbox_handling_cycle_response_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_handling_cycle_response_targets" (
    "inbox_item_id" "uuid" NOT NULL,
    "cycle_number" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_type" "public"."inbox_source_type" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "source_revision" bigint NOT NULL,
    "target_kind" character varying(48) NOT NULL,
    "performance_eligibility" character varying(32) NOT NULL,
    "duration_minutes" integer,
    "policy_source" character varying(32),
    "policy_version" bigint,
    "start_at" timestamp with time zone,
    "due_at" timestamp with time zone,
    "completion_at" timestamp with time zone,
    "result" character varying(24),
    "stop_reason" character varying(48),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_handling_cycle_response_targets_source_stop_valid" CHECK ((("stop_reason" IS NULL) OR ((("target_kind")::"text" = 'private_feedback_handling'::"text") AND (("stop_reason")::"text" = ANY ((ARRAY['private_feedback_handled'::character varying, 'guest_withdrawn'::character varying, 'superseded_by_source_revision'::character varying])::"text"[]))) OR ((("target_kind")::"text" = 'google_review_response'::"text") AND (("stop_reason")::"text" = ANY ((ARRAY['confirmed_on_google'::character varying, 'superseded_by_source_revision'::character varying, 'source_ineligible'::character varying])::"text"[]))))),
    CONSTRAINT "inbox_handling_cycle_response_targets_values_valid" CHECK (((("cycle_number" >= 1) AND ("cycle_number" <= '9007199254740991'::bigint)) AND (("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND (("target_kind")::"text" = ANY ((ARRAY['google_review_response'::character varying, 'private_feedback_handling'::character varying])::"text"[])) AND (("performance_eligibility")::"text" = ANY ((ARRAY['measured'::character varying, 'legacy_unknown'::character varying, 'historical_onboarding'::character varying])::"text"[])) AND (((("target_kind")::"text" = 'google_review_response'::"text") AND ("source_type" = 'review'::"public"."inbox_source_type")) OR ((("target_kind")::"text" = 'private_feedback_handling'::"text") AND ("source_type" = 'feedback'::"public"."inbox_source_type"))) AND (((("performance_eligibility")::"text" = 'measured'::"text") AND (("duration_minutes" >= 1) AND ("duration_minutes" <= 43200)) AND (("policy_source")::"text" = ANY ((ARRAY['builtin_default'::character varying, 'organization_policy'::character varying, 'property_override'::character varying])::"text"[])) AND ((("target_kind")::"text" = 'private_feedback_handling'::"text") OR (("policy_source")::"text" <> 'property_override'::"text")) AND (("policy_version" >= 1) AND ("policy_version" <= '9007199254740991'::bigint)) AND ("start_at" IS NOT NULL) AND ("due_at" = ("start_at" + "make_interval"("mins" => "duration_minutes")))) OR ((("performance_eligibility")::"text" <> 'measured'::"text") AND ("duration_minutes" IS NULL) AND ("policy_source" IS NULL) AND ("policy_version" IS NULL) AND ("start_at" IS NULL) AND ("due_at" IS NULL))) AND ((("completion_at" IS NULL) AND ("result" IS NULL) AND ("stop_reason" IS NULL)) OR ((("performance_eligibility")::"text" = 'measured'::"text") AND (((("result")::"text" = ANY ((ARRAY['on_time'::character varying, 'late'::character varying])::"text"[])) AND ("completion_at" >= "start_at") AND (("stop_reason")::"text" = ANY ((ARRAY['private_feedback_handled'::character varying, 'confirmed_on_google'::character varying])::"text"[]))) OR ((("result")::"text" = 'cancelled'::"text") AND (("stop_reason")::"text" = ANY ((ARRAY['guest_withdrawn'::character varying, 'superseded_by_source_revision'::character varying, 'source_ineligible'::character varying])::"text"[])))) AND ((("result")::"text" = 'cancelled'::"text") OR (((("result")::"text" = 'on_time'::"text") = ("completion_at" <= "due_at")) AND ((("result")::"text" = 'late'::"text") = ("completion_at" > "due_at"))))))))
);


--
-- Name: inbox_handling_cycle_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_handling_cycle_transitions" (
    "inbox_item_id" "uuid" NOT NULL,
    "state_revision" bigint NOT NULL,
    "cycle_number" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_type" "public"."inbox_source_type" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "source_revision" bigint NOT NULL,
    "kind" character varying(16) NOT NULL,
    "transition_reason" character varying(48) NOT NULL,
    "actor_type" character varying(16) NOT NULL,
    "actor_user_id" character varying(255),
    "trigger_event_id" "uuid",
    "transitioned_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_handling_cycle_transitions_values_valid" CHECK (((("cycle_number" >= 1) AND ("cycle_number" <= '9007199254740991'::bigint)) AND (("state_revision" >= 1) AND ("state_revision" <= '9007199254740991'::bigint)) AND (("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND (("kind")::"text" = ANY ((ARRAY['opened'::character varying, 'closed'::character varying, 'reopened'::character varying])::"text"[])) AND (("transition_reason")::"text" = ANY ((ARRAY['legacy_backfill'::character varying, 'review_observed'::character varying, 'feedback_submitted'::character varying, 'material_revision_changed'::character varying, 'manual_reopen'::character varying, 'provider_reply_deleted'::character varying, 'provider_reply_diverged'::character varying, 'guest_follow_up_still_needed'::character varying, 'internal_follow_up_still_needed'::character varying, 'new_information'::character varying, 'correcting_handling_status'::character varying, 'other'::character varying, 'confirmed_on_google'::character varying, 'external_reply_observed'::character varying, 'guest_withdrawn'::character varying, 'private_feedback_handled'::character varying, 'source_ineligible'::character varying, 'superseded_by_source_revision'::character varying])::"text"[])) AND (("actor_type")::"text" = ANY ((ARRAY['user'::character varying, 'guest'::character varying, 'provider'::character varying, 'system'::character varying])::"text"[])) AND ((("actor_type")::"text" = 'user'::"text") = ("actor_user_id" IS NOT NULL))))
);


--
-- Name: inbox_handling_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_handling_cycles" (
    "inbox_item_id" "uuid" NOT NULL,
    "cycle_number" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_type" "public"."inbox_source_type" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "source_revision" bigint NOT NULL,
    "review_id" "uuid",
    "material_review_revision" bigint,
    "opened_reason" character varying(48) NOT NULL,
    "manual_reopen_reason" character varying(48),
    "manual_reopen_explanation" character varying(280),
    "supersedes_cycle_number" bigint,
    "opened_by" character varying(255),
    "opened_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_handling_cycles_manual_reopen_valid" CHECK ((((("opened_reason")::"text" <> 'manual_reopen'::"text") AND ("manual_reopen_reason" IS NULL) AND ("manual_reopen_explanation" IS NULL)) OR ((("opened_reason")::"text" = 'manual_reopen'::"text") AND ("manual_reopen_reason" IS NOT NULL) AND (("manual_reopen_reason")::"text" = ANY ((ARRAY['guest_follow_up_still_needed'::character varying, 'internal_follow_up_still_needed'::character varying, 'new_information'::character varying, 'correcting_handling_status'::character varying, 'other'::character varying])::"text"[])) AND (((("manual_reopen_reason")::"text" = 'other'::"text") AND ("manual_reopen_explanation" IS NOT NULL) AND (("length"("btrim"(("manual_reopen_explanation")::"text")) >= 1) AND ("length"("btrim"(("manual_reopen_explanation")::"text")) <= 280))) OR ((("manual_reopen_reason")::"text" <> 'other'::"text") AND ("manual_reopen_explanation" IS NULL)))))),
    CONSTRAINT "inbox_handling_cycles_reason_valid" CHECK ((("opened_reason")::"text" = ANY ((ARRAY['legacy_backfill'::character varying, 'review_observed'::character varying, 'feedback_submitted'::character varying, 'material_revision_changed'::character varying, 'manual_reopen'::character varying, 'provider_reply_deleted'::character varying, 'provider_reply_diverged'::character varying])::"text"[]))),
    CONSTRAINT "inbox_handling_cycles_sequence_safe" CHECK (((("cycle_number" >= 1) AND ("cycle_number" <= '9007199254740991'::bigint)) AND ((("cycle_number" = 1) AND ("supersedes_cycle_number" IS NULL)) OR (("cycle_number" > 1) AND ("supersedes_cycle_number" = ("cycle_number" - 1)))))),
    CONSTRAINT "inbox_handling_cycles_source_anchor_valid" CHECK (((("source_revision" >= 1) AND ("source_revision" <= '9007199254740991'::bigint)) AND ((("source_type" = 'review'::"public"."inbox_source_type") AND ("review_id" = "source_id") AND ("material_review_revision" = "source_revision") AND (("opened_reason")::"text" <> 'feedback_submitted'::"text")) OR (("source_type" = 'feedback'::"public"."inbox_source_type") AND ("review_id" IS NULL) AND ("material_review_revision" IS NULL) AND (("opened_reason")::"text" = ANY ((ARRAY['legacy_backfill'::character varying, 'feedback_submitted'::character varying, 'manual_reopen'::character varying])::"text"[]))))))
);


--
-- Name: inbox_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" character varying(255) NOT NULL,
    "source_type" "public"."inbox_source_type" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "status" "public"."inbox_status" DEFAULT 'open'::"public"."inbox_status" NOT NULL,
    "is_escalated" boolean DEFAULT false NOT NULL,
    "escalated_at" timestamp with time zone,
    "escalated_by" character varying(255),
    "escalation_resolved_at" timestamp with time zone,
    "escalation_resolved_by" character varying(255),
    "rating" integer,
    "source_date" timestamp with time zone NOT NULL,
    "platform" character varying(255),
    "snippet" "text",
    "reviewer_name" character varying(255),
    "assigned_to" character varying(255),
    "closed_at" timestamp with time zone,
    "first_reply_submitted_at" timestamp with time zone,
    "first_reply_published_at" timestamp with time zone,
    "command_revision" bigint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "manager_priority" "public"."inbox_priority_level",
    "manager_priority_set_by" character varying(255),
    "manager_priority_set_at" timestamp with time zone,
    CONSTRAINT "inbox_items_command_revision_safe" CHECK ((("command_revision" >= 1) AND ("command_revision" <= '9007199254740991'::bigint))),
    CONSTRAINT "inbox_items_manager_priority_stamped" CHECK (((("manager_priority" IS NULL) = ("manager_priority_set_by" IS NULL)) AND (("manager_priority" IS NULL) = ("manager_priority_set_at" IS NULL)))),
    CONSTRAINT "inbox_items_review_source_content_free" CHECK ((("source_type" <> 'review'::"public"."inbox_source_type") OR (("rating" IS NULL) AND ("snippet" IS NULL) AND ("reviewer_name" IS NULL))))
);


--
-- Name: inbox_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inbox_item_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "author_user_id" character varying(255) NOT NULL,
    "text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: inbox_priority_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_priority_history" (
    "inbox_item_id" "uuid" NOT NULL,
    "resulting_command_revision" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" character varying(255) NOT NULL,
    "handling_cycle_number" bigint,
    "priority" "public"."inbox_priority_level",
    "previous_priority" "public"."inbox_priority_level",
    "actor_user_id" character varying(255) NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_priority_history_changes_priority" CHECK (("priority" IS DISTINCT FROM "previous_priority")),
    CONSTRAINT "inbox_priority_history_revision_safe" CHECK (((("resulting_command_revision" >= 2) AND ("resulting_command_revision" <= '9007199254740991'::bigint)) AND (("handling_cycle_number" IS NULL) OR (("handling_cycle_number" >= 1) AND ("handling_cycle_number" <= '9007199254740991'::bigint)))))
);


--
-- Name: inbox_private_feedback_target_property_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_private_feedback_target_property_overrides" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "enabled" boolean NOT NULL,
    "duration_minutes" integer,
    "policy_version" bigint NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_private_feedback_target_property_overrides_values_valid" CHECK (((("enabled" AND (("duration_minutes" >= 1) AND ("duration_minutes" <= 43200))) OR ((NOT "enabled") AND ("duration_minutes" IS NULL))) AND (("policy_version" >= 1) AND ("policy_version" <= '9007199254740991'::bigint))))
);


--
-- Name: inbox_response_target_exclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_response_target_exclusions" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "inbox_item_id" "uuid" NOT NULL,
    "cycle_number" bigint NOT NULL,
    "target_kind" character varying(48) NOT NULL,
    "reason" character varying(32) NOT NULL,
    "correlation_id" "uuid" NOT NULL,
    "operator_id" character varying(255) NOT NULL,
    "ticket" character varying(200),
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_response_target_exclusions_values_valid" CHECK (((("cycle_number" >= 1) AND ("cycle_number" <= '9007199254740991'::bigint)) AND (("reason")::"text" = 'provider_restatement'::"text") AND (("target_kind")::"text" = 'google_review_response'::"text") AND (("char_length"("btrim"(("operator_id")::"text")) >= 1) AND ("char_length"("btrim"(("operator_id")::"text")) <= 255)) AND (("ticket" IS NULL) OR (("char_length"("btrim"(("ticket")::"text")) >= 1) AND ("char_length"("btrim"(("ticket")::"text")) <= 200)))))
);


--
-- Name: inbox_response_target_organization_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_response_target_organization_policies" (
    "organization_id" character varying(255) NOT NULL,
    "target_kind" character varying(48) NOT NULL,
    "duration_minutes" integer NOT NULL,
    "policy_version" bigint NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "low_rating_threshold" integer,
    "low_rating_duration_minutes" integer,
    CONSTRAINT "inbox_response_target_organization_policies_low_rating_valid" CHECK (((("low_rating_threshold" IS NULL) = ("low_rating_duration_minutes" IS NULL)) AND (("low_rating_threshold" IS NULL) OR ((("target_kind")::"text" = 'google_review_response'::"text") AND (("low_rating_threshold" >= 1) AND ("low_rating_threshold" <= 5)) AND (("low_rating_duration_minutes" >= 1) AND ("low_rating_duration_minutes" <= "duration_minutes")))))),
    CONSTRAINT "inbox_response_target_organization_policies_values_valid" CHECK (((("target_kind")::"text" = ANY ((ARRAY['google_review_response'::character varying, 'private_feedback_handling'::character varying])::"text"[])) AND (("duration_minutes" >= 1) AND ("duration_minutes" <= 43200)) AND (("policy_version" >= 1) AND ("policy_version" <= '9007199254740991'::bigint))))
);


--
-- Name: inbox_response_target_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_response_target_reminders" (
    "inbox_item_id" "uuid" NOT NULL,
    "cycle_number" bigint NOT NULL,
    "reminder_kind" character varying(24) NOT NULL,
    "event_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "target_kind" character varying(48) NOT NULL,
    "scheduled_for" timestamp with time zone NOT NULL,
    "delivered_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbox_response_target_reminders_values_valid" CHECK (((("cycle_number" >= 1) AND ("cycle_number" <= '9007199254740991'::bigint)) AND (("reminder_kind")::"text" = ANY ((ARRAY['halfway'::character varying, 'target_passed'::character varying])::"text"[])) AND (("target_kind")::"text" = ANY ((ARRAY['google_review_response'::character varying, 'private_feedback_handling'::character varying])::"text"[])) AND (NOT (("delivered_at" IS NOT NULL) AND ("cancelled_at" IS NOT NULL))) AND (("delivered_at" IS NULL) OR ("delivered_at" >= "scheduled_for"))))
);


--
-- Name: inbox_user_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."inbox_user_views" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "last_inbox_view" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: invitation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."invitation" (
    "id" "text" NOT NULL,
    "organizationId" "text" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text",
    "status" "text" NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "inviterId" "text" NOT NULL,
    "staffParticipationId" "text",
    "propertyIds" "text"
);


--
-- Name: material_review_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."material_review_revisions" (
    "review_id" "uuid" NOT NULL,
    "revision" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "normalization_version" character varying(64) NOT NULL,
    "source_digest" character varying(64),
    "normalized_digest" character varying(64),
    "rating" integer,
    "normalized_text" "text",
    "response_target_eligibility" character varying(32) DEFAULT 'legacy_unknown'::character varying NOT NULL,
    "response_target_start_at" timestamp with time zone,
    "content_state" character varying(24) DEFAULT 'active'::character varying NOT NULL,
    "content_erased_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "material_review_revisions_comparison_valid" CHECK ((((("normalization_version")::"text" = 'legacy-unverified-v0'::"text") AND ("source_digest" IS NULL) AND ("normalized_digest" IS NULL)) OR ((("normalization_version")::"text" = 'review-material-v1'::"text") AND ("source_digest" IS NOT NULL) AND (("source_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("normalized_digest" IS NOT NULL) AND (("normalized_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")))),
    CONSTRAINT "material_review_revisions_content_state_valid" CHECK ((((("content_state")::"text" = 'active'::"text") AND ("content_erased_at" IS NULL) AND ("rating" IS NOT NULL) AND (("rating" >= 1) AND ("rating" <= 5))) OR ((("content_state")::"text" = ANY ((ARRAY['source_expired'::character varying, 'provider_deleted'::character varying])::"text"[])) AND ("content_erased_at" IS NOT NULL) AND ("rating" IS NULL) AND ("normalized_text" IS NULL)))),
    CONSTRAINT "material_review_revisions_controls_safe" CHECK (((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("revision" >= 1) AND ("revision" <= '9007199254740991'::bigint)))),
    CONSTRAINT "material_review_revisions_response_target_valid" CHECK (((("response_target_eligibility")::"text" = ANY ((ARRAY['measured'::character varying, 'legacy_unknown'::character varying, 'historical_onboarding'::character varying])::"text"[])) AND (((("response_target_eligibility")::"text" = 'measured'::"text") AND ("response_target_start_at" IS NOT NULL)) OR ((("response_target_eligibility")::"text" <> 'measured'::"text") AND ("response_target_start_at" IS NULL)))))
);


--
-- Name: member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."member" (
    "id" "text" NOT NULL,
    "organizationId" "text" NOT NULL,
    "userId" "text" NOT NULL,
    "role" "text" NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);


--
-- Name: merchant_ai_decision_deferrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."merchant_ai_decision_deferrals" (
    "property_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "deferred_by" character varying(255) NOT NULL,
    "deferred_at" timestamp with time zone NOT NULL
);


--
-- Name: merchant_ai_enablement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."merchant_ai_enablement" (
    "property_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "authorization_lineage_id" "uuid" NOT NULL,
    "state" "text" NOT NULL,
    "capabilities" "text"[] NOT NULL,
    "capability_runtime_profile_versions" "jsonb" NOT NULL,
    "review_analysis_epoch" integer NOT NULL,
    "reply_drafting_epoch" integer NOT NULL,
    "property_trends_epoch" integer NOT NULL,
    "authorized_source_epoch" integer NOT NULL,
    "analysis_start_sequence" bigint NOT NULL,
    "state_version" integer NOT NULL,
    "notice_version" character varying(100) NOT NULL,
    "notice_digest" character varying(64) NOT NULL,
    "source_policy_id" character varying(150) NOT NULL,
    "routing_policy_version" integer NOT NULL,
    "processing_region" character varying(20) NOT NULL,
    "provider_deployment_profile_version" character varying(100) NOT NULL,
    "redaction_profile_family" character varying(100) NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "merchant_ai_enablement_analysis_sequence_safe" CHECK ((("analysis_start_sequence" >= 0) AND ("analysis_start_sequence" <= '9007199254740991'::bigint))),
    CONSTRAINT "merchant_ai_enablement_capabilities_valid" CHECK (((("state" = 'enabled'::"text") AND (("capabilities" = ARRAY['review_analysis'::"text"]) OR ("capabilities" = ARRAY['reply_drafting'::"text"]) OR ("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) OR ("capabilities" = ARRAY['review_analysis'::"text", 'property_trends'::"text"]) OR ("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]))) OR (("state" = ANY (ARRAY['disabled'::"text", 'revoked'::"text"])) AND ("capabilities" = ARRAY[]::"text"[])))),
    CONSTRAINT "merchant_ai_enablement_contract_valid" CHECK (((((("notice_version")::"text" = 'merchant-ai-notice-2026-08-15.v1'::"text") AND (("notice_digest")::"text" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-08-19.v1'::"text") AND (("notice_digest")::"text" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-09-06.v1'::"text") AND (("notice_digest")::"text" = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-09-08.v1'::"text") AND (("notice_digest")::"text" = 'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-09-09.v1'::"text") AND (("notice_digest")::"text" = 'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-09-15.v1'::"text") AND (("notice_digest")::"text" = '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-10-17.v1'::"text") AND (("notice_digest")::"text" = '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-10-30.v1'::"text") AND (("notice_digest")::"text" = 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-11-01.v1'::"text") AND (("notice_digest")::"text" = 'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-11-06.v1'::"text") AND (("notice_digest")::"text" = 'eb810fedbb445bf9361d03280cfa44f31c3a8a8563a905549c3a7bdaed1a88f3'::"text")) OR ((("notice_version")::"text" = 'merchant-ai-notice-2026-11-06.v2'::"text") AND (("notice_digest")::"text" = 'ede9faf088b4ce52da16d194639e780ab05b0349ac896f129f05fb185f53a5f7'::"text"))) AND (("source_policy_id")::"text" = 'google-business-profile-source-policy-v1'::"text") AND ("routing_policy_version" = 1) AND (("redaction_profile_family")::"text" = 'gbp-review-global-v1'::"text"))),
    CONSTRAINT "merchant_ai_enablement_notice_digest_valid" CHECK ((("notice_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "merchant_ai_enablement_profile_valid" CHECK ((("provider_deployment_profile_version")::"text" = ANY (ARRAY['private-beta-global-v1'::"text", 'private-beta-global-v2'::"text", 'private-beta-global-v3'::"text"]))),
    CONSTRAINT "merchant_ai_enablement_region_valid" CHECK ((("processing_region")::"text" = 'global'::"text")),
    CONSTRAINT "merchant_ai_enablement_runtime_map_valid" CHECK (((("capabilities" = ARRAY[]::"text"[]) AND ("capability_runtime_profile_versions" = '{}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text"]) AND ("capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text"]) AND ("capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")) OR (("capabilities" = ARRAY['review_analysis'::"text", 'reply_drafting'::"text", 'property_trends'::"text"]) AND ("capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::"jsonb")))),
    CONSTRAINT "merchant_ai_enablement_state_valid" CHECK (("state" = ANY (ARRAY['disabled'::"text", 'enabled'::"text", 'revoked'::"text"]))),
    CONSTRAINT "merchant_ai_enablement_versions_valid" CHECK ((("state_version" >= 1) AND ("review_analysis_epoch" >= 1) AND ("reply_drafting_epoch" >= 1) AND ("property_trends_epoch" >= 1) AND ("authorized_source_epoch" >= 0) AND ("analysis_start_sequence" >= 0) AND ("routing_policy_version" >= 1)))
);


--
-- Name: merchant_ai_notice_update_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."merchant_ai_notice_update_receipts" (
    "user_id" "text" NOT NULL,
    "organization_id" "text" NOT NULL,
    "notice_version" character varying(100) NOT NULL,
    "notice_digest" character varying(64) NOT NULL,
    "seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "merchant_ai_notice_update_receipts_digest_valid" CHECK ((("notice_digest")::"text" ~ '^[0-9a-f]{64}$'::"text"))
);


--
-- Name: metric_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."metric_corrections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reading_id" "uuid" NOT NULL,
    "source_event_id" character varying(255) NOT NULL,
    "kind" character varying(20) NOT NULL,
    "reason" "text" NOT NULL,
    "actor_type" character varying(20) NOT NULL,
    "actor_id" character varying(255) NOT NULL,
    "exact_delta" numeric(30,10),
    "replacement_value" numeric(30,10),
    "event_at" timestamp with time zone NOT NULL,
    "supersedes_correction_id" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attributed_staff_participant_id" "uuid",
    "attributed_staff_participation_id" "uuid",
    "attribution_responsibility_id" "uuid",
    "staff_attribution_effective_from" timestamp with time zone,
    "staff_attribution_effective_to" timestamp with time zone,
    CONSTRAINT "metric_corrections_kind_check" CHECK ((("kind")::"text" = ANY ((ARRAY['retract'::character varying, 'replace'::character varying, 'adjust'::character varying])::"text"[]))),
    CONSTRAINT "metric_corrections_operand_check" CHECK ((((("kind")::"text" = 'retract'::"text") AND ("exact_delta" IS NULL) AND ("replacement_value" IS NULL)) OR ((("kind")::"text" = 'replace'::"text") AND ("exact_delta" IS NULL) AND ("replacement_value" IS NOT NULL)) OR ((("kind")::"text" = 'adjust'::"text") AND ("exact_delta" IS NOT NULL) AND ("replacement_value" IS NULL)))),
    CONSTRAINT "metric_corrections_staff_attribution_complete" CHECK (((("attributed_staff_participant_id" IS NULL) AND ("attributed_staff_participation_id" IS NULL) AND ("attribution_responsibility_id" IS NULL) AND ("staff_attribution_effective_from" IS NULL) AND ("staff_attribution_effective_to" IS NULL)) OR (("attributed_staff_participant_id" IS NOT NULL) AND ("attributed_staff_participation_id" IS NOT NULL) AND ("attribution_responsibility_id" IS NOT NULL) AND ("staff_attribution_effective_from" IS NOT NULL) AND (("staff_attribution_effective_to" IS NULL) OR ("staff_attribution_effective_to" > "staff_attribution_effective_from")))))
);


--
-- Name: metric_current_google_reputation_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."metric_current_google_reputation_snapshots" (
    "property_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "source_epoch" integer NOT NULL,
    "source_run_id" "uuid" NOT NULL,
    "source_event_id" "uuid" NOT NULL,
    "review_count" integer NOT NULL,
    "average_rating" double precision,
    "evaluated_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "metric_current_google_reputation_source_epoch_valid" CHECK ((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647))),
    CONSTRAINT "metric_current_google_reputation_value_valid" CHECK (((("review_count" = 0) AND ("average_rating" IS NULL)) OR ((("review_count" >= 1) AND ("review_count" <= 10000)) AND (("average_rating" >= (0)::double precision) AND ("average_rating" <= (5)::double precision)))))
);


--
-- Name: metric_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."metric_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid",
    "group_id" "uuid",
    "metric_key" character varying(100) NOT NULL,
    "value" real NOT NULL,
    "definition_version_id" "uuid",
    "source_event_id" character varying(255),
    "source_policy" character varying(80),
    "exact_value" numeric(30,10),
    "numerator" numeric(30,10),
    "denominator" numeric(30,10),
    "sample_count" integer,
    "attribution_quality" character varying(40),
    "recorded_at" timestamp with time zone NOT NULL,
    "event_at" timestamp with time zone,
    "property_local_date" character varying(10),
    "data_quality" character varying(20),
    "retention_class" character varying(50),
    "portal_destination_kind" character varying(24),
    "attributed_staff_participant_id" "uuid",
    "attributed_staff_participation_id" "uuid",
    "attribution_responsibility_id" "uuid",
    "staff_attribution_effective_from" timestamp with time zone,
    "staff_attribution_effective_to" timestamp with time zone,
    "portal_link_id" "uuid",
    CONSTRAINT "metric_readings_attribution_quality_check" CHECK ((("attribution_quality" IS NULL) OR (("attribution_quality")::"text" = ANY ((ARRAY['exact'::character varying, 'current_state_backfill'::character varying, 'unresolved'::character varying])::"text"[])))),
    CONSTRAINT "metric_readings_governed_provenance_check" CHECK ((("definition_version_id" IS NULL) OR (("source_event_id" IS NOT NULL) AND ("source_policy" IS NOT NULL) AND ("exact_value" IS NOT NULL) AND ("sample_count" IS NOT NULL) AND ("attribution_quality" IS NOT NULL) AND ("event_at" IS NOT NULL) AND ("property_local_date" IS NOT NULL) AND ("data_quality" IS NOT NULL) AND ("retention_class" IS NOT NULL)))),
    CONSTRAINT "metric_readings_portal_destination_kind_check" CHECK ((("portal_destination_kind" IS NULL) OR ((("metric_key")::"text" = 'portal.review_link_click'::"text") AND (("portal_destination_kind")::"text" = ANY ((ARRAY['google_review'::character varying, 'secondary_link'::character varying])::"text"[]))))),
    CONSTRAINT "metric_readings_portal_link_check" CHECK ((("portal_link_id" IS NULL) OR ((("metric_key")::"text" = 'portal.review_link_click'::"text") AND (("portal_destination_kind")::"text" = 'secondary_link'::"text")))),
    CONSTRAINT "metric_readings_ratio_check" CHECK (((("numerator" IS NULL) AND ("denominator" IS NULL)) OR (("numerator" IS NOT NULL) AND ("denominator" IS NOT NULL) AND ("denominator" > (0)::numeric)))),
    CONSTRAINT "metric_readings_staff_attribution_complete" CHECK (((("attributed_staff_participant_id" IS NULL) AND ("attributed_staff_participation_id" IS NULL) AND ("attribution_responsibility_id" IS NULL) AND ("staff_attribution_effective_from" IS NULL) AND ("staff_attribution_effective_to" IS NULL)) OR (("portal_id" IS NOT NULL) AND ("attributed_staff_participant_id" IS NOT NULL) AND ("attributed_staff_participation_id" IS NOT NULL) AND ("attribution_responsibility_id" IS NOT NULL) AND ("staff_attribution_effective_from" IS NOT NULL) AND (("staff_attribution_effective_to" IS NULL) OR ("staff_attribution_effective_to" > "staff_attribution_effective_from")))))
);


--
-- Name: notification_category_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_category_defaults" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "category" character varying(40) NOT NULL,
    "channel" character varying(16) NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "cadence" character varying(16) DEFAULT 'daily'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "max_rating" smallint,
    CONSTRAINT "notification_category_defaults_cadence_valid" CHECK ((("cadence")::"text" = ANY ((ARRAY['immediate'::character varying, 'daily'::character varying])::"text"[]))),
    CONSTRAINT "notification_category_defaults_channel_valid" CHECK ((("channel")::"text" = ANY ((ARRAY['in_app'::character varying, 'email'::character varying])::"text"[]))),
    CONSTRAINT "notification_category_defaults_configurable_category_check" CHECK ((("category")::"text" <> 'mandatory'::"text")),
    CONSTRAINT "notification_category_defaults_max_rating_range" CHECK ((("max_rating" IS NULL) OR (("max_rating" >= 1) AND ("max_rating" <= 4)))),
    CONSTRAINT "notification_category_defaults_max_rating_scope" CHECK (((("category")::"text" = 'low_ratings'::"text") = ("max_rating" IS NOT NULL))),
    CONSTRAINT "notification_category_defaults_required_enabled" CHECK (("enabled" OR (NOT ((("category")::"text" = 'urgent_operational'::"text") AND (("channel")::"text" = 'in_app'::"text")))))
);


--
-- Name: notification_digest_batch_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_digest_batch_members" (
    "batch_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "notification_email_id" "uuid" NOT NULL,
    "sort_index" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_digest_batch_members_sort_index_nonnegative" CHECK (("sort_index" >= 0))
);


--
-- Name: notification_digest_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_digest_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "local_date" "date" NOT NULL,
    "sequence" integer NOT NULL,
    "member_digest" character varying(64) NOT NULL,
    "content_digest" character varying(64) NOT NULL,
    "provider_idempotency_key" character varying(96) NOT NULL,
    "unsubscribe_key_version" character varying(32) DEFAULT 'legacy'::character varying NOT NULL,
    "state" character varying(16) DEFAULT 'prepared'::character varying NOT NULL,
    "provider_message_id" character varying(255),
    "outcome_class" character varying(24),
    "terminal_reason" character varying(64),
    "retry_count" integer DEFAULT 0 NOT NULL,
    "attempted_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_request" "jsonb",
    CONSTRAINT "notification_digest_batches_content_digest_valid" CHECK ((("content_digest")::"text" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "notification_digest_batches_member_digest_valid" CHECK ((("member_digest")::"text" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "notification_digest_batches_sequence_positive" CHECK (("sequence" > 0)),
    CONSTRAINT "notification_digest_batches_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['prepared'::character varying, 'retryable'::character varying, 'accepted'::character varying, 'terminal'::character varying])::"text"[])))
);


--
-- Name: notification_email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_email_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_id" "uuid" NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid",
    "category" character varying(40) NOT NULL,
    "cadence" character varying(16) DEFAULT 'daily'::character varying NOT NULL,
    "status" character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "priority" character varying(16) DEFAULT 'normal'::character varying NOT NULL,
    "idempotency_key" character varying(255) NOT NULL,
    "provider_message_id" character varying(255),
    "provider_state" character varying(24),
    "last_error_class" character varying(24),
    "suppression_reason" character varying(255),
    "not_before" timestamp with time zone,
    "next_attempt_at" timestamp with time zone,
    "attempted_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "retry_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recipient_audience" "jsonb",
    "provider_request" "jsonb",
    CONSTRAINT "notification_email_queue_mandatory_scope_check" CHECK ((((("category")::"text" = 'mandatory'::"text") AND ("property_id" IS NULL) AND (("cadence")::"text" = 'immediate'::"text")) OR ((("category")::"text" <> 'mandatory'::"text") AND ("property_id" IS NOT NULL))))
);


--
-- Name: notification_email_suppression_removals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_email_suppression_removals" (
    "address_hash" character varying(64) NOT NULL,
    "removed_at" timestamp with time zone NOT NULL,
    CONSTRAINT "notification_email_suppression_removals_address_hash_valid" CHECK ((("address_hash")::"text" ~ '^[a-f0-9]{64}$'::"text"))
);


--
-- Name: notification_email_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_email_suppressions" (
    "address_hash" character varying(64) NOT NULL,
    "reason" character varying(24) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_email_suppressions_address_hash_valid" CHECK ((("address_hash")::"text" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "notification_email_suppressions_reason_valid" CHECK ((("reason")::"text" = ANY ((ARRAY['bounced'::character varying, 'complained'::character varying, 'suppressed'::character varying])::"text"[])))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid",
    "category" character varying(40) NOT NULL,
    "channel" character varying(16) NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "cadence" character varying(16) DEFAULT 'daily'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "max_rating" smallint,
    CONSTRAINT "notification_preferences_cadence_valid" CHECK ((("cadence")::"text" = ANY ((ARRAY['immediate'::character varying, 'daily'::character varying])::"text"[]))),
    CONSTRAINT "notification_preferences_channel_valid" CHECK ((("channel")::"text" = ANY ((ARRAY['in_app'::character varying, 'email'::character varying])::"text"[]))),
    CONSTRAINT "notification_preferences_configurable_category_check" CHECK ((("category")::"text" <> 'mandatory'::"text")),
    CONSTRAINT "notification_preferences_max_rating_range" CHECK ((("max_rating" IS NULL) OR (("max_rating" >= 1) AND ("max_rating" <= 4)))),
    CONSTRAINT "notification_preferences_max_rating_scope" CHECK (((("category")::"text" = 'low_ratings'::"text") = ("max_rating" IS NOT NULL))),
    CONSTRAINT "notification_preferences_required_enabled" CHECK (("enabled" OR ((("category")::"text" <> 'mandatory'::"text") AND (NOT ((("category")::"text" = 'urgent_operational'::"text") AND (("channel")::"text" = 'in_app'::"text"))))))
);


--
-- Name: notification_property_delivery_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_property_delivery_windows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "quiet_hours_start" time without time zone,
    "quiet_hours_end" time without time zone,
    "urgent_bypass_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_property_delivery_windows_quiet_distinct" CHECK ((("quiet_hours_start" IS NULL) OR ("quiet_hours_start" <> "quiet_hours_end"))),
    CONSTRAINT "notification_property_delivery_windows_quiet_pair" CHECK ((("quiet_hours_start" IS NULL) = ("quiet_hours_end" IS NULL)))
);


--
-- Name: notification_unsubscribe_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_unsubscribe_scopes" (
    "target_kind" character varying(16) NOT NULL,
    "target_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "category" character varying(40) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_unsubscribe_scopes_optional_only" CHECK ((("category")::"text" <> 'mandatory'::"text")),
    CONSTRAINT "notification_unsubscribe_scopes_target_kind_valid" CHECK ((("target_kind")::"text" = ANY ((ARRAY['email'::character varying, 'digest'::character varying])::"text"[])))
);


--
-- Name: notification_user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notification_user_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "locale" character varying(35) DEFAULT 'en'::character varying NOT NULL,
    "timezone" character varying(64) DEFAULT 'UTC'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "quiet_hours_start" time without time zone,
    "quiet_hours_end" time without time zone,
    "urgent_bypass_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "notification_user_settings_quiet_distinct" CHECK ((("quiet_hours_start" IS NULL) OR ("quiet_hours_start" <> "quiet_hours_end"))),
    CONSTRAINT "notification_user_settings_quiet_pair" CHECK ((("quiet_hours_start" IS NULL) = ("quiet_hours_end" IS NULL)))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid",
    "type" character varying(64) NOT NULL,
    "category" character varying(40) NOT NULL,
    "priority" character varying(16) DEFAULT 'normal'::character varying NOT NULL,
    "status" character varying(16) DEFAULT 'unread'::character varying NOT NULL,
    "resource_type" character varying(50) NOT NULL,
    "resource_id" character varying(255) NOT NULL,
    "event_id" character varying(255) NOT NULL,
    "title" character varying(255) NOT NULL,
    "body" "text",
    "payload" "jsonb",
    "coalesced_count" integer DEFAULT 1 NOT NULL,
    "coalesced_latest_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "notifications_mandatory_scope_check" CHECK ((((("category")::"text" = 'mandatory'::"text") AND ("property_id" IS NULL) AND (("resource_type")::"text" = 'organization'::"text")) OR ((("type")::"text" = 'beta_feedback.outcome'::"text") AND (("category")::"text" = 'workflow_collaboration'::"text") AND ("property_id" IS NULL) AND (("resource_type")::"text" = 'beta_feedback_report'::"text")) OR ((("type")::"text" = 'integration.google_disconnected'::"text") AND (("category")::"text" = 'workflow_collaboration'::"text") AND ("property_id" IS NULL) AND (("resource_type")::"text" = 'integration'::"text")) OR ((("type")::"text" = 'integration.reauthorization_required'::"text") AND (("category")::"text" = 'urgent_operational'::"text") AND ("property_id" IS NULL) AND (("resource_type")::"text" = 'integration'::"text")) OR ((("category")::"text" <> 'mandatory'::"text") AND ("property_id" IS NOT NULL) AND (("resource_type")::"text" <> ALL ((ARRAY['organization'::character varying, 'beta_feedback_report'::character varying])::"text"[]))))),
    CONSTRAINT "notifications_source_content_free_check" CHECK (((NOT (COALESCE("payload", '{}'::"jsonb") ? 'rating'::"text")) AND
CASE
    WHEN (COALESCE("payload", '{}'::"jsonb") ? 'guestRating'::"text") THEN COALESCE(((("payload" ->> 'platform'::"text") = 'portal'::"text") AND ("jsonb_typeof"(("payload" -> 'guestRating'::"text")) = 'number'::"text") AND (("payload" ->> 'guestRating'::"text") = ANY (ARRAY['1'::"text", '2'::"text", '3'::"text", '4'::"text", '5'::"text"]))), false)
    ELSE true
END))
);


--
-- Name: operational_action_history_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."operational_action_history_heads" (
    "organization_id" character varying(255) NOT NULL,
    "last_sequence" bigint DEFAULT 0 NOT NULL,
    "last_recorded_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "operational_action_history_heads_sequence_nonnegative" CHECK (("last_sequence" >= 0))
);


--
-- Name: operational_action_history_legal_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."operational_action_history_legal_holds" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "reason_code" character varying(128) NOT NULL,
    "protects_from" timestamp with time zone NOT NULL,
    "protects_through" timestamp with time zone,
    "placed_at" timestamp with time zone NOT NULL,
    "placed_by_actor_id" character varying(255) NOT NULL,
    "released_at" timestamp with time zone,
    "released_by_actor_id" character varying(255),
    "release_reason_code" character varying(128),
    CONSTRAINT "operational_action_history_hold_identifiers_valid" CHECK (((("reason_code")::"text" ~ '^[a-z][a-z0-9_.:-]{0,127}$'::"text") AND (("placed_by_actor_id")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text") AND (("released_by_actor_id" IS NULL) OR (("released_by_actor_id")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")) AND (("release_reason_code" IS NULL) OR (("release_reason_code")::"text" ~ '^[a-z][a-z0-9_.:-]{0,127}$'::"text")))),
    CONSTRAINT "operational_action_history_hold_interval_valid" CHECK ((("protects_through" IS NULL) OR ("protects_through" >= "protects_from"))),
    CONSTRAINT "operational_action_history_hold_release_valid" CHECK (((("released_at" IS NULL) AND ("released_by_actor_id" IS NULL) AND ("release_reason_code" IS NULL)) OR (("released_at" IS NOT NULL) AND ("released_by_actor_id" IS NOT NULL) AND ("release_reason_code" IS NOT NULL) AND ("released_at" >= "placed_at"))))
);


--
-- Name: operational_action_history_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."operational_action_history_records" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "sequence" bigint NOT NULL,
    "property_id" character varying(255),
    "actor_type" character varying(16) NOT NULL,
    "actor_id" character varying(255),
    "actor_redacted_at" timestamp with time zone,
    "action" character varying(80) NOT NULL,
    "outcome" character varying(16) NOT NULL,
    "resource_type" character varying(40) NOT NULL,
    "resource_id" character varying(255),
    "resource_redacted_at" timestamp with time zone,
    "reason_code" character varying(128),
    "provenance_kind" character varying(32) NOT NULL,
    "provenance_id" character varying(255) NOT NULL,
    "source_event_type" character varying(128),
    "source_event_version" integer,
    "source_context" character varying(128),
    "source_aggregate_id" character varying(255),
    "occurred_at" timestamp with time zone NOT NULL,
    "recorded_at" timestamp with time zone NOT NULL,
    CONSTRAINT "operational_action_history_actor_valid" CHECK ((((("actor_type")::"text" = ANY ((ARRAY['user'::character varying, 'operator'::character varying, 'service'::character varying])::"text"[])) AND (("actor_id" IS NOT NULL) OR ("actor_redacted_at" IS NOT NULL))) OR ((("actor_type")::"text" = ANY ((ARRAY['system'::character varying, 'public'::character varying])::"text"[])) AND ("actor_id" IS NULL) AND ("actor_redacted_at" IS NULL)))),
    CONSTRAINT "operational_action_history_identifier_shape" CHECK (((("actor_id" IS NULL) OR (("actor_id")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")) AND (("resource_id" IS NULL) OR (("resource_id")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")) AND (("provenance_id")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text") AND (("reason_code" IS NULL) OR (("reason_code")::"text" ~ '^[a-z][a-z0-9_.:-]{0,127}$'::"text")))),
    CONSTRAINT "operational_action_history_kind_valid" CHECK ((((("action")::"text" = 'authentication.decision'::"text") AND (("resource_type")::"text" = 'account'::"text")) OR ((("action")::"text" = 'authorization.decision'::"text") AND (("resource_type")::"text" = 'policy'::"text")) OR ((("action")::"text" = 'member.role_changed'::"text") AND (("resource_type")::"text" = 'member'::"text")) OR ((("action")::"text" = 'property_access.changed'::"text") AND (("resource_type")::"text" = 'property_grant'::"text")) OR ((("action")::"text" = 'sensitive_data.accessed'::"text") AND (("resource_type")::"text" = 'data_export'::"text")) OR ((("action")::"text" = 'sensitive_data.exported'::"text") AND (("resource_type")::"text" = 'data_export'::"text")) OR ((("action")::"text" = 'capability.changed'::"text") AND (("resource_type")::"text" = 'capability'::"text")) OR ((("action")::"text" = 'policy.changed'::"text") AND (("resource_type")::"text" = 'policy'::"text")) OR ((("action")::"text" = 'google_connection.connected'::"text") AND (("resource_type")::"text" = 'google_connection'::"text")) OR ((("action")::"text" = 'google_connection.disconnected'::"text") AND (("resource_type")::"text" = 'google_connection'::"text")) OR ((("action")::"text" = 'google_reply.published'::"text") AND (("resource_type")::"text" = 'reply'::"text")) OR ((("action")::"text" = 'guest_feedback.moderated'::"text") AND (("resource_type")::"text" = 'feedback'::"text")) OR ((("action")::"text" = 'portal_upload.validated'::"text") AND (("resource_type")::"text" = 'upload'::"text")) OR ((("action")::"text" = 'privacy_request.received'::"text") AND (("resource_type")::"text" = 'privacy_request'::"text")) OR ((("action")::"text" = 'privacy_request.fulfilled'::"text") AND (("resource_type")::"text" = 'privacy_request'::"text")) OR ((("action")::"text" = 'property.archived'::"text") AND (("resource_type")::"text" = 'property'::"text")) OR ((("action")::"text" = 'property.restored'::"text") AND (("resource_type")::"text" = 'property'::"text")) OR ((("action")::"text" = 'property.deleted'::"text") AND (("resource_type")::"text" = 'property'::"text")) OR ((("action")::"text" = 'portal.archived'::"text") AND (("resource_type")::"text" = 'portal'::"text")) OR ((("action")::"text" = 'portal.published'::"text") AND (("resource_type")::"text" = 'portal'::"text")) OR ((("action")::"text" = 'operator.command_executed'::"text") AND (("resource_type")::"text" = 'operator_command'::"text")) OR ((("action")::"text" = 'operational_history.accessed'::"text") AND (("resource_type")::"text" = 'operational_history'::"text")) OR ((("action")::"text" = 'operational_history.exported'::"text") AND (("resource_type")::"text" = 'operational_history'::"text")) OR ((("action")::"text" = 'operational_history.legal_hold_placed'::"text") AND (("resource_type")::"text" = 'operational_history'::"text")) OR ((("action")::"text" = 'operational_history.legal_hold_released'::"text") AND (("resource_type")::"text" = 'operational_history'::"text")) OR ((("action")::"text" = 'operational_history.redaction_applied'::"text") AND (("resource_type")::"text" = 'operational_history'::"text")) OR ((("action")::"text" = 'operational_history.retention_assessed'::"text") AND (("resource_type")::"text" = 'operational_history'::"text")))),
    CONSTRAINT "operational_action_history_outcome_valid" CHECK ((("outcome")::"text" = ANY ((ARRAY['succeeded'::character varying, 'denied'::character varying, 'failed'::character varying])::"text"[]))),
    CONSTRAINT "operational_action_history_provenance_valid" CHECK ((((("provenance_kind")::"text" = 'domain_fact'::"text") AND (("source_event_type")::"text" ~ '^[a-z][a-z0-9_.:-]{0,127}$'::"text") AND ("source_event_version" >= 1) AND (("source_context")::"text" ~ '^[a-z][a-z0-9_.:-]{0,127}$'::"text") AND (("source_aggregate_id")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$'::"text")) OR ((("provenance_kind")::"text" = ANY ((ARRAY['policy_decision'::character varying, 'interactive_command'::character varying, 'worker_command'::character varying, 'operator_command'::character varying, 'history_access'::character varying, 'history_lifecycle'::character varying])::"text"[])) AND ("source_event_type" IS NULL) AND ("source_event_version" IS NULL) AND ("source_context" IS NULL) AND ("source_aggregate_id" IS NULL)))),
    CONSTRAINT "operational_action_history_resource_valid" CHECK ((("resource_id" IS NOT NULL) OR ("resource_redacted_at" IS NOT NULL) OR (("action")::"text" = ANY ((ARRAY['authentication.decision'::character varying, 'authorization.decision'::character varying])::"text"[])))),
    CONSTRAINT "operational_action_history_sequence_positive" CHECK (("sequence" >= 1)),
    CONSTRAINT "operational_action_history_time_valid" CHECK ((("recorded_at" >= "occurred_at") AND (("actor_redacted_at" IS NULL) OR ("actor_redacted_at" >= "recorded_at")) AND (("resource_redacted_at" IS NULL) OR ("resource_redacted_at" >= "recorded_at"))))
);


--
-- Name: organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organization" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "logo" "text",
    "createdAt" timestamp with time zone NOT NULL,
    "metadata" "text",
    "contactEmail" "text"
);


--
-- Name: organizationRole; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organizationRole" (
    "id" "text" NOT NULL,
    "organizationId" "text" NOT NULL,
    "role" "text" NOT NULL,
    "permission" "text" NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone
);


--
-- Name: organization_export_retrieval_issuances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organization_export_retrieval_issuances" (
    "export_id" "uuid" NOT NULL,
    "organization_id" "text" NOT NULL,
    "export_revision" integer NOT NULL,
    "operation_id" "uuid" NOT NULL,
    "token_digest" character(64) NOT NULL,
    "issued_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_export_retrieval_issuances_digest_valid" CHECK (("token_digest" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "organization_export_retrieval_issuances_expiry_valid" CHECK ((("expires_at" > "issued_at") AND ("expires_at" <= ("issued_at" + '24:00:00'::interval)))),
    CONSTRAINT "organization_export_retrieval_issuances_revision_positive" CHECK (("export_revision" > 0))
);


--
-- Name: organization_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organization_exports" (
    "id" "uuid" NOT NULL,
    "organization_id" "text" NOT NULL,
    "requested_by" character varying(255) NOT NULL,
    "state" "text" DEFAULT 'requested'::"text" NOT NULL,
    "revision" integer DEFAULT 1 NOT NULL,
    "format_version" character varying(64) DEFAULT 'organization-export/v1'::character varying NOT NULL,
    "as_of" timestamp with time zone NOT NULL,
    "object_expires_at" timestamp with time zone NOT NULL,
    "generation_lease_expires_at" timestamp with time zone,
    "coverage_sha256" character varying(64),
    "manifest_sha256" character varying(64),
    "archive_sha256" character varying(64),
    "object_key" character varying(200),
    "encryption_evidence_ref" character varying(200),
    "pre_egress_recorded_at" timestamp with time zone,
    "egress_recovery_attempts" integer DEFAULT 0 NOT NULL,
    "retrieval_operation_id" "uuid",
    "retrieval_token_digest" character varying(64),
    "retrieval_issued_at" timestamp with time zone,
    "retrieval_expires_at" timestamp with time zone,
    "retrieved_at" timestamp with time zone,
    "deletion_evidence_ref" character varying(200),
    "deleted_at" timestamp with time zone,
    "last_error_code" character varying(64),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_export_deletion_shape" CHECK (((("state" = 'deleted'::"text") AND ("deleted_at" IS NOT NULL) AND ("deletion_evidence_ref" IS NOT NULL)) OR (("state" <> 'deleted'::"text") AND ("deleted_at" IS NULL) AND ("deletion_evidence_ref" IS NULL)))),
    CONSTRAINT "organization_export_digest_shape" CHECK (((("coverage_sha256" IS NULL) OR (("coverage_sha256")::"text" ~ '^[a-f0-9]{64}$'::"text")) AND (("manifest_sha256" IS NULL) OR (("manifest_sha256")::"text" ~ '^[a-f0-9]{64}$'::"text")) AND (("archive_sha256" IS NULL) OR (("archive_sha256")::"text" ~ '^[a-f0-9]{64}$'::"text")) AND (("retrieval_token_digest" IS NULL) OR (("retrieval_token_digest")::"text" ~ '^[a-f0-9]{64}$'::"text")))),
    CONSTRAINT "organization_export_error_code_shape" CHECK ((("last_error_code" IS NULL) OR (("last_error_code")::"text" ~ '^[a-z][a-z0-9_]{0,63}$'::"text"))),
    CONSTRAINT "organization_export_evidence_ref_shape" CHECK (((("encryption_evidence_ref" IS NULL) OR (("encryption_evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text")) AND (("deletion_evidence_ref" IS NULL) OR (("deletion_evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text")))),
    CONSTRAINT "organization_export_object_expiry_bounded" CHECK ((("object_expires_at" > "created_at") AND ("object_expires_at" <= ("created_at" + '7 days'::interval)))),
    CONSTRAINT "organization_export_recovery_attempts_nonnegative" CHECK (("egress_recovery_attempts" >= 0)),
    CONSTRAINT "organization_export_retrieval_shape" CHECK (((("state" = 'retrieval_issued'::"text") AND ("retrieval_operation_id" IS NOT NULL) AND ("retrieval_token_digest" IS NOT NULL) AND ("retrieval_issued_at" IS NOT NULL) AND ("retrieval_expires_at" > "retrieval_issued_at") AND ("retrieval_expires_at" <= ("retrieval_issued_at" + '24:00:00'::interval)) AND ("retrieval_expires_at" <= "object_expires_at") AND ("retrieved_at" IS NULL)) OR (("state" = 'retrieved'::"text") AND ("retrieval_operation_id" IS NOT NULL) AND ("retrieval_token_digest" IS NULL) AND ("retrieval_issued_at" IS NOT NULL) AND ("retrieval_expires_at" IS NULL) AND ("retrieved_at" IS NOT NULL)) OR (("state" <> ALL (ARRAY['retrieval_issued'::"text", 'retrieved'::"text"])) AND ("retrieval_operation_id" IS NULL) AND ("retrieval_token_digest" IS NULL) AND ("retrieval_issued_at" IS NULL) AND ("retrieval_expires_at" IS NULL) AND ("retrieved_at" IS NULL)))),
    CONSTRAINT "organization_export_revision_positive" CHECK (("revision" >= 1)),
    CONSTRAINT "organization_export_state_shape" CHECK (((("state" = 'requested'::"text") AND ("generation_lease_expires_at" IS NULL) AND ("coverage_sha256" IS NULL) AND ("manifest_sha256" IS NULL) AND ("archive_sha256" IS NULL) AND ("object_key" IS NULL) AND ("encryption_evidence_ref" IS NULL) AND ("pre_egress_recorded_at" IS NULL) AND ("last_error_code" IS NULL)) OR (("state" = 'generating'::"text") AND ("generation_lease_expires_at" IS NOT NULL) AND ("coverage_sha256" IS NULL) AND ("manifest_sha256" IS NULL) AND ("archive_sha256" IS NULL) AND ("object_key" IS NULL) AND ("encryption_evidence_ref" IS NULL) AND ("pre_egress_recorded_at" IS NULL) AND ("last_error_code" IS NULL)) OR (("state" = 'egress_pending'::"text") AND ("generation_lease_expires_at" IS NOT NULL) AND ("coverage_sha256" IS NOT NULL) AND ("manifest_sha256" IS NOT NULL) AND ("archive_sha256" IS NOT NULL) AND ("object_key" IS NOT NULL) AND ("encryption_evidence_ref" IS NULL) AND ("pre_egress_recorded_at" IS NOT NULL) AND ("last_error_code" IS NULL)) OR (("state" = ANY (ARRAY['ready'::"text", 'retrieval_issued'::"text", 'retrieved'::"text", 'delete_pending'::"text", 'deleted'::"text"])) AND ("generation_lease_expires_at" IS NULL) AND ("coverage_sha256" IS NOT NULL) AND ("manifest_sha256" IS NOT NULL) AND ("archive_sha256" IS NOT NULL) AND ("object_key" IS NOT NULL) AND ("encryption_evidence_ref" IS NOT NULL) AND ("last_error_code" IS NULL)) OR (("state" = 'failed'::"text") AND ("generation_lease_expires_at" IS NULL) AND ("encryption_evidence_ref" IS NULL) AND ("last_error_code" IS NOT NULL) AND ((("coverage_sha256" IS NULL) AND ("manifest_sha256" IS NULL) AND ("archive_sha256" IS NULL) AND ("object_key" IS NULL) AND ("pre_egress_recorded_at" IS NULL)) OR (("coverage_sha256" IS NOT NULL) AND ("manifest_sha256" IS NOT NULL) AND ("archive_sha256" IS NOT NULL) AND ("object_key" IS NOT NULL) AND ("pre_egress_recorded_at" IS NOT NULL)))))),
    CONSTRAINT "organization_export_state_valid" CHECK (("state" = ANY (ARRAY['requested'::"text", 'generating'::"text", 'egress_pending'::"text", 'ready'::"text", 'retrieval_issued'::"text", 'retrieved'::"text", 'delete_pending'::"text", 'deleted'::"text", 'failed'::"text"]))),
    CONSTRAINT "organization_export_version_fixed" CHECK ((("format_version")::"text" = 'organization-export/v1'::"text"))
);


--
-- Name: organization_lifecycle_authority; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organization_lifecycle_authority" (
    "organization_id" "text" NOT NULL,
    "state" "text" DEFAULT 'active'::"text" NOT NULL,
    "revision" integer DEFAULT 0 NOT NULL,
    "closure_lineage_id" "uuid",
    "closure_requested_at" timestamp with time zone,
    "recoverable_until" timestamp with time zone,
    "irreversible_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "reactivation_required" boolean DEFAULT false NOT NULL,
    "requested_by" character varying(255),
    "request_reason_code" character varying(64),
    "request_support_evidence_ref" character varying(200),
    "last_transition_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_actor_id" character varying(255) NOT NULL,
    "last_reason_code" character varying(64) NOT NULL,
    "last_support_evidence_ref" character varying(200) NOT NULL,
    CONSTRAINT "organization_lifecycle_evidence_ref_valid" CHECK (((("last_support_evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text") AND (("request_support_evidence_ref" IS NULL) OR (("request_support_evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text")))),
    CONSTRAINT "organization_lifecycle_reason_code_valid" CHECK ((("last_reason_code")::"text" ~ '^[a-z][a-z0-9_]{0,63}$'::"text")),
    CONSTRAINT "organization_lifecycle_request_reason_valid" CHECK ((("request_reason_code" IS NULL) OR (("request_reason_code")::"text" = ANY ((ARRAY['account_admin_request'::character varying, 'contract_ended'::character varying, 'duplicate_workspace'::character varying, 'privacy_request'::character varying, 'test_workspace'::character varying])::"text"[])))),
    CONSTRAINT "organization_lifecycle_revision_nonnegative" CHECK (("revision" >= 0)),
    CONSTRAINT "organization_lifecycle_state_shape" CHECK (((("state" = 'active'::"text") AND ("irreversible_at" IS NULL) AND ("closed_at" IS NULL) AND ((("closure_lineage_id" IS NULL) AND ("closure_requested_at" IS NULL) AND ("recoverable_until" IS NULL) AND ("requested_by" IS NULL) AND ("request_reason_code" IS NULL) AND ("request_support_evidence_ref" IS NULL) AND ("reactivation_required" = false)) OR (("closure_lineage_id" IS NOT NULL) AND ("closure_requested_at" IS NOT NULL) AND ("recoverable_until" > "closure_requested_at") AND ("requested_by" IS NOT NULL) AND ("request_reason_code" IS NOT NULL) AND ("request_support_evidence_ref" IS NOT NULL) AND ("reactivation_required" = true)))) OR (("state" = ANY (ARRAY['closure_requested'::"text", 'closing'::"text", 'purge_pending'::"text"])) AND ("closure_lineage_id" IS NOT NULL) AND ("closure_requested_at" IS NOT NULL) AND ("recoverable_until" > "closure_requested_at") AND ("requested_by" IS NOT NULL) AND ("request_reason_code" IS NOT NULL) AND ("request_support_evidence_ref" IS NOT NULL) AND ("irreversible_at" IS NULL) AND ("closed_at" IS NULL) AND ("reactivation_required" = true)) OR (("state" = 'purging'::"text") AND ("closure_lineage_id" IS NOT NULL) AND ("closure_requested_at" IS NOT NULL) AND ("recoverable_until" > "closure_requested_at") AND ("requested_by" IS NOT NULL) AND ("request_reason_code" IS NOT NULL) AND ("request_support_evidence_ref" IS NOT NULL) AND ("irreversible_at" IS NOT NULL) AND ("closed_at" IS NULL) AND ("reactivation_required" = true)) OR (("state" = 'closed'::"text") AND ("closure_lineage_id" IS NOT NULL) AND ("closure_requested_at" IS NOT NULL) AND ("recoverable_until" > "closure_requested_at") AND ("requested_by" IS NOT NULL) AND ("request_reason_code" IS NOT NULL) AND ("request_support_evidence_ref" IS NOT NULL) AND ("irreversible_at" IS NOT NULL) AND ("closed_at" IS NOT NULL) AND ("reactivation_required" = true)))),
    CONSTRAINT "organization_lifecycle_state_valid" CHECK (("state" = ANY (ARRAY['active'::"text", 'closure_requested'::"text", 'closing'::"text", 'purge_pending'::"text", 'purging'::"text", 'closed'::"text"])))
);


--
-- Name: organization_lifecycle_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organization_lifecycle_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "text" NOT NULL,
    "context" "text" NOT NULL,
    "phase" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_lifecycle_events_identity_valid" CHECK ((("context" = ANY (ARRAY['activity'::"text", 'ai'::"text", 'dashboard'::"text", 'goal'::"text", 'guest'::"text", 'identity'::"text", 'inbox'::"text", 'integration'::"text", 'metric'::"text", 'notification'::"text", 'portal'::"text", 'property'::"text", 'review'::"text", 'staff'::"text"])) AND (("length"("phase") >= 1) AND ("length"("phase") <= 32)) AND (("length"("kind") >= 1) AND ("length"("kind") <= 160)))),
    CONSTRAINT "organization_lifecycle_events_payload_object" CHECK (("jsonb_typeof"("payload") = 'object'::"text"))
);


--
-- Name: organization_reply_voices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organization_reply_voices" (
    "organization_id" character varying(255) NOT NULL,
    "use_first_name" boolean,
    "privacy_mode" boolean,
    "greeting_positive" character varying(16),
    "greeting_negative" character varying(16),
    "contact" character varying(200),
    "emoji_mode" character varying(16),
    "emoji_set" "text"[],
    "signer_name" character varying(120),
    "signer_title" character varying(120),
    "business_name_short" character varying(120),
    "visit_word_key" character varying(40),
    "localized" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "overridden_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_reply_voices_emoji_mode_valid" CHECK ((("emoji_mode" IS NULL) OR (("emoji_mode")::"text" = ANY ((ARRAY['off'::character varying, 'positive'::character varying])::"text"[])))),
    CONSTRAINT "organization_reply_voices_greetings_valid" CHECK (((("greeting_positive" IS NULL) OR (("greeting_positive")::"text" = ANY ((ARRAY['hi'::character varying, 'hello'::character varying, 'dear'::character varying])::"text"[]))) AND (("greeting_negative" IS NULL) OR (("greeting_negative")::"text" = ANY ((ARRAY['hi'::character varying, 'hello'::character varying, 'dear'::character varying])::"text"[]))))),
    CONSTRAINT "organization_reply_voices_version_positive" CHECK (("version" >= 1))
);


--
-- Name: organization_role_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."organization_role_policy" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "text" NOT NULL,
    "role" "text" NOT NULL,
    "data_scope" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_role_policy_data_scope_check" CHECK (("data_scope" = ANY (ARRAY['organization'::"text", 'assigned-properties'::"text", 'none'::"text"]))),
    CONSTRAINT "organization_role_policy_role_format_check" CHECK (("role" ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'::"text")),
    CONSTRAINT "organization_role_policy_role_no_comma_check" CHECK ((POSITION((','::"text") IN ("role")) = 0)),
    CONSTRAINT "organization_role_policy_role_not_reserved_check" CHECK (("role" <> ALL (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."outbox_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "event_version" integer DEFAULT 1 NOT NULL,
    "payload" "jsonb" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" character varying(255),
    "source_context" "text" NOT NULL,
    "source_aggregate_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    "lease_owner" "text",
    "leased_at" timestamp with time zone,
    "lease_expires_at" timestamp with time zone,
    "recovery_fence_run_id" "uuid",
    "recovery_fenced_at" timestamp with time zone,
    "consumer_redelivery_attempts" integer DEFAULT 0 NOT NULL,
    "consumer_redelivery_next_at" timestamp with time zone,
    CONSTRAINT "outbox_events_consumer_redelivery_attempts_nonnegative" CHECK (("consumer_redelivery_attempts" >= 0)),
    CONSTRAINT "outbox_events_identity_member_invited_v2_check" CHECK ((("event_type" <> 'identity.member.invited'::"text") OR (("event_version" = 2) AND ("jsonb_typeof"("payload") = 'object'::"text") AND (NOT ("payload" ? 'email'::"text"))))),
    CONSTRAINT "outbox_events_recovery_fence_pair_check" CHECK ((("recovery_fence_run_id" IS NULL) = ("recovery_fenced_at" IS NULL)))
);


--
-- Name: permission_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."permission_version" (
    "organization_id" "text" NOT NULL,
    "version" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: policy_consent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."policy_consent" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "text" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "text" NOT NULL,
    "purpose" "text" NOT NULL,
    "state" "text" DEFAULT 'granted'::"text" NOT NULL,
    "recorded_by" "text",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "policy_consent_state_check" CHECK (("state" = ANY (ARRAY['granted'::"text", 'revoked'::"text"]))),
    CONSTRAINT "policy_consent_subject_check" CHECK (("subject_type" = ANY (ARRAY['organization'::"text", 'property'::"text", 'user'::"text"])))
);


--
-- Name: portal_access_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_access_artifacts" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "portal_token_id" "uuid" NOT NULL,
    "channel" character varying(16) NOT NULL,
    "status" character varying(16) DEFAULT 'published'::character varying NOT NULL,
    "published_at" timestamp with time zone NOT NULL,
    "retired_at" timestamp with time zone,
    CONSTRAINT "portal_access_artifacts_channel_valid" CHECK ((("channel")::"text" = ANY ((ARRAY['qr'::character varying, 'nfc'::character varying])::"text"[]))),
    CONSTRAINT "portal_access_artifacts_retirement_valid" CHECK ((((("status")::"text" = 'published'::"text") AND ("retired_at" IS NULL)) OR ((("status")::"text" <> 'published'::"text") AND ("retired_at" IS NOT NULL) AND ("retired_at" >= "published_at")))),
    CONSTRAINT "portal_access_artifacts_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['published'::character varying, 'retiring'::character varying, 'retired'::character varying, 'revoked'::character varying])::"text"[])))
);


--
-- Name: portal_address_downloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_address_downloads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "portal_token_id" "uuid" NOT NULL,
    "downloaded_by" character varying(255) NOT NULL,
    "purpose" character varying(16) NOT NULL,
    "downloaded_at" timestamp with time zone NOT NULL,
    CONSTRAINT "portal_address_downloads_purpose_valid" CHECK ((("purpose")::"text" = ANY ((ARRAY['download'::character varying, 'copy'::character varying, 'show'::character varying])::"text"[])))
);


--
-- Name: portal_approved_destinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_approved_destinations" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "normalized_uri" character varying(500) NOT NULL,
    "hostname" character varying(255) NOT NULL,
    "source_type" character varying(20) NOT NULL,
    "approval_state" character varying(20) NOT NULL,
    "validation_version" character varying(80) NOT NULL,
    "requested_by" character varying(255) NOT NULL,
    "approved_by" character varying(255),
    "approved_at" timestamp with time zone,
    "disabled_at" timestamp with time zone,
    "disabled_reason" character varying(500),
    "last_validated_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "validation_failures" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "portal_approved_destinations_approval_valid" CHECK ((((("approval_state")::"text" = 'approved'::"text") AND ("approved_by" IS NOT NULL) AND ("approved_at" IS NOT NULL) AND ("disabled_at" IS NULL)) OR (("approval_state")::"text" <> 'approved'::"text"))),
    CONSTRAINT "portal_approved_destinations_source_valid" CHECK ((("source_type")::"text" = ANY ((ARRAY['recognized'::character varying, 'custom'::character varying, 'provider'::character varying, 'contact'::character varying])::"text"[]))),
    CONSTRAINT "portal_approved_destinations_state_valid" CHECK ((("approval_state")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'disabled'::character varying, 'quarantined'::character varying])::"text"[])))
);


--
-- Name: portal_goal_prompt_deferrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_goal_prompt_deferrals" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "month" character varying(7) NOT NULL,
    "deferred_by" character varying(255) NOT NULL,
    "deferred_at" timestamp with time zone NOT NULL,
    CONSTRAINT "portal_goal_prompt_deferrals_month_check" CHECK ((("month")::"text" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::"text"))
);


--
-- Name: portal_group_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_group_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_group_id" "uuid" NOT NULL,
    "kind" character varying(20) NOT NULL,
    "portal_id" "uuid",
    "other_group_id" "uuid",
    "name" character varying(100),
    "previous_name" character varying(100),
    "actor_user_id" character varying(255) NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "portal_group_history_kind_valid" CHECK ((("kind")::"text" = ANY ((ARRAY['created'::character varying, 'renamed'::character varying, 'archived'::character varying, 'portal_added'::character varying, 'portal_removed'::character varying, 'portal_moved_in'::character varying, 'portal_moved_out'::character varying])::"text"[]))),
    CONSTRAINT "portal_group_history_shape" CHECK ((((("kind")::"text" = 'created'::"text") AND ("name" IS NOT NULL) AND ("previous_name" IS NULL) AND ("portal_id" IS NULL) AND ("other_group_id" IS NULL)) OR ((("kind")::"text" = 'renamed'::"text") AND ("name" IS NOT NULL) AND ("previous_name" IS NOT NULL) AND ("portal_id" IS NULL) AND ("other_group_id" IS NULL)) OR ((("kind")::"text" = 'archived'::"text") AND ("name" IS NULL) AND ("previous_name" IS NULL) AND ("portal_id" IS NULL) AND ("other_group_id" IS NULL)) OR ((("kind")::"text" = ANY ((ARRAY['portal_added'::character varying, 'portal_removed'::character varying])::"text"[])) AND ("name" IS NULL) AND ("previous_name" IS NULL) AND ("portal_id" IS NOT NULL) AND ("other_group_id" IS NULL)) OR ((("kind")::"text" = ANY ((ARRAY['portal_moved_in'::character varying, 'portal_moved_out'::character varying])::"text"[])) AND ("name" IS NULL) AND ("previous_name" IS NULL) AND ("portal_id" IS NOT NULL) AND ("other_group_id" IS NOT NULL))))
);


--
-- Name: portal_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portal_group_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: portal_group_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_group_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "portal_group_id" "uuid" NOT NULL,
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "effective_to" timestamp with time zone,
    "created_by" character varying(255) NOT NULL,
    "end_reason" "text"
);


--
-- Name: portal_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "sort_key" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_by" character varying(255)
);


--
-- Name: portal_health_intervals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_health_intervals" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "status" character varying(20) NOT NULL,
    "reason" character varying(80) NOT NULL,
    "source_version" character varying(160) NOT NULL,
    "effective_from" timestamp with time zone NOT NULL,
    "effective_to" timestamp with time zone,
    "observed_at" timestamp with time zone NOT NULL,
    CONSTRAINT "portal_health_intervals_interval_valid" CHECK ((("effective_to" IS NULL) OR ("effective_to" > "effective_from"))),
    CONSTRAINT "portal_health_intervals_observation_valid" CHECK (("observed_at" >= "effective_from")),
    CONSTRAINT "portal_health_intervals_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['healthy'::character varying, 'degraded'::character varying, 'unavailable'::character varying])::"text"[])))
);


--
-- Name: portal_last_prints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_last_prints" (
    "portal_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "piece" character varying(16) NOT NULL,
    "orientation" character varying(16) NOT NULL,
    "look" character varying(16) NOT NULL,
    "paper" character varying(16) NOT NULL,
    "printer" character varying(16) NOT NULL,
    "quantity" integer NOT NULL,
    "fill_spares" boolean NOT NULL,
    "per_sheet" integer,
    "crop_marks" boolean NOT NULL,
    "back_page" boolean NOT NULL,
    "languages" "jsonb" NOT NULL,
    "call_to_action" character varying(32) NOT NULL,
    "photo_asset_id" "uuid",
    "photo_focal_x" double precision,
    "photo_focal_y" double precision,
    "printed_at" timestamp with time zone NOT NULL,
    "call_to_action_custom" "jsonb",
    CONSTRAINT "portal_last_prints_call_to_action_custom_valid" CHECK ((("call_to_action_custom" IS NULL) OR ("jsonb_typeof"("call_to_action_custom") = 'object'::"text"))),
    CONSTRAINT "portal_last_prints_call_to_action_valid" CHECK ((("call_to_action")::"text" = ANY ((ARRAY['how_did_we_do'::character varying, 'how_was_visit'::character varying, 'how_was_stay'::character varying, 'rate_visit'::character varying, 'got_30_seconds'::character varying])::"text"[]))),
    CONSTRAINT "portal_last_prints_languages_valid" CHECK ((("jsonb_typeof"("languages") = 'array'::"text") AND (("jsonb_array_length"("languages") >= 1) AND ("jsonb_array_length"("languages") <= 2)))),
    CONSTRAINT "portal_last_prints_look_valid" CHECK ((("look")::"text" = ANY ((ARRAY['paper'::character varying, 'immersive'::character varying])::"text"[]))),
    CONSTRAINT "portal_last_prints_orientation_valid" CHECK ((("orientation")::"text" = ANY ((ARRAY['upright'::character varying, 'wide'::character varying])::"text"[]))),
    CONSTRAINT "portal_last_prints_paper_valid" CHECK ((("paper")::"text" = ANY ((ARRAY['letter'::character varying, 'a4'::character varying])::"text"[]))),
    CONSTRAINT "portal_last_prints_per_sheet_valid" CHECK ((("per_sheet" IS NULL) OR ("per_sheet" >= 1))),
    CONSTRAINT "portal_last_prints_photo_whole" CHECK (((("photo_asset_id" IS NULL) = ("photo_focal_x" IS NULL)) AND (("photo_asset_id" IS NULL) = ("photo_focal_y" IS NULL)))),
    CONSTRAINT "portal_last_prints_piece_valid" CHECK ((("piece")::"text" = ANY ((ARRAY['counter'::character varying, 'tent'::character varying, 'small'::character varying])::"text"[]))),
    CONSTRAINT "portal_last_prints_printer_valid" CHECK ((("printer")::"text" = ANY ((ARRAY['my_printer'::character varying, 'print_shop'::character varying])::"text"[]))),
    CONSTRAINT "portal_last_prints_quantity_valid" CHECK ((("quantity" >= 1) AND ("quantity" <= 1000)))
);


--
-- Name: portal_link_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_link_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "title" character varying(100) NOT NULL,
    "sort_key" character varying(50) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: portal_link_texts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_link_texts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "link_id" "uuid" NOT NULL,
    "locale" character varying(35) NOT NULL,
    "label" character varying(100) NOT NULL,
    "line" character varying(160),
    "provenance" character varying(20),
    "version" integer DEFAULT 1 NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "portal_link_texts_label_present" CHECK (("length"("btrim"(("label")::"text")) > 0)),
    CONSTRAINT "portal_link_texts_line_present" CHECK ((("line" IS NULL) OR ("length"("btrim"(("line")::"text")) > 0))),
    CONSTRAINT "portal_link_texts_locale_active" CHECK ((("locale")::"text" = ANY ((ARRAY['en'::character varying, 'es'::character varying, 'it'::character varying, 'fr'::character varying, 'de'::character varying, 'bg'::character varying])::"text"[]))),
    CONSTRAINT "portal_link_texts_provenance_valid" CHECK ((("provenance" IS NULL) OR (("provenance")::"text" = 'ai_draft'::"text"))),
    CONSTRAINT "portal_link_texts_version_positive" CHECK (("version" >= 1))
);


--
-- Name: portal_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "label" character varying(100) NOT NULL,
    "destination_id" "uuid",
    "url" character varying(500),
    "legacy_destination_state" character varying(20) DEFAULT 'unclassified'::character varying NOT NULL,
    "icon_key" character varying(50),
    "sort_key" character varying(50) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_asset_id" "uuid",
    CONSTRAINT "portal_links_destination_authority_valid" CHECK (((("destination_id" IS NOT NULL) AND ("url" IS NULL) AND (("legacy_destination_state")::"text" = 'migrated'::"text")) OR (("destination_id" IS NULL) AND ("url" IS NOT NULL) AND (("legacy_destination_state")::"text" = ANY ((ARRAY['unclassified'::character varying, 'quarantined'::character varying])::"text"[]))))),
    CONSTRAINT "portal_links_icon_key_valid" CHECK ((("icon_key" IS NULL) OR (("icon_key")::"text" = ANY ((ARRAY['link'::character varying, 'external-link'::character varying, 'globe'::character varying, 'utensils'::character varying, 'coffee'::character varying, 'wine'::character varying, 'bed-double'::character varying, 'map-pin'::character varying, 'phone'::character varying, 'mail'::character varying, 'calendar'::character varying, 'clock'::character varying, 'star'::character varying, 'gift'::character varying, 'shopping-bag'::character varying, 'music'::character varying, 'ticket'::character varying, 'wifi'::character varying, 'car'::character varying, 'info'::character varying, 'heart'::character varying, 'scissors'::character varying, 'sparkles'::character varying, 'camera'::character varying, 'book-open'::character varying, 'waves'::character varying, 'concierge-bell'::character varying])::"text"[]))))
);


--
-- Name: portal_localized_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_localized_overrides" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "locale" character varying(35) NOT NULL,
    "title" character varying(120),
    "short_description" character varying(500),
    "hero_image_url" character varying(500),
    "version" integer DEFAULT 1 NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "linktree_title" character varying(60),
    CONSTRAINT "portal_localized_overrides_has_value" CHECK ((("title" IS NOT NULL) OR ("short_description" IS NOT NULL) OR ("hero_image_url" IS NOT NULL) OR ("linktree_title" IS NOT NULL))),
    CONSTRAINT "portal_localized_overrides_locale_active" CHECK ((("locale")::"text" = ANY ((ARRAY['en'::character varying, 'es'::character varying, 'it'::character varying, 'fr'::character varying, 'de'::character varying, 'bg'::character varying])::"text"[]))),
    CONSTRAINT "portal_localized_overrides_version_positive" CHECK (("version" >= 1))
);


--
-- Name: portal_look_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_look_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "photo_mode" character varying(8) DEFAULT 'inherit'::character varying NOT NULL,
    "hero_asset_id" "uuid",
    "hero_focal_x" double precision,
    "hero_focal_y" double precision,
    "hero_alt_texts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "colours_mode" character varying(8) DEFAULT 'inherit'::character varying NOT NULL,
    "primary_color" character varying(7),
    "background_mode" character varying(10),
    "background_color" character varying(7),
    "identity_mode" character varying(8) DEFAULT 'inherit'::character varying NOT NULL,
    "wordmark" character varying(24),
    "logo_asset_id" "uuid",
    "look_version" integer NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "portal_look_overrides_alt_object" CHECK (("jsonb_typeof"("hero_alt_texts") = 'object'::"text")),
    CONSTRAINT "portal_look_overrides_background_mode_valid" CHECK ((("background_mode" IS NULL) OR (("background_mode")::"text" = ANY ((ARRAY['auto'::character varying, 'manual'::character varying])::"text"[])))),
    CONSTRAINT "portal_look_overrides_colours_mode_valid" CHECK ((("colours_mode")::"text" = ANY ((ARRAY['inherit'::character varying, 'own'::character varying])::"text"[]))),
    CONSTRAINT "portal_look_overrides_colours_valid" CHECK ((((("colours_mode")::"text" = 'own'::"text") AND ("primary_color" IS NOT NULL) AND ("background_mode" IS NOT NULL) AND ("background_color" IS NOT NULL)) OR ((("colours_mode")::"text" = 'inherit'::"text") AND ("primary_color" IS NULL) AND ("background_mode" IS NULL) AND ("background_color" IS NULL)))),
    CONSTRAINT "portal_look_overrides_identity_mode_valid" CHECK ((("identity_mode")::"text" = ANY ((ARRAY['inherit'::character varying, 'own'::character varying])::"text"[]))),
    CONSTRAINT "portal_look_overrides_identity_valid" CHECK (((("identity_mode")::"text" = 'own'::"text") OR (("wordmark" IS NULL) AND ("logo_asset_id" IS NULL)))),
    CONSTRAINT "portal_look_overrides_look_version_positive" CHECK (("look_version" >= 1)),
    CONSTRAINT "portal_look_overrides_palette_valid" CHECK (((("primary_color" IS NULL) OR (("primary_color")::"text" ~ '^#[0-9A-Fa-f]{6}$'::"text")) AND (("background_color" IS NULL) OR (("background_color")::"text" ~ '^#[0-9A-Fa-f]{6}$'::"text")))),
    CONSTRAINT "portal_look_overrides_photo_mode_valid" CHECK ((("photo_mode")::"text" = ANY ((ARRAY['inherit'::character varying, 'own'::character varying, 'none'::character varying])::"text"[]))),
    CONSTRAINT "portal_look_overrides_photo_valid" CHECK ((((("photo_mode")::"text" = 'own'::"text") AND ("hero_asset_id" IS NOT NULL) AND ("hero_focal_x" IS NOT NULL) AND (("hero_focal_x" >= (0)::double precision) AND ("hero_focal_x" <= (1)::double precision)) AND ("hero_focal_y" IS NOT NULL) AND (("hero_focal_y" >= (0)::double precision) AND ("hero_focal_y" <= (1)::double precision))) OR ((("photo_mode")::"text" <> 'own'::"text") AND ("hero_asset_id" IS NULL) AND ("hero_focal_x" IS NULL) AND ("hero_focal_y" IS NULL) AND ("hero_alt_texts" = '{}'::"jsonb")))),
    CONSTRAINT "portal_look_overrides_wordmark_present" CHECK ((("wordmark" IS NULL) OR ("length"("btrim"(("wordmark")::"text")) > 0)))
);


--
-- Name: portal_media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_media_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "purpose" character varying(16) NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "object_key" character varying(120) NOT NULL,
    "content_type" character varying(32) NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "byte_size" integer NOT NULL,
    "content_sha256" character varying(64) NOT NULL,
    "source_format" character varying(8) NOT NULL,
    "source_bytes" integer NOT NULL,
    "rights_confirmed_at" timestamp with time zone NOT NULL,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "taken_down_at" timestamp with time zone,
    "object_deleted_at" timestamp with time zone,
    CONSTRAINT "portal_media_assets_byte_size_positive" CHECK (("byte_size" >= 1)),
    CONSTRAINT "portal_media_assets_content_type_webp" CHECK ((("content_type")::"text" = 'image/webp'::"text")),
    CONSTRAINT "portal_media_assets_dimensions_valid" CHECK (((("width" >= 1) AND ("width" <= 16384)) AND (("height" >= 1) AND ("height" <= 16384)))),
    CONSTRAINT "portal_media_assets_object_deleted_taken_down" CHECK ((("object_deleted_at" IS NULL) OR (("status")::"text" = 'taken_down'::"text"))),
    CONSTRAINT "portal_media_assets_object_key_derived" CHECK ((("object_key")::"text" = (('portal-media/'::"text" || ("id")::"text") || '.webp'::"text"))),
    CONSTRAINT "portal_media_assets_purpose_valid" CHECK ((("purpose")::"text" = ANY ((ARRAY['hero'::character varying, 'logo'::character varying, 'link_image'::character varying])::"text"[]))),
    CONSTRAINT "portal_media_assets_sha256_valid" CHECK ((("content_sha256")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "portal_media_assets_source_bytes_positive" CHECK (("source_bytes" >= 1)),
    CONSTRAINT "portal_media_assets_source_format_valid" CHECK ((("source_format")::"text" = ANY ((ARRAY['jpeg'::character varying, 'png'::character varying, 'webp'::character varying])::"text"[]))),
    CONSTRAINT "portal_media_assets_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'taken_down'::character varying])::"text"[]))),
    CONSTRAINT "portal_media_assets_takedown_consistent" CHECK (((("status")::"text" = 'taken_down'::"text") = ("taken_down_at" IS NOT NULL)))
);


--
-- Name: portal_metric_lifetime_aggregates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_metric_lifetime_aggregates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "qualified_scan_count" bigint DEFAULT 0 NOT NULL,
    "private_rating_count" bigint DEFAULT 0 NOT NULL,
    "private_rating_sum" bigint DEFAULT 0 NOT NULL,
    "private_rating_1_count" bigint DEFAULT 0 NOT NULL,
    "private_rating_2_count" bigint DEFAULT 0 NOT NULL,
    "private_rating_3_count" bigint DEFAULT 0 NOT NULL,
    "private_rating_4_count" bigint DEFAULT 0 NOT NULL,
    "private_rating_5_count" bigint DEFAULT 0 NOT NULL,
    "private_feedback_count" bigint DEFAULT 0 NOT NULL,
    "google_review_selection_count" bigint DEFAULT 0 NOT NULL,
    "secondary_link_selection_count" bigint DEFAULT 0 NOT NULL,
    "sealed_qualified_scan_count" bigint DEFAULT 0 NOT NULL,
    "sealed_private_rating_count" bigint DEFAULT 0 NOT NULL,
    "sealed_private_rating_sum" bigint DEFAULT 0 NOT NULL,
    "sealed_private_rating_1_count" bigint DEFAULT 0 NOT NULL,
    "sealed_private_rating_2_count" bigint DEFAULT 0 NOT NULL,
    "sealed_private_rating_3_count" bigint DEFAULT 0 NOT NULL,
    "sealed_private_rating_4_count" bigint DEFAULT 0 NOT NULL,
    "sealed_private_rating_5_count" bigint DEFAULT 0 NOT NULL,
    "sealed_private_feedback_count" bigint DEFAULT 0 NOT NULL,
    "sealed_google_review_selection_count" bigint DEFAULT 0 NOT NULL,
    "sealed_secondary_link_selection_count" bigint DEFAULT 0 NOT NULL,
    "sealed_through_local_date" character varying(10),
    "projection_revision" bigint DEFAULT 0 NOT NULL,
    "last_rebuilt_at" timestamp with time zone,
    "last_sealed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "portal_metric_lifetime_nonnegative_check" CHECK ((("qualified_scan_count" >= 0) AND ("private_rating_count" >= 0) AND ("private_rating_sum" >= 0) AND ("private_rating_1_count" >= 0) AND ("private_rating_2_count" >= 0) AND ("private_rating_3_count" >= 0) AND ("private_rating_4_count" >= 0) AND ("private_rating_5_count" >= 0) AND ("private_feedback_count" >= 0) AND ("google_review_selection_count" >= 0) AND ("secondary_link_selection_count" >= 0))),
    CONSTRAINT "portal_metric_lifetime_rating_check" CHECK ((((((("private_rating_1_count" + "private_rating_2_count") + "private_rating_3_count") + "private_rating_4_count") + "private_rating_5_count") = "private_rating_count") AND (("private_rating_sum" >= "private_rating_count") AND ("private_rating_sum" <= ("private_rating_count" * 5))))),
    CONSTRAINT "portal_metric_lifetime_sealed_boundary_check" CHECK ((("sealed_through_local_date" IS NULL) OR (("sealed_through_local_date")::"text" ~ '^\d{4}-\d{2}-\d{2}$'::"text"))),
    CONSTRAINT "portal_metric_lifetime_sealed_nonnegative_check" CHECK ((("sealed_qualified_scan_count" >= 0) AND ("sealed_private_rating_count" >= 0) AND ("sealed_private_rating_sum" >= 0) AND ("sealed_private_rating_1_count" >= 0) AND ("sealed_private_rating_2_count" >= 0) AND ("sealed_private_rating_3_count" >= 0) AND ("sealed_private_rating_4_count" >= 0) AND ("sealed_private_rating_5_count" >= 0) AND ("sealed_private_feedback_count" >= 0) AND ("sealed_google_review_selection_count" >= 0) AND ("sealed_secondary_link_selection_count" >= 0))),
    CONSTRAINT "portal_metric_lifetime_sealed_rating_check" CHECK ((((((("sealed_private_rating_1_count" + "sealed_private_rating_2_count") + "sealed_private_rating_3_count") + "sealed_private_rating_4_count") + "sealed_private_rating_5_count") = "sealed_private_rating_count") AND (("sealed_private_rating_sum" >= "sealed_private_rating_count") AND ("sealed_private_rating_sum" <= ("sealed_private_rating_count" * 5)))))
);


--
-- Name: portal_page_edits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_page_edits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid",
    "change_kind" character varying(40) NOT NULL,
    "change_key" character varying(160) DEFAULT 'all'::character varying NOT NULL,
    "previous_text" character varying(200),
    "new_text" character varying(200),
    "edit_count" integer DEFAULT 1 NOT NULL,
    "actor_user_id" character varying(255),
    "occurred_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "portal_page_edits_count_positive" CHECK (("edit_count" >= 1)),
    CONSTRAINT "portal_page_edits_kind_valid" CHECK ((("change_kind")::"text" = ANY ((ARRAY['portal_configuration'::character varying, 'portal_links'::character varying, 'property_brand_profile'::character varying, 'property_brand_content'::character varying, 'portal_localized_override'::character varying, 'approved_destination'::character varying])::"text"[]))),
    CONSTRAINT "portal_page_edits_scope" CHECK (((("change_kind")::"text" = ANY ((ARRAY['property_brand_profile'::character varying, 'property_brand_content'::character varying])::"text"[])) = ("portal_id" IS NULL))),
    CONSTRAINT "portal_page_edits_text_scope" CHECK (((("previous_text" IS NULL) AND ("new_text" IS NULL)) OR (("change_kind")::"text" = ANY ((ARRAY['property_brand_content'::character varying, 'portal_localized_override'::character varying])::"text"[])) OR ((("change_kind")::"text" = 'property_brand_profile'::"text") AND (("change_key")::"text" = 'all'::"text")) OR ((("change_kind")::"text" = 'portal_links'::"text") AND (("change_key")::"text" !~~ '%reordered'::"text") AND (("change_key")::"text" <> 'linktree:enabled'::"text")) OR ((("change_kind")::"text" = 'portal_configuration'::"text") AND (("change_key")::"text" = ANY ((ARRAY['settings:name'::character varying, 'settings:description'::character varying])::"text"[])))))
);


--
-- Name: portal_pending_content_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_pending_content_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "change_kind" character varying(40) NOT NULL,
    "change_key" character varying(160) DEFAULT 'all'::character varying NOT NULL,
    "source_version" character varying(160) NOT NULL,
    "changed_at" timestamp with time zone NOT NULL,
    "resolved_snapshot_id" "uuid",
    "resolved_at" timestamp with time zone,
    "changed_by" character varying(255),
    CONSTRAINT "portal_pending_content_changes_kind_valid" CHECK ((("change_kind")::"text" = ANY ((ARRAY['portal_configuration'::character varying, 'portal_links'::character varying, 'property_brand_profile'::character varying, 'property_brand_content'::character varying, 'portal_localized_override'::character varying, 'approved_destination'::character varying])::"text"[]))),
    CONSTRAINT "portal_pending_content_changes_resolution_pair" CHECK ((("resolved_snapshot_id" IS NULL) = ("resolved_at" IS NULL))),
    CONSTRAINT "portal_pending_content_changes_resolution_time" CHECK ((("resolved_at" IS NULL) OR ("resolved_at" >= "changed_at")))
);


--
-- Name: portal_print_wordings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_print_wordings" (
    "portal_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "call_to_action" character varying(32) NOT NULL,
    "call_to_action_custom" "jsonb",
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "portal_print_wordings_call_to_action_custom_valid" CHECK ((("call_to_action_custom" IS NULL) OR ("jsonb_typeof"("call_to_action_custom") = 'object'::"text"))),
    CONSTRAINT "portal_print_wordings_call_to_action_valid" CHECK ((("call_to_action")::"text" = ANY ((ARRAY['how_did_we_do'::character varying, 'how_was_visit'::character varying, 'how_was_stay'::character varying, 'rate_visit'::character varying, 'got_30_seconds'::character varying])::"text"[])))
);


--
-- Name: portal_publication_activations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_publication_activations" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "snapshot_id" "uuid" NOT NULL,
    "activation_sequence" integer NOT NULL,
    "kind" character varying(20) NOT NULL,
    "activated_by" character varying(255) NOT NULL,
    "activated_at" timestamp with time zone NOT NULL,
    "deactivated_at" timestamp with time zone,
    "deactivation_reason" character varying(20),
    CONSTRAINT "portal_publication_activations_deactivation_valid" CHECK (((("deactivated_at" IS NULL) AND ("deactivation_reason" IS NULL)) OR (("deactivated_at" IS NOT NULL) AND (("deactivation_reason")::"text" = ANY ((ARRAY['disabled'::character varying, 'archived'::character varying, 'replaced'::character varying])::"text"[]))))),
    CONSTRAINT "portal_publication_activations_interval_valid" CHECK ((("deactivated_at" IS NULL) OR ("deactivated_at" >= "activated_at"))),
    CONSTRAINT "portal_publication_activations_kind_valid" CHECK ((("kind")::"text" = ANY ((ARRAY['publish'::character varying, 'rollback'::character varying])::"text"[]))),
    CONSTRAINT "portal_publication_activations_sequence_positive" CHECK (("activation_sequence" >= 1))
);


--
-- Name: portal_publication_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_publication_snapshots" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "configuration_digest" character varying(64) NOT NULL,
    "configuration" "jsonb" NOT NULL,
    "guest_locale" character varying(35) NOT NULL,
    "language_pack_version" character varying(100) NOT NULL,
    "locale_set" "jsonb" DEFAULT '["en"]'::"jsonb" NOT NULL,
    "language_pack_versions" "jsonb" DEFAULT '{"en": "guest-ui-en-v1"}'::"jsonb" NOT NULL,
    "localized_content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "brand_profile_version" integer,
    "private_feedback_threshold" integer NOT NULL,
    "contact_request_enabled" boolean DEFAULT false NOT NULL,
    "contact_notice_id" character varying(100),
    "contact_notice_version" character varying(100),
    "contact_notice_digest" character varying(64),
    "contact_notice_locale" character varying(35),
    "contact_request_purpose" character varying(50) DEFAULT 'manager_follow_up'::character varying NOT NULL,
    "contact_retention_policy_version" character varying(100) DEFAULT 'guest-contact-retention-30d-v1'::character varying NOT NULL,
    "destination_uri" character varying(500) NOT NULL,
    "destination_retrieved_at" timestamp with time zone NOT NULL,
    "destination_source_epoch" integer NOT NULL,
    "destination_profile_version" integer NOT NULL,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    CONSTRAINT "portal_publication_snapshots_brand_version_positive" CHECK ((("brand_profile_version" IS NULL) OR ("brand_profile_version" >= 1))),
    CONSTRAINT "portal_publication_snapshots_configuration_object" CHECK (("jsonb_typeof"("configuration") = 'object'::"text")),
    CONSTRAINT "portal_publication_snapshots_contact_evidence_valid" CHECK ((("contact_request_enabled" = false) OR (("contact_notice_id" IS NOT NULL) AND (("char_length"(("contact_notice_id")::"text") >= 1) AND ("char_length"(("contact_notice_id")::"text") <= 100)) AND ("contact_notice_version" IS NOT NULL) AND (("char_length"(("contact_notice_version")::"text") >= 1) AND ("char_length"(("contact_notice_version")::"text") <= 100)) AND (("contact_notice_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("contact_notice_locale")::"text" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::"text")))),
    CONSTRAINT "portal_publication_snapshots_contact_purpose_valid" CHECK ((("contact_request_purpose")::"text" = 'manager_follow_up'::"text")),
    CONSTRAINT "portal_publication_snapshots_contact_retention_valid" CHECK ((("contact_retention_policy_version")::"text" = 'guest-contact-retention-30d-v1'::"text")),
    CONSTRAINT "portal_publication_snapshots_destination_binding_valid" CHECK (((("destination_uri")::"text" ~~ 'https://%'::"text") AND ("destination_source_epoch" >= 0) AND ("destination_profile_version" >= 1))),
    CONSTRAINT "portal_publication_snapshots_digest_valid" CHECK ((("configuration_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "portal_publication_snapshots_language_pack_valid" CHECK ((("language_pack_version")::"text" ~ '^guest-ui-(en|es|it|fr|de|bg)-v[1-9][0-9]{0,2}$'::"text")),
    CONSTRAINT "portal_publication_snapshots_language_packs_object" CHECK (("jsonb_typeof"("language_pack_versions") = 'object'::"text")),
    CONSTRAINT "portal_publication_snapshots_locale_set_valid" CHECK ((("jsonb_typeof"("locale_set") = 'array'::"text") AND ("locale_set" <@ '["en", "es", "it", "fr", "de", "bg"]'::"jsonb") AND ("locale_set" @> "jsonb_build_array"("guest_locale")))),
    CONSTRAINT "portal_publication_snapshots_locale_valid" CHECK ((("guest_locale")::"text" = ANY ((ARRAY['en'::character varying, 'es'::character varying, 'it'::character varying, 'fr'::character varying, 'de'::character varying, 'bg'::character varying])::"text"[]))),
    CONSTRAINT "portal_publication_snapshots_localized_content_object" CHECK (("jsonb_typeof"("localized_content") = 'object'::"text")),
    CONSTRAINT "portal_publication_snapshots_threshold_valid" CHECK ((("private_feedback_threshold" >= 1) AND ("private_feedback_threshold" <= 5))),
    CONSTRAINT "portal_publication_snapshots_version_positive" CHECK (("version" >= 1))
);


--
-- Name: portal_responsibilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_responsibilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "staff_participation_id" "uuid" NOT NULL,
    "kind" "public"."responsibility_kind" DEFAULT 'primary'::"public"."responsibility_kind" NOT NULL,
    "effective_from" timestamp with time zone NOT NULL,
    "effective_to" timestamp with time zone,
    "created_by" character varying(255) NOT NULL,
    "end_reason" "text",
    CONSTRAINT "pr_interval_valid" CHECK ((("effective_to" IS NULL) OR ("effective_to" > "effective_from")))
);


--
-- Name: portal_responsible_managers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_responsible_managers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "effective_from" timestamp with time zone NOT NULL,
    "effective_to" timestamp with time zone,
    "created_by" character varying(255) NOT NULL,
    "end_reason" character varying(500),
    CONSTRAINT "prm_interval_valid" CHECK ((("effective_to" IS NULL) OR ("effective_to" > "effective_from")))
);


--
-- Name: portal_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portal_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "token_identifier" character varying(24) NOT NULL,
    "token_hash" character varying(64) NOT NULL,
    "token_key_version" integer DEFAULT 1 NOT NULL,
    "encrypted_raw_token" "text",
    "address_encryption_key_version" integer,
    "version" integer NOT NULL,
    "print_batch" character varying(100),
    "status" character varying(20) DEFAULT 'active'::character varying NOT NULL,
    "issued_at" timestamp with time zone NOT NULL,
    "grace_period_ends" timestamp with time zone,
    "retired_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "revoked_by" character varying(255),
    "revoked_reason" character varying(500),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "issued_by" character varying(255),
    "qr_print_code_hash" character varying(64),
    "nfc_print_code_hash" character varying(64),
    CONSTRAINT "portal_tokens_encrypted_address_pair_valid" CHECK ((("encrypted_raw_token" IS NULL) = ("address_encryption_key_version" IS NULL))),
    CONSTRAINT "portal_tokens_nfc_print_code_hash_format" CHECK ((("nfc_print_code_hash" IS NULL) OR (("nfc_print_code_hash")::"text" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "portal_tokens_qr_print_code_hash_format" CHECK ((("qr_print_code_hash" IS NULL) OR (("qr_print_code_hash")::"text" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "portal_tokens_sealed_address_active_only" CHECK ((("encrypted_raw_token" IS NULL) OR (("status")::"text" = 'active'::"text"))),
    CONSTRAINT "portal_tokens_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'rotating'::character varying, 'revoked'::character varying])::"text"[])))
);


--
-- Name: portals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."portals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "entity_type" character varying(20) DEFAULT 'property'::character varying NOT NULL,
    "entity_id" character varying(255) NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(64) NOT NULL,
    "description" character varying(500),
    "hero_image_url" character varying(500),
    "theme" "jsonb" DEFAULT '{}'::"jsonb",
    "private_feedback_threshold" integer DEFAULT 3 NOT NULL,
    "publication_state" character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    "created_by" character varying(255),
    "responsible_manager_revision" integer DEFAULT 1 NOT NULL,
    "responsibility_needed_since" timestamp with time zone,
    "primary_guest_locale" character varying(35) DEFAULT 'en'::character varying NOT NULL,
    "additional_guest_locales" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "linktree_enabled" boolean DEFAULT true NOT NULL,
    "skip_private_rating" boolean DEFAULT false NOT NULL,
    "kind" character varying(16) DEFAULT 'place'::character varying NOT NULL,
    "public_name" character varying(100),
    CONSTRAINT "portals_additional_guest_locales_array" CHECK ((("jsonb_typeof"("additional_guest_locales") = 'array'::"text") AND ("additional_guest_locales" <@ '["en", "es", "it", "fr", "de", "bg"]'::"jsonb"))),
    CONSTRAINT "portals_kind_valid" CHECK ((("kind")::"text" = ANY ((ARRAY['place'::character varying, 'personal'::character varying])::"text"[]))),
    CONSTRAINT "portals_personal_public_name_required" CHECK (((("kind")::"text" = 'place'::"text") OR ("public_name" IS NOT NULL))),
    CONSTRAINT "portals_primary_guest_locale_active" CHECK ((("primary_guest_locale")::"text" = ANY ((ARRAY['en'::character varying, 'es'::character varying, 'it'::character varying, 'fr'::character varying, 'de'::character varying, 'bg'::character varying])::"text"[]))),
    CONSTRAINT "portals_private_feedback_threshold_valid" CHECK ((("private_feedback_threshold" >= 1) AND ("private_feedback_threshold" <= 5))),
    CONSTRAINT "portals_publication_state_valid" CHECK ((("publication_state")::"text" = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'disabled'::character varying, 'archived'::character varying])::"text"[]))),
    CONSTRAINT "portals_responsible_manager_revision_positive" CHECK (("responsible_manager_revision" >= 1))
);


--
-- Name: privacy_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."privacy_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "subject_type" character varying(24) NOT NULL,
    "subject_ref" character(64) NOT NULL,
    "request_kind" character varying(24) NOT NULL,
    "state" character varying(24) NOT NULL,
    "verification_ref" character varying(200),
    "refusal_reason_code" character varying(64),
    "target_field" character varying(64),
    "content_classification" character varying(24) NOT NULL,
    "package_ref" character varying(200),
    "package_expires_at" timestamp with time zone,
    "evidence_ref" character varying(200) NOT NULL,
    "correlation_id" character varying(255) NOT NULL,
    "received_at" timestamp with time zone NOT NULL,
    "verified_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "privacy_requests_classification_valid" CHECK ((("content_classification")::"text" = ANY ((ARRAY['content_free'::character varying, 'personal'::character varying, 'sensitive'::character varying])::"text"[]))),
    CONSTRAINT "privacy_requests_completion_valid" CHECK (((("state")::"text" = ANY ((ARRAY['fulfilled'::character varying, 'refused'::character varying])::"text"[])) = ("completed_at" IS NOT NULL))),
    CONSTRAINT "privacy_requests_kind_valid" CHECK ((("request_kind")::"text" = ANY ((ARRAY['access'::character varying, 'correction'::character varying, 'withdrawal'::character varying, 'erasure'::character varying])::"text"[]))),
    CONSTRAINT "privacy_requests_package_valid" CHECK ((("package_ref" IS NULL) OR ((("request_kind")::"text" = 'access'::"text") AND ("package_expires_at" IS NOT NULL) AND ("package_expires_at" > "received_at")))),
    CONSTRAINT "privacy_requests_refs_valid" CHECK (((("evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text") AND (("verification_ref" IS NULL) OR (("verification_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text")) AND (("package_ref" IS NULL) OR (("package_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text")) AND (("refusal_reason_code" IS NULL) OR (("refusal_reason_code")::"text" ~ '^[a-z][a-z0-9_]{0,63}$'::"text")) AND (("target_field" IS NULL) OR (("target_field")::"text" ~ '^[a-z][a-z0-9_]{0,63}$'::"text")))),
    CONSTRAINT "privacy_requests_refusal_reason_required" CHECK (((("state")::"text" = 'refused'::"text") = ("refusal_reason_code" IS NOT NULL))),
    CONSTRAINT "privacy_requests_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['received'::character varying, 'verified'::character varying, 'in_progress'::character varying, 'fulfilled'::character varying, 'refused'::character varying])::"text"[]))),
    CONSTRAINT "privacy_requests_subject_ref_valid" CHECK (("subject_ref" ~ '^[a-f0-9]{64}$'::"text")),
    CONSTRAINT "privacy_requests_subject_type_valid" CHECK ((("subject_type")::"text" = ANY ((ARRAY['guest'::character varying, 'participant'::character varying])::"text"[]))),
    CONSTRAINT "privacy_requests_target_field_valid" CHECK ((("target_field" IS NULL) OR (("request_kind")::"text" = ANY ((ARRAY['correction'::character varying, 'withdrawal'::character varying])::"text"[])))),
    CONSTRAINT "privacy_requests_verification_required" CHECK (((("state")::"text" = 'received'::"text") OR (("verified_at" IS NOT NULL) AND ("verification_ref" IS NOT NULL))))
);


--
-- Name: product_update_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_update_receipts" (
    "user_id" "text" NOT NULL,
    "organization_id" "text" NOT NULL,
    "entry_id" "text" NOT NULL,
    "seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: product_update_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."product_update_settings" (
    "user_id" "text" NOT NULL,
    "organization_id" "text" NOT NULL,
    "auto_show" boolean DEFAULT true NOT NULL,
    "last_auto_opened_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."properties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(64) NOT NULL,
    "timezone" character varying(64) NOT NULL,
    "default_reply_language" character varying(35),
    "google_connection_id" "uuid",
    "address" "text",
    "gbp_account_id" character varying(255),
    "gbp_location_id" character varying(255),
    "profile_version" integer DEFAULT 1 NOT NULL,
    "google_binding_state" character varying(40) DEFAULT 'unbound'::character varying NOT NULL,
    "google_review_uri" character varying(2048),
    "google_review_destination_state" character varying(32) DEFAULT 'unavailable'::character varying NOT NULL,
    "google_review_destination_retrieved_at" timestamp with time zone,
    "google_review_destination_source_epoch" integer,
    "google_review_destination_profile_version" integer,
    "profile_source" character varying(32) DEFAULT 'legacy'::character varying NOT NULL,
    "profile_confirmed_at" timestamp with time zone,
    "profile_confirmed_by" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "lifecycle_state" character varying(20) DEFAULT 'active'::character varying NOT NULL,
    "lifecycle_reason" "text",
    "lifecycle_state_changed_at" timestamp with time zone DEFAULT "now"(),
    "purge_scheduled_for" timestamp with time zone,
    "lifecycle_initiated_by" character varying(255),
    "country_code" character varying(2),
    "country_source" "text" DEFAULT 'organization_default'::"text",
    "timezone_source" "text" DEFAULT 'legacy'::"text",
    "timezone_resolved_at" timestamp with time zone,
    "source_epoch" integer DEFAULT 0 NOT NULL,
    "responsible_manager_revision" integer DEFAULT 1 NOT NULL,
    "responsibility_needed_since" timestamp with time zone,
    "google_primary_category" character varying(512),
    "google_primary_category_updated_at" timestamp with time zone,
    "google_primary_category_refresh_event_id" "uuid",
    CONSTRAINT "properties_default_reply_language_valid" CHECK ((("default_reply_language" IS NULL) OR (("default_reply_language")::"text" ~ '^(en-Latn|es-Latn|fr-Latn|de-Latn|pt-Latn|it-Latn|nl-Latn|pl-Latn|tr-Latn|uk-Cyrl|ru-Cyrl|ar-Arab|he-Hebr|hi-Deva|bn-Beng|ta-Taml|th-Thai|vi-Latn|id-Latn|zh-Hans|zh-Hant|ja-Jpan|ko-Kore|bg-Cyrl)(-(001|002|003|005|009|011|013|014|015|017|018|019|021|029|030|034|035|039|053|054|057|061|142|143|145|150|151|154|155|202|419|AC|AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CP|CQ|CR|CU|CV|CW|CX|CY|CZ|DE|DG|DJ|DK|DM|DO|DZ|EA|EC|EE|EG|EH|ER|ES|ET|EU|EZ|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|IC|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|QO|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TA|TC|TD|TF|TG|TH|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|UN|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|XA|XB|XK|YE|YT|ZA|ZM|ZW))?$'::"text"))),
    CONSTRAINT "properties_google_binding_state_valid" CHECK ((("google_binding_state")::"text" = ANY ((ARRAY['unbound'::character varying, 'account_confirmation_required'::character varying, 'active'::character varying, 'disconnected'::character varying])::"text"[]))),
    CONSTRAINT "properties_google_binding_suffix_valid" CHECK (((("gbp_account_id" IS NULL) OR (("char_length"(("gbp_account_id")::"text") >= 1) AND ("char_length"(("gbp_account_id")::"text") <= 255) AND (("gbp_account_id")::"text" !~ '[/?#[:space:][:cntrl:]]'::"text"))) AND (("gbp_location_id" IS NULL) OR (("char_length"(("gbp_location_id")::"text") >= 1) AND ("char_length"(("gbp_location_id")::"text") <= 255) AND (("gbp_location_id")::"text" !~ '[/?#[:space:][:cntrl:]]'::"text"))))),
    CONSTRAINT "properties_google_binding_tuple_valid" CHECK ((((("google_binding_state")::"text" = 'unbound'::"text") AND ("gbp_account_id" IS NULL) AND ("gbp_location_id" IS NULL)) OR ((("google_binding_state")::"text" = 'account_confirmation_required'::"text") AND ("gbp_account_id" IS NULL) AND ("gbp_location_id" IS NOT NULL)) OR ((("google_binding_state")::"text" = ANY ((ARRAY['active'::character varying, 'disconnected'::character varying])::"text"[])) AND ("google_connection_id" IS NOT NULL) AND ("gbp_account_id" IS NOT NULL) AND ("gbp_location_id" IS NOT NULL)))),
    CONSTRAINT "properties_google_primary_category_valid" CHECK ((("google_primary_category" IS NULL) OR ((("char_length"(("google_primary_category")::"text") >= 1) AND ("char_length"(("google_primary_category")::"text") <= 512)) AND (("google_primary_category")::"text" = "btrim"(("google_primary_category")::"text")) AND ("google_primary_category_updated_at" IS NOT NULL)))),
    CONSTRAINT "properties_google_profile_confirmation_valid" CHECK ((((("profile_source")::"text" = 'legacy'::"text") AND ("profile_confirmed_at" IS NULL) AND ("profile_confirmed_by" IS NULL)) OR ((("profile_source")::"text" = 'tenant_confirmed'::"text") AND ("profile_confirmed_at" IS NOT NULL) AND ("profile_confirmed_by" IS NOT NULL)))),
    CONSTRAINT "properties_google_profile_version_valid" CHECK (("profile_version" >= 1)),
    CONSTRAINT "properties_google_review_destination_valid" CHECK ((((("google_review_destination_state")::"text" = ANY ((ARRAY['verified'::character varying, 'awaiting_refresh'::character varying])::"text"[])) AND ("google_review_uri" IS NOT NULL) AND (("google_review_uri")::"text" ~ '^https://'::"text") AND ("google_review_destination_retrieved_at" IS NOT NULL) AND ("google_review_destination_source_epoch" >= 0) AND ("google_review_destination_profile_version" >= 1)) OR ((("google_review_destination_state")::"text" = 'unavailable'::"text") AND ("google_review_uri" IS NULL) AND ("google_review_destination_retrieved_at" IS NULL) AND ("google_review_destination_source_epoch" IS NULL) AND ("google_review_destination_profile_version" IS NULL)))),
    CONSTRAINT "properties_lifecycle_state_valid" CHECK ((("lifecycle_state")::"text" = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'archived'::character varying, 'disconnecting'::character varying, 'purge_pending'::character varying, 'purging'::character varying, 'purged'::character varying])::"text"[]))),
    CONSTRAINT "properties_responsible_manager_revision_positive" CHECK (("responsible_manager_revision" >= 1))
);


--
-- Name: property_access_grant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_access_grant" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "text" NOT NULL,
    "property_id" "uuid" NOT NULL,
    "user_id" "text" NOT NULL,
    "source" "text" NOT NULL,
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "revoke_reason" "text",
    CONSTRAINT "property_access_grant_source_check" CHECK (("source" = ANY (ARRAY['operator'::"text", 'migration'::"text", 'invitation'::"text"])))
);


--
-- Name: property_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_access_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "kind" "public"."grant_kind" NOT NULL,
    "status" "public"."grant_status" DEFAULT 'active'::"public"."grant_status" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "granted_by" character varying(255) NOT NULL,
    "revoked_by" character varying(255),
    "reason" "text"
);


--
-- Name: property_erase_authorities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_erase_authorities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "state" character varying(24) NOT NULL,
    "requested_by_user_id" character varying(255) NOT NULL,
    "identity_verification_ref" character varying(200) NOT NULL,
    "support_operator_id" character varying(255) NOT NULL,
    "support_authorization_ref" character varying(200) NOT NULL,
    "retention_preview_ref" character varying(200),
    "export_evidence_ref" character varying(200),
    "inventory_revision" integer DEFAULT 0 NOT NULL,
    "inventory_digest" character(64),
    "confirmation_digest" character(64),
    "grace_expires_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "purge_started_at" timestamp with time zone,
    "purged_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancel_reason_code" character varying(64),
    "evidence_ref" character varying(200) NOT NULL,
    "correlation_id" character varying(255) NOT NULL,
    "requested_at" timestamp with time zone NOT NULL,
    "state_changed_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "property_erase_authorities_confirmation_complete" CHECK (((("state")::"text" = ANY ((ARRAY['requested'::character varying, 'previewed'::character varying, 'cancelled'::character varying])::"text"[])) OR (("confirmation_digest" IS NOT NULL) AND ("inventory_digest" IS NOT NULL) AND ("retention_preview_ref" IS NOT NULL) AND ("confirmed_at" IS NOT NULL)))),
    CONSTRAINT "property_erase_authorities_digests_valid" CHECK (((("inventory_digest" IS NULL) OR ("inventory_digest" ~ '^[a-f0-9]{64}$'::"text")) AND (("confirmation_digest" IS NULL) OR ("confirmation_digest" ~ '^[a-f0-9]{64}$'::"text")))),
    CONSTRAINT "property_erase_authorities_refs_valid" CHECK (((("identity_verification_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text") AND (("support_authorization_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text") AND (("evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text") AND (("retention_preview_ref" IS NULL) OR (("retention_preview_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text")) AND (("export_evidence_ref" IS NULL) OR (("export_evidence_ref")::"text" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'::"text")) AND (("cancel_reason_code" IS NULL) OR (("cancel_reason_code")::"text" ~ '^[a-z][a-z0-9_]{0,63}$'::"text")))),
    CONSTRAINT "property_erase_authorities_revision_valid" CHECK (("inventory_revision" >= 0)),
    CONSTRAINT "property_erase_authorities_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['requested'::character varying, 'previewed'::character varying, 'confirmed'::character varying, 'purge_pending'::character varying, 'purging'::character varying, 'purged'::character varying, 'cancelled'::character varying])::"text"[]))),
    CONSTRAINT "property_erase_authorities_terminal_valid" CHECK ((((("state")::"text" = 'purged'::"text") = ("purged_at" IS NOT NULL)) AND ((("state")::"text" = 'cancelled'::"text") = ("cancelled_at" IS NOT NULL)) AND ((("state")::"text" <> ALL ((ARRAY['purging'::character varying, 'purged'::character varying])::"text"[])) OR ("purge_started_at" IS NOT NULL))))
);


--
-- Name: property_portal_brand_contents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_portal_brand_contents" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "locale" character varying(35) NOT NULL,
    "title" character varying(120) NOT NULL,
    "short_description" character varying(500) NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hero_alt_text" character varying(160),
    CONSTRAINT "property_portal_brand_contents_hero_alt_present" CHECK ((("hero_alt_text" IS NULL) OR ("length"("btrim"(("hero_alt_text")::"text")) > 0))),
    CONSTRAINT "property_portal_brand_contents_locale_active" CHECK ((("locale")::"text" = ANY ((ARRAY['en'::character varying, 'es'::character varying, 'it'::character varying, 'fr'::character varying, 'de'::character varying, 'bg'::character varying])::"text"[]))),
    CONSTRAINT "property_portal_brand_contents_version_positive" CHECK (("version" >= 1))
);


--
-- Name: property_portal_brand_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_portal_brand_profiles" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "display_name" character varying(120) NOT NULL,
    "logo_url" character varying(500),
    "default_hero_image_url" character varying(500),
    "primary_color" character varying(7) NOT NULL,
    "background_color" character varying(7) NOT NULL,
    "text_color" character varying(7) NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "wordmark" character varying(24),
    "background_mode" character varying(10) DEFAULT 'auto'::character varying NOT NULL,
    "default_guest_locales" "jsonb" DEFAULT '["en"]'::"jsonb" NOT NULL,
    "look_version" integer DEFAULT 1 NOT NULL,
    "logo_asset_id" "uuid",
    "hero_asset_id" "uuid",
    "hero_focal_x" double precision,
    "hero_focal_y" double precision,
    CONSTRAINT "property_portal_brand_profiles_background_mode_valid" CHECK ((("background_mode")::"text" = ANY ((ARRAY['auto'::character varying, 'manual'::character varying])::"text"[]))),
    CONSTRAINT "property_portal_brand_profiles_default_locales_valid" CHECK ((("jsonb_typeof"("default_guest_locales") = 'array'::"text") AND (("jsonb_array_length"("default_guest_locales") >= 1) AND ("jsonb_array_length"("default_guest_locales") <= 6)) AND ("default_guest_locales" <@ '["en", "es", "it", "fr", "de", "bg"]'::"jsonb"))),
    CONSTRAINT "property_portal_brand_profiles_hero_focal_valid" CHECK (((("hero_asset_id" IS NULL) AND ("hero_focal_x" IS NULL) AND ("hero_focal_y" IS NULL)) OR (("hero_asset_id" IS NOT NULL) AND ("hero_focal_x" IS NOT NULL) AND (("hero_focal_x" >= (0)::double precision) AND ("hero_focal_x" <= (1)::double precision)) AND ("hero_focal_y" IS NOT NULL) AND (("hero_focal_y" >= (0)::double precision) AND ("hero_focal_y" <= (1)::double precision))))),
    CONSTRAINT "property_portal_brand_profiles_look_version_positive" CHECK (("look_version" >= 1)),
    CONSTRAINT "property_portal_brand_profiles_palette_valid" CHECK (((("primary_color")::"text" ~ '^#[0-9A-Fa-f]{6}$'::"text") AND (("background_color")::"text" ~ '^#[0-9A-Fa-f]{6}$'::"text") AND (("text_color")::"text" ~ '^#[0-9A-Fa-f]{6}$'::"text"))),
    CONSTRAINT "property_portal_brand_profiles_version_positive" CHECK (("version" >= 1)),
    CONSTRAINT "property_portal_brand_profiles_wordmark_present" CHECK ((("wordmark" IS NULL) OR ("length"("btrim"(("wordmark")::"text")) > 0)))
);


--
-- Name: property_rating_goal_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_rating_goal_changes" (
    "id" "uuid" NOT NULL,
    "goal_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "changed_by" character varying(255) NOT NULL,
    "changed_at" timestamp with time zone NOT NULL,
    "field" character varying(8) NOT NULL,
    "old_value" character varying(8),
    "new_value" character varying(8),
    CONSTRAINT "property_rating_goal_changes_value_check" CHECK (((("old_value")::"text" IS DISTINCT FROM ("new_value")::"text") AND (((("field")::"text" = 'target'::"text") AND ("old_value" IS NOT NULL) AND ("new_value" IS NOT NULL) AND (("old_value")::"text" ~ '^([1-4][0-9]|50)$'::"text") AND (("new_value")::"text" ~ '^([1-4][0-9]|50)$'::"text")) OR ((("field")::"text" = 'quality'::"text") AND (("old_value" IS NULL) OR (("old_value")::"text" ~ '^([1-4][0-9]|50)$'::"text")) AND (("new_value" IS NULL) OR (("new_value")::"text" ~ '^([1-4][0-9]|50)$'::"text"))) OR ((("field")::"text" = 'pace'::"text") AND (("old_value" IS NULL) OR (("old_value")::"text" ~ '^([1-9][0-9]{1,2}|[12][0-9]{3}|3[0-4][0-9]{2}|3500)$'::"text")) AND (("new_value" IS NULL) OR (("new_value")::"text" ~ '^([1-9][0-9]{1,2}|[12][0-9]{3}|3[0-4][0-9]{2}|3500)$'::"text"))) OR ((("field")::"text" = 'mode'::"text") AND ("old_value" IS NOT NULL) AND ("new_value" IS NOT NULL) AND (("old_value")::"text" = ANY ((ARRAY['climb'::character varying, 'keep'::character varying])::"text"[])) AND (("new_value")::"text" = ANY ((ARRAY['climb'::character varying, 'keep'::character varying])::"text"[]))))))
);


--
-- Name: property_rating_goal_deferrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_rating_goal_deferrals" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "deferred_by" character varying(255) NOT NULL,
    "deferred_at" timestamp with time zone NOT NULL
);


--
-- Name: property_rating_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_rating_goals" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "mode" character varying(8) NOT NULL,
    "target_tenths" smallint NOT NULL,
    "pace_per_week" smallint,
    "status" character varying(8) DEFAULT 'active'::character varying NOT NULL,
    "ended_reason" character varying(32),
    "baseline_review_count" integer NOT NULL,
    "baseline_google_average" double precision NOT NULL,
    "baseline_exact_average" double precision NOT NULL,
    "last_displayed_tenths" smallint,
    "last_evaluated_status" character varying(24),
    "last_evaluated_at" timestamp with time zone,
    "reached_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "last_known_status" character varying(24),
    "below_pace_noticed_at" timestamp with time zone,
    "cant_reach_noticed_at" timestamp with time zone,
    "quality_tenths" smallint,
    "pace_tenths_per_week" smallint,
    "pace_since" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recap_answered_week" "date",
    CONSTRAINT "property_rating_goals_baseline_check" CHECK (((("baseline_review_count" >= 1) AND ("baseline_review_count" <= 10000)) AND (("baseline_google_average" >= (0)::double precision) AND ("baseline_google_average" <= (5)::double precision)) AND (("baseline_exact_average" >= (0)::double precision) AND ("baseline_exact_average" <= (5)::double precision)))),
    CONSTRAINT "property_rating_goals_evaluation_check" CHECK (((("last_displayed_tenths" IS NULL) OR (("last_displayed_tenths" >= 0) AND ("last_displayed_tenths" <= 50))) AND (("last_evaluated_status" IS NULL) OR (("last_evaluated_status")::"text" = ANY ((ARRAY['waiting_for_google'::character varying, 'reached'::character varying, 'reviews_too_low'::character varying, 'getting_started'::character varying, 'on_pace'::character varying, 'below_pace'::character varying, 'holding'::character varying, 'dropped_below'::character varying])::"text"[]))))),
    CONSTRAINT "property_rating_goals_notice_mark_check" CHECK ((("last_known_status" IS NULL) OR (("last_known_status")::"text" = ANY ((ARRAY['reached'::character varying, 'reviews_too_low'::character varying, 'getting_started'::character varying, 'on_pace'::character varying, 'below_pace'::character varying, 'holding'::character varying, 'dropped_below'::character varying])::"text"[])))),
    CONSTRAINT "property_rating_goals_plan_check" CHECK ((((("mode")::"text" = 'climb'::"text") AND ("pace_per_week" IS NOT NULL) AND ("pace_tenths_per_week" IS NOT NULL) AND ("quality_tenths" IS NOT NULL) AND (("target_tenths" >= 11) AND ("target_tenths" <= 49)) AND (("pace_tenths_per_week" >= 10) AND ("pace_tenths_per_week" <= 3500)) AND ("pace_per_week" = GREATEST(1, (("pace_tenths_per_week" + 5) / 10))) AND (("quality_tenths" >= "target_tenths") AND ("quality_tenths" <= 50))) OR ((("mode")::"text" = 'keep'::"text") AND ("pace_per_week" IS NULL) AND ("pace_tenths_per_week" IS NULL) AND ("quality_tenths" IS NULL) AND (("target_tenths" >= 10) AND ("target_tenths" <= 50))))),
    CONSTRAINT "property_rating_goals_source_epoch_check" CHECK ((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647))),
    CONSTRAINT "property_rating_goals_status_check" CHECK ((((("status")::"text" = 'active'::"text") AND ("ended_reason" IS NULL) AND ("reached_at" IS NULL) AND ("ended_at" IS NULL)) OR ((("status")::"text" = 'reached'::"text") AND (("mode")::"text" = 'climb'::"text") AND ("ended_reason" IS NULL) AND ("reached_at" IS NOT NULL) AND ("ended_at" IS NULL)) OR ((("status")::"text" = 'ended'::"text") AND ("ended_reason" IS NOT NULL) AND (("ended_reason")::"text" = ANY ((ARRAY['manager'::character varying, 'google_location_changed'::character varying, 'property_archived'::character varying])::"text"[])) AND ("reached_at" IS NULL) AND ("ended_at" IS NOT NULL)))),
    CONSTRAINT "property_rating_goals_version_check" CHECK (("version" >= 1))
);


--
-- Name: property_reply_voices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_reply_voices" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "use_first_name" boolean,
    "privacy_mode" boolean,
    "greeting_positive" character varying(16),
    "greeting_negative" character varying(16),
    "contact" character varying(200),
    "emoji_mode" character varying(16),
    "emoji_set" "text"[],
    "signer_name" character varying(120),
    "signer_title" character varying(120),
    "business_name_short" character varying(120),
    "visit_word_key" character varying(40),
    "localized" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "overridden_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "property_reply_voices_emoji_mode_valid" CHECK ((("emoji_mode" IS NULL) OR (("emoji_mode")::"text" = ANY ((ARRAY['off'::character varying, 'positive'::character varying])::"text"[])))),
    CONSTRAINT "property_reply_voices_greetings_valid" CHECK (((("greeting_positive" IS NULL) OR (("greeting_positive")::"text" = ANY ((ARRAY['hi'::character varying, 'hello'::character varying, 'dear'::character varying])::"text"[]))) AND (("greeting_negative" IS NULL) OR (("greeting_negative")::"text" = ANY ((ARRAY['hi'::character varying, 'hello'::character varying, 'dear'::character varying])::"text"[]))))),
    CONSTRAINT "property_reply_voices_version_positive" CHECK (("version" >= 1))
);


--
-- Name: property_responsible_managers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."property_responsible_managers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "effective_from" timestamp with time zone NOT NULL,
    "effective_to" timestamp with time zone,
    "created_by" character varying(255) NOT NULL,
    "end_reason" character varying(500),
    CONSTRAINT "property_rm_interval_valid" CHECK ((("effective_to" IS NULL) OR ("effective_to" > "effective_from")))
);


--
-- Name: ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "property_id" character varying(255) NOT NULL,
    "session_id" character varying(255),
    "value" integer NOT NULL,
    "source" character varying(10) NOT NULL,
    "ip_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: recent_activity_actor_label_redactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."recent_activity_actor_label_redactions" (
    "organization_id" character varying(255) NOT NULL,
    "actor_subject_id" character varying(255) NOT NULL,
    "redacted_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "recent_activity_actor_label_redactions_interval_check" CHECK (("expires_at" > "redacted_at"))
);


--
-- Name: recent_activity_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."recent_activity_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" character varying(255) NOT NULL,
    "actor_name" character varying(255) NOT NULL,
    "actor_avatar_url" "text",
    "actor_role" character varying(50) NOT NULL,
    "action" character varying(50) NOT NULL,
    "resource_type" character varying(50) NOT NULL,
    "resource_id" character varying(255) NOT NULL,
    "property_id" character varying(255),
    "organization_id" character varying(255) NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "event_id" character varying(255),
    "source" character varying(20) DEFAULT 'web'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: recent_activity_replay_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."recent_activity_replay_facts" (
    "replay_key" character varying(600) NOT NULL,
    "projection_id" "uuid",
    "source_kind" character varying(40) NOT NULL,
    "disposition" character varying(16) NOT NULL,
    "source_event_id" character varying(255),
    "source_event_type" "text",
    "source_event_version" integer,
    "source_context" "text",
    "source_aggregate_id" "text",
    "organization_id" character varying(255) NOT NULL,
    "property_id" character varying(255),
    "actor_subject_id" character varying(255),
    "actor_label_redacted_at" timestamp with time zone,
    "action" character varying(50),
    "resource_type" character varying(50),
    "resource_id" character varying(255),
    "transition_payload" "jsonb",
    "source" character varying(20),
    "source_occurred_at" timestamp with time zone NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recent_activity_replay_disposition_check" CHECK ((("disposition")::"text" = ANY ((ARRAY['projectable'::character varying, 'obsolete'::character varying])::"text"[]))),
    CONSTRAINT "recent_activity_replay_durable_source_check" CHECK ((((("source_kind")::"text" = 'durable_fact'::"text") AND ("source_event_id" IS NOT NULL) AND ("source_event_type" IS NOT NULL) AND ("source_event_version" >= 1) AND ("source_context" IS NOT NULL) AND ("source_aggregate_id" IS NOT NULL)) OR ((("source_kind")::"text" = 'legacy_projection_snapshot'::"text") AND (("disposition")::"text" = 'projectable'::"text") AND ("source_event_type" IS NULL) AND ("source_event_version" IS NULL) AND ("source_context" IS NULL) AND ("source_aggregate_id" IS NULL)))),
    CONSTRAINT "recent_activity_replay_projection_check" CHECK ((((("disposition")::"text" = 'projectable'::"text") AND ("projection_id" IS NOT NULL) AND ("action" IS NOT NULL) AND ("resource_type" IS NOT NULL) AND ("resource_id" IS NOT NULL) AND ("transition_payload" IS NOT NULL) AND (("source")::"text" = ANY ((ARRAY['web'::character varying, 'import'::character varying])::"text"[]))) OR ((("disposition")::"text" = 'obsolete'::"text") AND ("projection_id" IS NULL) AND ("actor_subject_id" IS NULL) AND ("action" IS NULL) AND ("resource_type" IS NULL) AND ("resource_id" IS NULL) AND ("transition_payload" IS NULL) AND ("source" IS NULL)))),
    CONSTRAINT "recent_activity_replay_source_kind_check" CHECK ((("source_kind")::"text" = ANY ((ARRAY['durable_fact'::character varying, 'legacy_projection_snapshot'::character varying])::"text"[])))
);


--
-- Name: recovery_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."recovery_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "generation" integer NOT NULL,
    "source_release_sha" character varying(40) NOT NULL,
    "source_manifest_sha256" character varying(64) NOT NULL,
    "restore_point_at" timestamp with time zone NOT NULL,
    "operator_id" character varying(255) NOT NULL,
    "correlation_id" character varying(255) NOT NULL,
    "counts" "jsonb" NOT NULL,
    "completed_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recovery_runs_generation_valid" CHECK (("generation" >= 1)),
    CONSTRAINT "recovery_runs_source_manifest_valid" CHECK ((("source_manifest_sha256")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "recovery_runs_source_release_valid" CHECK ((("source_release_sha")::"text" ~ '^[0-9a-f]{40}$'::"text")),
    CONSTRAINT "recovery_runs_time_valid" CHECK ((("restore_point_at" <= "completed_at") AND ("completed_at" >= "created_at")))
);


--
-- Name: replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."replies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "text" "text" NOT NULL,
    "reply_language_tag" character varying(35),
    "status" "public"."reply_status" NOT NULL,
    "source" "public"."reply_source" NOT NULL,
    "created_by" character varying(255),
    "approved_by" character varying(255),
    "rejected_by" character varying(255),
    "rejection_reason" "text",
    "ai_generated" boolean DEFAULT false NOT NULL,
    "authorship" "public"."reply_authorship",
    "state_revision" bigint DEFAULT 1 NOT NULL,
    "origin_operation_id" "uuid",
    "origin_source_epoch" integer,
    "origin_source_revision" bigint,
    "origin_base_reply_state_revision" bigint,
    "origin_reply_drafting_epoch" integer,
    "origin_property_profile_version" integer,
    "origin_ai_profile_version" character varying(100),
    "origin_reply_template_id" character varying(64),
    "origin_reply_template_catalogue_version" character varying(100),
    "origin_reply_template_catalogue_digest" character varying(64),
    "origin_concrete_language_tag" character varying(35),
    "origin_template_group" character varying(35),
    "ai_draft_expires_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "publication_state" "text",
    "publication_cycle" bigint DEFAULT 0 NOT NULL,
    "publication_attempts" integer DEFAULT 0 NOT NULL,
    "publication_last_error_class" "text",
    "reconcile_due_at" timestamp(3) with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "template_id" "uuid",
    "template_version" integer,
    "submitted_by" character varying(255),
    "template_layer" character varying(20),
    "template_ref" "text",
    "template_revision" integer,
    "template_wording_key" character varying(80),
    "voice_digest" character varying(64),
    "voice_choices" "jsonb",
    CONSTRAINT "replies_ai_provenance_valid" CHECK (((("authorship" = 'ai_assisted'::"public"."reply_authorship") AND ("origin_operation_id" IS NOT NULL) AND ("origin_source_epoch" >= 0) AND ("origin_source_revision" >= 1) AND (("origin_base_reply_state_revision" >= 0) AND ("origin_base_reply_state_revision" <= '9007199254740991'::bigint)) AND ("origin_reply_drafting_epoch" >= 1) AND ("origin_property_profile_version" >= 1) AND (((("origin_ai_profile_version")::"text" = 'reply-suggestion-v1'::"text") AND (("origin_reply_template_id")::"text" = ANY ((ARRAY['appreciation_positive'::character varying, 'appreciation_neutral'::character varying, 'recovery_service'::character varying, 'acknowledge_concern'::character varying])::"text"[])) AND (("origin_reply_template_catalogue_version")::"text" = 'gbp-reply-template-catalogue-v1'::"text") AND (("origin_reply_template_catalogue_digest")::"text" = 'ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f'::"text")) OR ((("origin_ai_profile_version")::"text" = ANY ((ARRAY['reply-draft-v1'::character varying, 'reply-draft-v2'::character varying, 'reply-draft-v3'::character varying])::"text"[])) AND ("origin_reply_template_id" IS NULL) AND ("origin_reply_template_catalogue_version" IS NULL) AND ("origin_reply_template_catalogue_digest" IS NULL) AND (("origin_template_group")::"text" = ANY ((ARRAY['en-Latn'::character varying, 'bg-Cyrl'::character varying])::"text"[]))) OR ((("origin_ai_profile_version")::"text" = 'reply-draft-v4'::"text") AND ("origin_reply_template_id" IS NULL) AND ("origin_reply_template_catalogue_version" IS NULL) AND ("origin_reply_template_catalogue_digest" IS NULL) AND (("origin_template_group")::"text" = ANY ((ARRAY['en-Latn'::character varying, 'es-Latn'::character varying, 'bg-Cyrl'::character varying])::"text"[])))) AND (("origin_template_group")::"text" = ANY ((ARRAY['en-Latn'::character varying, 'es-Latn'::character varying, 'fr-Latn'::character varying, 'de-Latn'::character varying, 'pt-Latn'::character varying, 'it-Latn'::character varying, 'nl-Latn'::character varying, 'pl-Latn'::character varying, 'tr-Latn'::character varying, 'uk-Cyrl'::character varying, 'ru-Cyrl'::character varying, 'ar-Arab'::character varying, 'he-Hebr'::character varying, 'hi-Deva'::character varying, 'bn-Beng'::character varying, 'ta-Taml'::character varying, 'th-Thai'::character varying, 'vi-Latn'::character varying, 'id-Latn'::character varying, 'zh-Hans'::character varying, 'zh-Hant'::character varying, 'ja-Jpan'::character varying, 'ko-Kore'::character varying, 'bg-Cyrl'::character varying])::"text"[])) AND ((("origin_concrete_language_tag")::"text" = ("origin_template_group")::"text") OR (("origin_concrete_language_tag")::"text" ~~ (("origin_template_group")::"text" || '-%'::"text"))) AND ("ai_draft_expires_at" IS NOT NULL)) OR (("origin_operation_id" IS NULL) AND ("origin_source_epoch" IS NULL) AND ("origin_source_revision" IS NULL) AND ("origin_base_reply_state_revision" IS NULL) AND ("origin_reply_drafting_epoch" IS NULL) AND ("origin_property_profile_version" IS NULL) AND ("origin_ai_profile_version" IS NULL) AND ("origin_reply_template_id" IS NULL) AND ("origin_reply_template_catalogue_version" IS NULL) AND ("origin_reply_template_catalogue_digest" IS NULL) AND ("origin_concrete_language_tag" IS NULL) AND ("origin_template_group" IS NULL) AND ("ai_draft_expires_at" IS NULL)))),
    CONSTRAINT "replies_authorship_valid" CHECK (((("source" = 'google_sync'::"public"."reply_source") AND ("authorship" IS NULL) AND ("ai_generated" = false)) OR (("source" = 'internal'::"public"."reply_source") AND ("authorship" IS NOT NULL) AND ((("ai_generated" = false) AND ("authorship" = 'human'::"public"."reply_authorship")) OR (("ai_generated" = true) AND ("authorship" = 'ai_assisted'::"public"."reply_authorship")))))),
    CONSTRAINT "replies_layered_template_provenance_valid" CHECK (((("template_layer" IS NULL) AND ("template_ref" IS NULL) AND ("template_revision" IS NULL) AND ("template_wording_key" IS NULL)) OR ((("template_layer")::"text" = ANY ((ARRAY['builtin'::character varying, 'account'::character varying, 'property'::character varying])::"text"[])) AND ("template_ref" IS NOT NULL) AND ("template_revision" >= 1) AND ("template_wording_key" IS NOT NULL)))),
    CONSTRAINT "replies_publication_cycle_safe" CHECK ((("publication_cycle" >= 0) AND ("publication_cycle" <= '9007199254740991'::bigint))),
    CONSTRAINT "replies_publication_last_error_class_check" CHECK (("publication_last_error_class" = ANY (ARRAY['terminal_rejection'::"text", 'retryable'::"text", 'ambiguous'::"text"]))),
    CONSTRAINT "replies_publication_state_check" CHECK (("publication_state" = ANY (ARRAY['requested'::"text", 'authorized'::"text", 'sending'::"text", 'pending_observation'::"text", 'published'::"text", 'terminal'::"text", 'ambiguous'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "replies_reply_language_tag_valid" CHECK ((("reply_language_tag" IS NULL) OR (("reply_language_tag")::"text" ~ '^(en-Latn|es-Latn|fr-Latn|de-Latn|pt-Latn|it-Latn|nl-Latn|pl-Latn|tr-Latn|uk-Cyrl|ru-Cyrl|ar-Arab|he-Hebr|hi-Deva|bn-Beng|ta-Taml|th-Thai|vi-Latn|id-Latn|zh-Hans|zh-Hant|ja-Jpan|ko-Kore|bg-Cyrl)(-(001|002|003|005|009|011|013|014|015|017|018|019|021|029|030|034|035|039|053|054|057|061|142|143|145|150|151|154|155|202|419|AC|AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CP|CQ|CR|CU|CV|CW|CX|CY|CZ|DE|DG|DJ|DK|DM|DO|DZ|EA|EC|EE|EG|EH|ER|ES|ET|EU|EZ|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|IC|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|QO|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TA|TC|TD|TF|TG|TH|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|UN|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|XA|XB|XK|YE|YT|ZA|ZM|ZW))?$'::"text"))),
    CONSTRAINT "replies_state_revision_safe" CHECK ((("state_revision" >= 1) AND ("state_revision" <= '9007199254740991'::bigint))),
    CONSTRAINT "replies_template_provenance_valid" CHECK (((("template_id" IS NULL) AND ("template_version" IS NULL)) OR (("template_id" IS NOT NULL) AND ("template_version" >= 1)))),
    CONSTRAINT "replies_voice_digest_valid" CHECK ((("voice_digest" IS NULL) OR (("voice_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")))
);


--
-- Name: reply_ai_frame_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reply_ai_frame_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "language_group" character varying(35) NOT NULL,
    "rating_band" character varying(30) NOT NULL,
    "voice_digest" character varying(64) NOT NULL,
    "generation_seed" character varying(64) NOT NULL,
    "choices" "jsonb" NOT NULL,
    "closing_order" integer[] NOT NULL,
    "adopted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reply_ai_frame_digest_valid" CHECK (((("voice_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("generation_seed")::"text" ~ '^[0-9a-f]{64}$'::"text")))
);


--
-- Name: reply_publication_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reply_publication_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "reply_id" "uuid" NOT NULL,
    "publication_cycle" bigint NOT NULL,
    "attempt_number" integer NOT NULL,
    "provider_operation_key" character varying(255) NOT NULL,
    "source_epoch" integer NOT NULL,
    "material_review_revision" bigint NOT NULL,
    "reply_state_revision" bigint NOT NULL,
    "base_observation_revision" bigint DEFAULT 0 NOT NULL,
    "normalization_version" character varying(64) NOT NULL,
    "expected_reply_digest" character varying(64) NOT NULL,
    "outcome" character varying(48) DEFAULT 'sending'::character varying NOT NULL,
    "provider_correlation_id" character varying(255),
    "provider_responded_at" timestamp with time zone,
    "confirmed_observation_revision" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reply_publication_attempts_confirmation_valid" CHECK (((("outcome")::"text" = 'confirmed'::"text") = ("confirmed_observation_revision" IS NOT NULL))),
    CONSTRAINT "reply_publication_attempts_digest_valid" CHECK (((("normalization_version")::"text" = 'google-reply-v1'::"text") AND (("expected_reply_digest")::"text" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "reply_publication_attempts_outcome_valid" CHECK ((("outcome")::"text" = ANY ((ARRAY['sending'::character varying, 'provider_outcome_pending'::character varying, 'retryable_failure'::character varying, 'ambiguous'::character varying, 'terminal_rejection'::character varying, 'confirmed'::character varying, 'superseded'::character varying])::"text"[]))),
    CONSTRAINT "reply_publication_attempts_revisions_safe" CHECK (((("publication_cycle" >= 1) AND ("publication_cycle" <= '9007199254740991'::bigint)) AND (("attempt_number" >= 1) AND ("attempt_number" <= 2147483647)) AND (("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("material_review_revision" >= 1) AND ("material_review_revision" <= '9007199254740991'::bigint)) AND (("reply_state_revision" >= 1) AND ("reply_state_revision" <= '9007199254740991'::bigint)) AND (("base_observation_revision" >= 0) AND ("base_observation_revision" <= '9007199254740991'::bigint)) AND (("confirmed_observation_revision" IS NULL) OR (("confirmed_observation_revision" >= 1) AND ("confirmed_observation_revision" <= '9007199254740991'::bigint)))))
);


--
-- Name: reply_publication_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reply_publication_authorizations" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "reply_id" "uuid" NOT NULL,
    "publication_cycle" bigint NOT NULL,
    "source_epoch" integer NOT NULL,
    "material_review_revision" bigint NOT NULL,
    "base_observation_revision" bigint DEFAULT 0 NOT NULL,
    "authorized_by_user_id" character varying(255) NOT NULL,
    "reply_state_revision" bigint NOT NULL,
    "normalization_version" character varying(64) NOT NULL,
    "expected_reply_digest" character varying(64) NOT NULL,
    "authorized_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reply_publication_authorizations_digest_valid" CHECK (((("normalization_version")::"text" = 'google-reply-v1'::"text") AND (("expected_reply_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("length"("btrim"(("authorized_by_user_id")::"text")) >= 1) AND ("length"("btrim"(("authorized_by_user_id")::"text")) <= 255)))),
    CONSTRAINT "reply_publication_authorizations_revisions_safe" CHECK (((("publication_cycle" >= 1) AND ("publication_cycle" <= '9007199254740991'::bigint)) AND (("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("material_review_revision" >= 1) AND ("material_review_revision" <= '9007199254740991'::bigint)) AND (("base_observation_revision" >= 0) AND ("base_observation_revision" <= '9007199254740991'::bigint)) AND (("reply_state_revision" >= 1) AND ("reply_state_revision" <= '9007199254740991'::bigint))))
);


--
-- Name: reply_template_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reply_template_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "number" integer NOT NULL,
    "title" character varying(120) NOT NULL,
    "stars_min" smallint NOT NULL,
    "stars_max" smallint NOT NULL,
    "review_kind" character varying(20) NOT NULL,
    "topic" character varying(40),
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reply_template_revisions_kind_valid" CHECK ((("review_kind")::"text" = ANY ((ARRAY['text'::character varying, 'rating_only'::character varying])::"text"[]))),
    CONSTRAINT "reply_template_revisions_number_positive" CHECK (("number" >= 1)),
    CONSTRAINT "reply_template_revisions_rating_valid" CHECK (((("stars_min" >= 1) AND ("stars_min" <= 5)) AND (("stars_max" >= 1) AND ("stars_max" <= 5)) AND ("stars_min" <= "stars_max"))),
    CONSTRAINT "reply_template_revisions_title_nonblank" CHECK (("char_length"("btrim"(("title")::"text")) > 0)),
    CONSTRAINT "reply_template_revisions_topic_valid" CHECK ((("topic" IS NULL) OR (("topic")::"text" = ANY ((ARRAY['staff_service'::character varying, 'speed_waiting'::character varying, 'booking_arrival'::character varying, 'main_service'::character varying, 'food_drink'::character varying, 'cleanliness'::character varying, 'facilities_equipment'::character varying, 'price_billing'::character varying, 'atmosphere_noise'::character varying, 'location_access'::character varying, 'safety'::character varying, 'communication'::character varying])::"text"[]))))
);


--
-- Name: reply_template_visibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reply_template_visibility" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid",
    "builtin_key" character varying(80),
    "template_id" "uuid",
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reply_template_visibility_one_ref" CHECK (("num_nonnulls"("builtin_key", "template_id") = 1))
);


--
-- Name: reply_template_wordings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reply_template_wordings" (
    "revision_id" "uuid" NOT NULL,
    "wording_key" character varying(80) NOT NULL,
    "language_group" character varying(35) NOT NULL,
    "body" "text" NOT NULL,
    CONSTRAINT "reply_template_wordings_body_valid" CHECK ((("octet_length"("body") <= 4096) AND ("char_length"("btrim"("body")) > 0))),
    CONSTRAINT "reply_template_wordings_language_valid" CHECK ((("language_group")::"text" ~ '^(en-Latn|es-Latn|fr-Latn|de-Latn|pt-Latn|it-Latn|nl-Latn|pl-Latn|tr-Latn|uk-Cyrl|ru-Cyrl|ar-Arab|he-Hebr|hi-Deva|bn-Beng|ta-Taml|th-Thai|vi-Latn|id-Latn|zh-Hans|zh-Hant|ja-Jpan|ko-Kore|bg-Cyrl)(-(001|002|003|005|009|011|013|014|015|017|018|019|021|029|030|034|035|039|053|054|057|061|142|143|145|150|151|154|155|202|419|AC|AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CP|CQ|CR|CU|CV|CW|CX|CY|CZ|DE|DG|DJ|DK|DM|DO|DZ|EA|EC|EE|EG|EH|ER|ES|ET|EU|EZ|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|IC|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|QO|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TA|TC|TD|TF|TG|TH|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|UN|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|XA|XB|XK|YE|YT|ZA|ZM|ZW))?$'::"text"))
);


--
-- Name: reply_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reply_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid",
    "builtin_key" character varying(80),
    "based_on_template_id" "uuid",
    "based_on_builtin_version" integer,
    "current_revision_id" "uuid",
    "archived_at" timestamp with time zone,
    "created_by" character varying(255) NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reply_templates_base_valid" CHECK (((("property_id" IS NOT NULL) OR ("based_on_template_id" IS NULL)) AND ("num_nonnulls"("builtin_key", "based_on_template_id") <= 1))),
    CONSTRAINT "reply_templates_builtin_version_positive" CHECK ((("based_on_builtin_version" IS NULL) OR ("based_on_builtin_version" >= 1)))
);


--
-- Name: resend_webhook_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."resend_webhook_deliveries" (
    "event_id" character varying(255) NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: retention_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."retention_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "batch_size" integer NOT NULL,
    "batches" integer DEFAULT 0 NOT NULL,
    "rows_deleted" integer DEFAULT 0 NOT NULL,
    "rows_redacted" integer DEFAULT 0 NOT NULL,
    "outcome" "text" DEFAULT 'completed'::"text" NOT NULL,
    "error_code" "text",
    "policy_version" integer DEFAULT 1 NOT NULL
);


--
-- Name: review_ai_analysis_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_ai_analysis_heads" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "head_sequence" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_ai_analysis_heads_sequence_safe" CHECK ((("head_sequence" >= 0) AND ("head_sequence" <= '9007199254740991'::bigint))),
    CONSTRAINT "review_ai_analysis_heads_source_epoch_safe" CHECK ((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)))
);


--
-- Name: review_ai_analysis_released_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_ai_analysis_released_sequences" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "analysis_sequence" bigint NOT NULL,
    "reason" character varying(32) NOT NULL,
    "released_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_ai_analysis_released_sequences_reason_valid" CHECK ((("reason")::"text" = ANY ((ARRAY['replayed_observation'::character varying, 'out_of_order_observation'::character varying, 'operator_repair'::character varying])::"text"[]))),
    CONSTRAINT "review_ai_analysis_released_sequences_sequence_safe" CHECK ((("analysis_sequence" >= 1) AND ("analysis_sequence" <= '9007199254740991'::bigint))),
    CONSTRAINT "review_ai_analysis_released_sequences_source_epoch_safe" CHECK ((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)))
);


--
-- Name: review_first_sightings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_first_sightings" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "first_seen_at" timestamp with time zone NOT NULL,
    "first_seen_via" character varying(16) NOT NULL,
    "push_accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_first_sightings_via_valid" CHECK ((("first_seen_via")::"text" = ANY ((ARRAY['push'::character varying, 'push_reconcile'::character varying, 'snapshot'::character varying, 'head'::character varying, 'demand'::character varying])::"text"[])))
);


--
-- Name: review_google_reputation_snapshot_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_google_reputation_snapshot_facts" (
    "run_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "review_count" integer NOT NULL,
    "average_rating" double precision,
    "evaluated_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "listing_complete" boolean DEFAULT true NOT NULL,
    "numbers_observed_at" timestamp with time zone,
    CONSTRAINT "review_google_reputation_snapshot_source_epoch_valid" CHECK ((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647))),
    CONSTRAINT "review_google_reputation_snapshot_value_valid" CHECK (((("review_count" = 0) AND ("average_rating" IS NULL)) OR ((("review_count" >= 1) AND ("review_count" <= 10000)) AND (("average_rating" >= (0)::double precision) AND ("average_rating" <= (5)::double precision)))))
);


--
-- Name: review_lifecycle_recovery_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_lifecycle_recovery_executions" (
    "id" "uuid" NOT NULL,
    "recovery_generation" integer NOT NULL,
    "approval_id" character varying(160) NOT NULL,
    "approval_bundle_sha256" character varying(64) NOT NULL,
    "approver_identity" character varying(255) NOT NULL,
    "approval_key_id" character varying(64) NOT NULL,
    "approved_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "release_sha" character varying(40) NOT NULL,
    "release_manifest_sha256" character varying(64) NOT NULL,
    "restore_point_at" timestamp with time zone NOT NULL,
    "restore_database_service_name" character varying(255) NOT NULL,
    "railway_project_id" character varying(255),
    "railway_environment_id" character varying(255),
    "evaluated_at" timestamp with time zone NOT NULL,
    "source_policy_version" integer NOT NULL,
    "retention_policy_version" integer NOT NULL,
    "policy_sha256" character varying(64) NOT NULL,
    "report_sha256" character varying(64) NOT NULL,
    "report_expired" integer NOT NULL,
    "operator_id" character varying(255) NOT NULL,
    "correlation_id" character varying(255) NOT NULL,
    "state" character varying(32) NOT NULL,
    "checkpoint_created_at" timestamp with time zone,
    "checkpoint_review_id" "uuid",
    "pages" integer DEFAULT 0 NOT NULL,
    "scanned" integer DEFAULT 0 NOT NULL,
    "rows_redacted" integer DEFAULT 0 NOT NULL,
    "legacy_google_replies_reconciled" integer DEFAULT 0 NOT NULL,
    "recovery_replayed" boolean,
    "error_code" character varying(160),
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "review_lifecycle_recovery_checkpoint_valid" CHECK (((("checkpoint_created_at" IS NULL) = ("checkpoint_review_id" IS NULL)) AND ((("state")::"text" = 'applying'::"text") OR ("checkpoint_created_at" IS NULL)) AND (("checkpoint_created_at" IS NULL) OR ("checkpoint_created_at" <= "evaluated_at")))),
    CONSTRAINT "review_lifecycle_recovery_completion_valid" CHECK (((("state")::"text" = 'completed'::"text") = ("completed_at" IS NOT NULL))),
    CONSTRAINT "review_lifecycle_recovery_counts_valid" CHECK ((("report_expired" >= 0) AND ("pages" >= 0) AND ("scanned" >= 0) AND ("rows_redacted" >= 0) AND ("legacy_google_replies_reconciled" >= 0))),
    CONSTRAINT "review_lifecycle_recovery_digests_valid" CHECK (((("approval_bundle_sha256")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("policy_sha256")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("report_sha256")::"text" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "review_lifecycle_recovery_generation_valid" CHECK (("recovery_generation" >= 1)),
    CONSTRAINT "review_lifecycle_recovery_release_valid" CHECK (((("release_sha")::"text" ~ '^[0-9a-f]{40}$'::"text") AND (("release_manifest_sha256")::"text" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "review_lifecycle_recovery_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['applying'::character varying, 'lifecycle_applied'::character varying, 'completed'::character varying])::"text"[]))),
    CONSTRAINT "review_lifecycle_recovery_window_valid" CHECK ((("restore_point_at" <= "evaluated_at") AND ("evaluated_at" <= "approved_at") AND ("approved_at" < "expires_at")))
);


--
-- Name: review_provider_deletion_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_provider_deletion_candidates" (
    "run_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "expected_mapping_state" character varying(24) NOT NULL,
    "expected_source_revision" bigint NOT NULL,
    "state" character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_provider_deletion_candidates_mapping_state_valid" CHECK ((("expected_mapping_state")::"text" = ANY ((ARRAY['linked'::character varying, 'source_expired'::character varying])::"text"[]))),
    CONSTRAINT "review_provider_deletion_candidates_revision_safe" CHECK ((("expected_source_revision" >= 0) AND ("expected_source_revision" <= '9007199254740991'::bigint))),
    CONSTRAINT "review_provider_deletion_candidates_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['pending'::character varying, 'confirmed_missing'::character varying, 'observed'::character varying])::"text"[])))
);


--
-- Name: review_provider_history_cutoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_provider_history_cutoffs" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "cutoff_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_provider_history_cutoffs_source_epoch_valid" CHECK ((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)))
);


--
-- Name: review_provider_snapshot_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_provider_snapshot_members" (
    "run_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "main_seen" boolean DEFAULT false NOT NULL,
    "confirmation_seen" boolean DEFAULT false NOT NULL
);


--
-- Name: review_provider_snapshot_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_provider_snapshot_runs" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "observation_origin" character varying(32) DEFAULT 'legacy_unknown'::character varying NOT NULL,
    "state" character varying(16) NOT NULL,
    "phase" character varying(16) NOT NULL,
    "expected_total" integer,
    "expected_average_rating" double precision,
    "main_cursor_ref" character varying(76),
    "confirmation_cursor_ref" character varying(76),
    "main_page_count" integer DEFAULT 0 NOT NULL,
    "main_unique_count" integer DEFAULT 0 NOT NULL,
    "confirmation_page_count" integer DEFAULT 0 NOT NULL,
    "confirmation_unique_count" integer DEFAULT 0 NOT NULL,
    "apply_cursor_review_id" "uuid",
    "started_at" timestamp with time zone NOT NULL,
    "confirmation_deadline" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "terminal_at" timestamp with time zone,
    "record_expires_at" timestamp with time zone,
    "failure_code" character varying(64),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_provider_snapshot_runs_counts_valid" CHECK (((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("expected_total" IS NULL) OR (("expected_total" >= 0) AND ("expected_total" <= 10000))) AND (("expected_average_rating" IS NULL) OR (("expected_average_rating" >= (0)::double precision) AND ("expected_average_rating" <= (5)::double precision))) AND ((("expected_total" IS NULL) AND ("expected_average_rating" IS NULL)) OR (("expected_total" = 0) AND ("expected_average_rating" IS NULL)) OR (("expected_total" > 0) AND ("expected_average_rating" IS NOT NULL))) AND (("main_page_count" >= 0) AND ("main_page_count" <= 200)) AND (("confirmation_page_count" >= 0) AND ("confirmation_page_count" <= 200)) AND (("main_unique_count" >= 0) AND ("main_unique_count" <= 10000)) AND (("confirmation_unique_count" >= 0) AND ("confirmation_unique_count" <= 10000)))),
    CONSTRAINT "review_provider_snapshot_runs_observation_origin_valid" CHECK ((("observation_origin")::"text" = ANY ((ARRAY['ongoing'::character varying, 'historical_onboarding'::character varying, 'legacy_unknown'::character varying])::"text"[]))),
    CONSTRAINT "review_provider_snapshot_runs_phase_valid" CHECK ((("phase")::"text" = ANY ((ARRAY['main'::character varying, 'confirmation'::character varying, 'apply'::character varying, 'terminal'::character varying])::"text"[]))),
    CONSTRAINT "review_provider_snapshot_runs_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['scanning'::character varying, 'confirming'::character varying, 'deleting'::character varying, 'completed'::character varying, 'failed'::character varying])::"text"[]))),
    CONSTRAINT "review_provider_snapshot_runs_terminal_valid" CHECK ((((("state")::"text" = ANY ((ARRAY['completed'::character varying, 'failed'::character varying])::"text"[])) AND ("terminal_at" IS NOT NULL) AND ("record_expires_at" = ("terminal_at" + '30 days'::interval))) OR ((("state")::"text" <> ALL ((ARRAY['completed'::character varying, 'failed'::character varying])::"text"[])) AND ("terminal_at" IS NULL) AND ("record_expires_at" IS NULL))))
);


--
-- Name: review_provider_subject_hmac_key_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_provider_subject_hmac_key_versions" (
    "key_version" character varying(32) NOT NULL,
    "key_digest" character varying(64) NOT NULL,
    "state" character varying(16) NOT NULL,
    "generation" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activated_at" timestamp with time zone,
    "retiring_at" timestamp with time zone,
    CONSTRAINT "review_provider_subject_key_digest_valid" CHECK ((("key_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "review_provider_subject_key_generation_safe" CHECK ((("generation" >= 1) AND ("generation" <= '9007199254740991'::bigint))),
    CONSTRAINT "review_provider_subject_key_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['trusted_next'::character varying, 'active'::character varying, 'retiring'::character varying])::"text"[]))),
    CONSTRAINT "review_provider_subject_key_version_valid" CHECK ((("key_version")::"text" ~ '^[a-z0-9][a-z0-9._-]{0,31}$'::"text"))
);


--
-- Name: review_provider_subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_provider_subjects" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "key_version" character varying(32) NOT NULL,
    "locator_hmac" "bytea" NOT NULL,
    "verifier_hmac" "bytea" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "last_source_revision" bigint NOT NULL,
    "state" character varying(24) NOT NULL,
    "last_observed_at" timestamp with time zone NOT NULL,
    "last_seen_snapshot_run_id" "uuid",
    "first_missing_at" timestamp with time zone,
    "first_missing_snapshot_run_id" "uuid",
    "unlinked_at" timestamp with time zone,
    "unlink_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_provider_subjects_controls_safe" CHECK (((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("last_source_revision" >= 0) AND ("last_source_revision" <= '9007199254740991'::bigint)))),
    CONSTRAINT "review_provider_subjects_hmac_length_valid" CHECK ((("octet_length"("locator_hmac") = 32) AND ("octet_length"("verifier_hmac") = 32))),
    CONSTRAINT "review_provider_subjects_missing_pair_valid" CHECK ((("first_missing_at" IS NULL) = ("first_missing_snapshot_run_id" IS NULL))),
    CONSTRAINT "review_provider_subjects_state_valid" CHECK ((("state")::"text" = ANY ((ARRAY['linked'::character varying, 'source_expired'::character varying, 'provider_deleted'::character varying])::"text"[]))),
    CONSTRAINT "review_provider_subjects_unlink_valid" CHECK ((((("state")::"text" = 'linked'::"text") AND ("unlinked_at" IS NULL) AND ("unlink_expires_at" IS NULL)) OR ((("state")::"text" <> 'linked'::"text") AND ("unlinked_at" IS NOT NULL) AND ("unlink_expires_at" = ("unlinked_at" + '2 years'::interval)))))
);


--
-- Name: review_refresh_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_refresh_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "cursor_content_expires_at" timestamp with time zone,
    "cursor_review_id" "uuid",
    "batch_size" integer NOT NULL,
    "max_batches" integer NOT NULL,
    "batches_processed" integer DEFAULT 0 NOT NULL,
    "candidates_seen" integer DEFAULT 0 NOT NULL,
    "refresh_due_count" integer DEFAULT 0 NOT NULL,
    "enqueued_count" integer DEFAULT 0 NOT NULL,
    "enqueue_failed_count" integer DEFAULT 0 NOT NULL,
    "oldest_due_content_expires_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "failure_reason" "text",
    "next_attempt_at" timestamp with time zone
);


--
-- Name: review_source_contents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_source_contents" (
    "review_id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "platform" "public"."review_platform" NOT NULL,
    "external_id" character varying(500) NOT NULL,
    "external_location_id" character varying(500) NOT NULL,
    "google_connection_id" "uuid",
    "reviewer_name" character varying(255),
    "reviewer_profile_photo_url" character varying(1000),
    "rating" integer NOT NULL,
    "text" "text",
    "translated_text" "text",
    "language_code" character varying(10),
    "reviewed_at" timestamp with time zone NOT NULL,
    "source_created_at" timestamp with time zone,
    "source_updated_at" timestamp with time zone,
    "first_fetched_at" timestamp with time zone,
    "last_fetched_at" timestamp with time zone NOT NULL,
    "content_expires_at" timestamp with time zone NOT NULL,
    "content_hash" "text",
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "ai_source_byte_length" integer NOT NULL,
    "ai_source_digest" character varying(64) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "google_review_url" character varying(2048),
    CONSTRAINT "review_source_contents_ai_source_valid" CHECK (((("ai_source_byte_length" >= 1) AND ("ai_source_byte_length" <= '4294967295'::bigint)) AND (("ai_source_digest")::"text" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "review_source_contents_epoch_revision_safe" CHECK (((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("source_revision" >= 0) AND ("source_revision" <= '9007199254740991'::bigint)))),
    CONSTRAINT "review_source_contents_rating_valid" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


--
-- Name: review_source_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_source_observations" (
    "review_id" "uuid" NOT NULL,
    "observation_sequence" bigint NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "source_epoch" integer NOT NULL,
    "observation_key" character varying(64) NOT NULL,
    "observation_digest" character varying(64) NOT NULL,
    "material_revision" bigint NOT NULL,
    "observed_at" timestamp with time zone NOT NULL,
    "content_expires_at" timestamp with time zone NOT NULL,
    "source_created_at" timestamp with time zone,
    "source_updated_at" timestamp with time zone,
    "source_digest" character varying(64),
    "normalization_version" character varying(64) NOT NULL,
    "normalized_digest" character varying(64),
    "comparison_result" character varying(40) NOT NULL,
    "rating" integer,
    "original_text" "text",
    "translated_text" "text",
    "language_code" character varying(10),
    "reviewer_name" character varying(255),
    "reviewer_profile_photo_url" character varying(1000),
    "reviewed_at" timestamp with time zone,
    "content_state" character varying(24) DEFAULT 'active'::character varying NOT NULL,
    "content_erased_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_source_observations_comparison_valid" CHECK ((("comparison_result")::"text" = ANY ((ARRAY['backfilled_unverified'::character varying, 'initial_material_revision'::character varying, 'unchanged'::character varying, 'material_change'::character varying, 'normalization_shadow_match'::character varying, 'baseline_unavailable'::character varying, 'out_of_order_ignored'::character varying])::"text"[]))),
    CONSTRAINT "review_source_observations_content_state_valid" CHECK ((((("content_state")::"text" = 'active'::"text") AND ("content_erased_at" IS NULL) AND ("rating" IS NOT NULL) AND (("rating" >= 1) AND ("rating" <= 5)) AND ("reviewed_at" IS NOT NULL)) OR ((("content_state")::"text" = ANY ((ARRAY['source_expired'::character varying, 'provider_deleted'::character varying])::"text"[])) AND ("content_erased_at" IS NOT NULL) AND ("rating" IS NULL) AND ("original_text" IS NULL) AND ("translated_text" IS NULL) AND ("language_code" IS NULL) AND ("reviewer_name" IS NULL) AND ("reviewer_profile_photo_url" IS NULL) AND ("reviewed_at" IS NULL) AND ("source_created_at" IS NULL) AND ("source_updated_at" IS NULL)))),
    CONSTRAINT "review_source_observations_controls_safe" CHECK (((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647)) AND (("observation_sequence" >= 1) AND ("observation_sequence" <= '9007199254740991'::bigint)) AND (("material_revision" >= 1) AND ("material_revision" <= '9007199254740991'::bigint)))),
    CONSTRAINT "review_source_observations_digest_valid" CHECK (((("observation_key")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (("observation_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND (((("normalization_version")::"text" = 'legacy-unverified-v0'::"text") AND ("source_digest" IS NULL) AND ("normalized_digest" IS NULL)) OR ((("normalization_version")::"text" = 'review-material-v1'::"text") AND ("source_digest" IS NOT NULL) AND (("source_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("normalized_digest" IS NOT NULL) AND (("normalized_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")))))
);


--
-- Name: review_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "property_id" character varying(255) NOT NULL,
    "source" "text" DEFAULT 'google'::"text" NOT NULL,
    "mode" "text" NOT NULL,
    "source_epoch" integer,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "page_count" integer DEFAULT 0,
    "review_count" integer DEFAULT 0,
    "created_count" integer DEFAULT 0,
    "updated_count" integer DEFAULT 0,
    "deleted_count" integer DEFAULT 0,
    "failed_count" integer DEFAULT 0,
    "result" "text",
    "error_class" "text"
);


--
-- Name: review_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."review_sync_state" (
    "property_id" character varying(255) NOT NULL,
    "source" "text" DEFAULT 'google'::"text" NOT NULL,
    "connection_id" character varying(255),
    "source_epoch" integer DEFAULT 0 NOT NULL,
    "watermark_updated_at" timestamp with time zone,
    "watermark_source_name" "text",
    "overlap_duration_ms" bigint DEFAULT 300000,
    "generation_id" "uuid",
    "page_token" "text",
    "inventory_started_at" timestamp with time zone,
    "inventory_completed_at" timestamp with time zone,
    "inventory_status" "text" DEFAULT 'idle'::"text",
    "next_incremental_at" timestamp with time zone,
    "next_inventory_at" timestamp with time zone,
    "lease_owner" "text",
    "lease_until" timestamp with time zone,
    "last_notification_at" timestamp with time zone,
    "last_new_review_at" timestamp with time zone,
    "last_success_at" timestamp with time zone,
    "last_terminal_error_at" timestamp with time zone,
    "error_class" "text",
    "error_retry_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "platform" "public"."review_platform" NOT NULL,
    "external_id" character varying(500),
    "external_location_id" character varying(500),
    "google_connection_id" "uuid",
    "reviewer_name" character varying(255),
    "reviewer_profile_photo_url" character varying(1000),
    "rating" integer,
    "text" "text",
    "translated_text" "text",
    "language_code" character varying(10),
    "reviewed_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "sentiment_label" character varying(20),
    "sentiment_score" real,
    "source_created_at" timestamp with time zone,
    "source_updated_at" timestamp with time zone,
    "first_fetched_at" timestamp with time zone,
    "last_fetched_at" timestamp with time zone,
    "content_expires_at" timestamp with time zone,
    "content_hash" "text",
    "source_seen_generation" "uuid",
    "source_epoch" integer NOT NULL,
    "source_revision" bigint NOT NULL,
    "source_observation_sequence" bigint DEFAULT 0 NOT NULL,
    "material_normalization_version" character varying(64),
    "material_source_digest" character varying(64),
    "material_normalized_digest" character varying(64),
    "analysis_sequence" bigint NOT NULL,
    "ai_source_byte_length" integer,
    "ai_source_digest" character varying(64),
    "source_content_state" character varying(24) DEFAULT 'active'::character varying NOT NULL,
    "source_content_erased_at" timestamp with time zone,
    "reply_state_revision" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "google_review_url" character varying(2048),
    CONSTRAINT "reviews_ai_source_byte_length_valid" CHECK ((("ai_source_byte_length" >= 1) AND ("ai_source_byte_length" <= '4294967295'::bigint))),
    CONSTRAINT "reviews_ai_source_digest_valid" CHECK ((("ai_source_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "reviews_analysis_sequence_safe" CHECK ((("analysis_sequence" >= 0) AND ("analysis_sequence" <= '9007199254740991'::bigint))),
    CONSTRAINT "reviews_material_comparison_head_valid" CHECK (((("material_normalization_version" IS NULL) AND ("material_source_digest" IS NULL) AND ("material_normalized_digest" IS NULL)) OR ((("material_normalization_version")::"text" = 'legacy-unverified-v0'::"text") AND ("material_source_digest" IS NULL) AND ("material_normalized_digest" IS NULL)) OR ((("material_normalization_version")::"text" = 'review-material-v1'::"text") AND ("material_source_digest" IS NOT NULL) AND (("material_source_digest")::"text" ~ '^[0-9a-f]{64}$'::"text") AND ("material_normalized_digest" IS NOT NULL) AND (("material_normalized_digest")::"text" ~ '^[0-9a-f]{64}$'::"text")))),
    CONSTRAINT "reviews_reply_state_revision_safe" CHECK ((("reply_state_revision" >= 0) AND ("reply_state_revision" <= '9007199254740991'::bigint))),
    CONSTRAINT "reviews_source_content_state_valid" CHECK ((((("source_content_state")::"text" = 'active'::"text") AND ("source_content_erased_at" IS NULL)) OR ((("source_content_state")::"text" = ANY ((ARRAY['source_expired'::character varying, 'provider_deleted'::character varying])::"text"[])) AND ("source_content_erased_at" IS NOT NULL) AND ("external_id" IS NULL) AND ("external_location_id" IS NULL) AND ("google_connection_id" IS NULL) AND ("reviewer_name" IS NULL) AND ("reviewer_profile_photo_url" IS NULL) AND ("google_review_url" IS NULL) AND ("rating" IS NULL) AND ("text" IS NULL) AND ("translated_text" IS NULL) AND ("language_code" IS NULL) AND ("reviewed_at" IS NULL) AND ("source_created_at" IS NULL) AND ("source_updated_at" IS NULL) AND ("content_hash" IS NULL) AND ("ai_source_byte_length" IS NULL) AND ("ai_source_digest" IS NULL)))),
    CONSTRAINT "reviews_source_epoch_safe" CHECK ((("source_epoch" >= 0) AND ("source_epoch" <= 2147483647))),
    CONSTRAINT "reviews_source_observation_sequence_safe" CHECK ((("source_observation_sequence" >= 0) AND ("source_observation_sequence" <= '9007199254740991'::bigint))),
    CONSTRAINT "reviews_source_revision_safe" CHECK ((("source_revision" >= 0) AND ("source_revision" <= '9007199254740991'::bigint)))
);


--
-- Name: scan_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."scan_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "portal_id" "uuid" NOT NULL,
    "property_id" character varying(255) NOT NULL,
    "source" character varying(10) NOT NULL,
    "session_id" character varying(255),
    "ip_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."session" (
    "id" "text" NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "token" "text" NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" "text",
    "userAgent" "text",
    "userId" "text" NOT NULL,
    "activeOrganizationId" "text"
);


--
-- Name: setup_checklist_milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."setup_checklist_milestones" (
    "organization_id" character varying(255) NOT NULL,
    "step" character varying(40) NOT NULL,
    "first_completed_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "setup_checklist_milestones_step_valid" CHECK ((("step")::"text" = ANY ((ARRAY['google_connection'::character varying, 'initial_review_sync'::character varying, 'published_portal'::character varying, 'responsible_managers'::character varying])::"text"[])))
);


--
-- Name: staff_onboardings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."staff_onboardings" (
    "id" "uuid" NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "email" "text",
    "display_name" character varying(100),
    "source_portal_id" "uuid",
    "portal_group_id" "uuid",
    "requested_by" character varying(255) NOT NULL,
    "status" character varying(16) DEFAULT 'running'::character varying NOT NULL,
    "step" "text" NOT NULL,
    "staff_participant_id" "uuid",
    "staff_participation_id" "uuid",
    "portal_id" "uuid",
    "invitation_id" "text",
    "failure_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_onboardings_email_lowercase" CHECK ((("email" IS NULL) OR ("email" = "lower"("email")))),
    CONSTRAINT "staff_onboardings_finished_identifiers_only" CHECK (((("status")::"text" <> ALL ((ARRAY['done'::character varying, 'cancelled'::character varying])::"text"[])) OR (("email" IS NULL) AND ("display_name" IS NULL)))),
    CONSTRAINT "staff_onboardings_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['running'::character varying, 'failed'::character varying, 'done'::character varying, 'cancelled'::character varying])::"text"[])))
);


--
-- Name: staff_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."staff_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "display_name" character varying(255) NOT NULL,
    "status" "public"."staff_participant_status" DEFAULT 'active'::"public"."staff_participant_status" NOT NULL,
    "archived_at" timestamp with time zone,
    "archive_reason" "text",
    "revision" integer DEFAULT 1 NOT NULL,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_participants_lifecycle_consistent" CHECK (((("status" = 'active'::"public"."staff_participant_status") AND ("archived_at" IS NULL) AND ("archive_reason" IS NULL)) OR (("status" = 'archived'::"public"."staff_participant_status") AND ("archived_at" IS NOT NULL) AND ("archive_reason" IS NOT NULL)))),
    CONSTRAINT "staff_participants_revision_positive" CHECK (("revision" >= 1))
);


--
-- Name: staff_participations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."staff_participations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "staff_participant_id" "uuid",
    "user_id" character varying(255),
    "display_name" character varying(255) NOT NULL,
    "status" "public"."participation_status" DEFAULT 'active'::"public"."participation_status" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "archive_reason" "text",
    "revision" integer DEFAULT 1 NOT NULL,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "personal_portal_id" "uuid",
    CONSTRAINT "sp_archive_reason_consistent" CHECK (((("status" = 'archived'::"public"."participation_status") AND ("archive_reason" IS NOT NULL)) OR (("status" <> 'archived'::"public"."participation_status") AND ("archive_reason" IS NULL)))),
    CONSTRAINT "sp_lifecycle_consistent" CHECK (((("status" = 'active'::"public"."participation_status") AND ("ended_at" IS NULL)) OR (("status" <> 'active'::"public"."participation_status") AND ("ended_at" IS NOT NULL)))),
    CONSTRAINT "sp_revision_positive" CHECK (("revision" >= 1))
);


--
-- Name: staff_property_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."staff_property_settings" (
    "organization_id" character varying(255) NOT NULL,
    "property_id" "uuid" NOT NULL,
    "colleague_list_enabled" boolean DEFAULT false NOT NULL,
    "updated_by" character varying(255) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: staff_user_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."staff_user_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "staff_participant_id" "uuid" NOT NULL,
    "user_id" character varying(255) NOT NULL,
    "effective_from" timestamp with time zone NOT NULL,
    "effective_to" timestamp with time zone,
    "created_by" character varying(255) NOT NULL,
    "end_reason" "text",
    "notice_version" character varying(64),
    "notice_acknowledged_at" timestamp with time zone,
    CONSTRAINT "staff_user_links_interval_valid" CHECK ((("effective_to" IS NULL) OR ("effective_to" > "effective_from")))
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."user" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "emailVerified" boolean NOT NULL,
    "image" "text",
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."verification" (
    "id" "text" NOT NULL,
    "identifier" "text" NOT NULL,
    "value" "text" NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: work_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."work_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" character varying(255) NOT NULL,
    "subject_id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "recovery" "text" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "due_at" timestamp with time zone NOT NULL,
    "dispatch_after" timestamp with time zone NOT NULL,
    "dispatch_sequence" integer DEFAULT 0 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 8 NOT NULL,
    "lease_token" "uuid",
    "lease_expires_at" timestamp with time zone,
    "error_code" "text",
    "operator_id" "text",
    "operator_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "work_items_attempts_check" CHECK ((("attempts" >= 0) AND (("max_attempts" >= 1) AND ("max_attempts" <= 100)) AND ("attempts" <= "max_attempts") AND ("dispatch_sequence" >= 0))),
    CONSTRAINT "work_items_completion_check" CHECK ((("state" = ANY (ARRAY['succeeded'::"text", 'cancelled'::"text", 'discarded'::"text"])) = ("completed_at" IS NOT NULL))),
    CONSTRAINT "work_items_error_check" CHECK ((("error_code" IS NULL) OR ("error_code" = ANY (ARRAY['lease_expired'::"text", 'attempts_exhausted'::"text", 'handler_failed'::"text", 'uncertain_write'::"text"])))),
    CONSTRAINT "work_items_identity_check" CHECK (((("length"("kind") >= 1) AND ("length"("kind") <= 160)) AND (("length"("idempotency_key") >= 1) AND ("length"("idempotency_key") <= 255)) AND (("length"("subject_id") >= 1) AND ("length"("subject_id") <= 255)) AND ("length"(("organization_id")::"text") > 0))),
    CONSTRAINT "work_items_lease_check" CHECK (((("state" = 'running'::"text") AND ("lease_token" IS NOT NULL) AND ("lease_expires_at" IS NOT NULL)) OR (("state" <> 'running'::"text") AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL)))),
    CONSTRAINT "work_items_recovery_check" CHECK (("recovery" = ANY (ARRAY['retry'::"text", 'read_back'::"text"]))),
    CONSTRAINT "work_items_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'running'::"text", 'succeeded'::"text", 'quarantined'::"text", 'uncertain'::"text", 'cancelled'::"text", 'discarded'::"text"])))
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY "drizzle"."__drizzle_migrations" ALTER COLUMN "id" SET DEFAULT "nextval"('"drizzle"."__drizzle_migrations_id_seq"'::"regclass");


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY "drizzle"."__drizzle_migrations"
    ADD CONSTRAINT "__drizzle_migrations_pkey" PRIMARY KEY ("id");


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."account"
    ADD CONSTRAINT "account_pkey" PRIMARY KEY ("id");


--
-- Name: ai_draft_measurement_links ai_draft_measurement_links_reply_id_reply_revision_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_draft_measurement_links"
    ADD CONSTRAINT "ai_draft_measurement_links_reply_id_reply_revision_pk" PRIMARY KEY ("reply_id", "reply_revision");


--
-- Name: ai_draft_measurements ai_draft_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_draft_measurements"
    ADD CONSTRAINT "ai_draft_measurements_pkey" PRIMARY KEY ("id");


--
-- Name: ai_execution_control_heads ai_execution_control_heads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_execution_control_heads"
    ADD CONSTRAINT "ai_execution_control_heads_pkey" PRIMARY KEY ("scope_key");


--
-- Name: ai_execution_control_transitions ai_execution_control_transitions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_execution_control_transitions"
    ADD CONSTRAINT "ai_execution_control_transitions_pk" PRIMARY KEY ("control_id", "generation");


--
-- Name: ai_operations ai_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_operations"
    ADD CONSTRAINT "ai_operations_pkey" PRIMARY KEY ("id");


--
-- Name: ai_organization_cost_windows ai_organization_cost_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_organization_cost_windows"
    ADD CONSTRAINT "ai_organization_cost_windows_pkey" PRIMARY KEY ("id");


--
-- Name: ai_property_aggregate_contribution_aspects ai_property_aggregate_contribution_aspects_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_contribution_aspects"
    ADD CONSTRAINT "ai_property_aggregate_contribution_aspects_pk" PRIMARY KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "aspect");


--
-- Name: ai_property_aggregate_contribution_mentions ai_property_aggregate_contribution_mentions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_contribution_mentions"
    ADD CONSTRAINT "ai_property_aggregate_contribution_mentions_pk" PRIMARY KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "mention_ordinal");


--
-- Name: ai_property_aggregate_contributions ai_property_aggregate_contributions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_contributions"
    ADD CONSTRAINT "ai_property_aggregate_contributions_pk" PRIMARY KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence");


--
-- Name: ai_property_aggregate_heads ai_property_aggregate_heads_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_heads"
    ADD CONSTRAINT "ai_property_aggregate_heads_pk" PRIMARY KEY ("organization_id", "property_id", "source_epoch", "review_analysis_epoch", "property_profile_version");


--
-- Name: ai_property_aggregate_settlements ai_property_aggregate_settlements_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_settlements"
    ADD CONSTRAINT "ai_property_aggregate_settlements_pk" PRIMARY KEY ("organization_id", "property_id", "source_epoch", "review_analysis_epoch", "analysis_sequence");


--
-- Name: ai_property_daily_aggregates ai_property_daily_aggregates_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_daily_aggregates"
    ADD CONSTRAINT "ai_property_daily_aggregates_pk" PRIMARY KEY ("organization_id", "property_id", "local_date", "source_epoch", "review_analysis_epoch", "property_profile_version");


--
-- Name: ai_property_daily_aspect_aggregates ai_property_daily_aspect_aggregates_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_daily_aspect_aggregates"
    ADD CONSTRAINT "ai_property_daily_aspect_aggregates_pk" PRIMARY KEY ("organization_id", "property_id", "local_date", "source_epoch", "review_analysis_epoch", "property_profile_version", "aspect", "polarity");


--
-- Name: ai_property_issue_groups ai_property_issue_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_issue_groups"
    ADD CONSTRAINT "ai_property_issue_groups_pkey" PRIMARY KEY ("id");


--
-- Name: ai_property_issue_groups ai_property_issue_groups_scope_id_topic_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_issue_groups"
    ADD CONSTRAINT "ai_property_issue_groups_scope_id_topic_unique" UNIQUE ("organization_id", "property_id", "id", "topic");


--
-- Name: ai_property_issue_members ai_property_issue_members_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_issue_members"
    ADD CONSTRAINT "ai_property_issue_members_pk" PRIMARY KEY ("organization_id", "property_id", "topic", "member_key");


--
-- Name: ai_property_processing_profiles ai_property_processing_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_processing_profiles"
    ADD CONSTRAINT "ai_property_processing_profiles_pkey" PRIMARY KEY ("property_id");


--
-- Name: ai_property_review_population_daily ai_property_review_population_daily_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_review_population_daily"
    ADD CONSTRAINT "ai_property_review_population_daily_pk" PRIMARY KEY ("organization_id", "property_id", "source_epoch", "property_profile_version", "local_date");


--
-- Name: ai_property_trend_outcomes ai_property_trend_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_trend_outcomes"
    ADD CONSTRAINT "ai_property_trend_outcomes_pkey" PRIMARY KEY ("schedule_id");


--
-- Name: ai_property_trend_scheduler_heads ai_property_trend_scheduler_heads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_trend_scheduler_heads"
    ADD CONSTRAINT "ai_property_trend_scheduler_heads_pkey" PRIMARY KEY ("scheduler_key");


--
-- Name: ai_property_trend_schedules ai_property_trend_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_trend_schedules"
    ADD CONSTRAINT "ai_property_trend_schedules_pkey" PRIMARY KEY ("id");


--
-- Name: ai_review_analyses ai_review_analyses_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analyses"
    ADD CONSTRAINT "ai_review_analyses_pk" PRIMARY KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence");


--
-- Name: ai_review_analysis_aspects ai_review_analysis_aspects_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_aspects"
    ADD CONSTRAINT "ai_review_analysis_aspects_pk" PRIMARY KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "aspect");


--
-- Name: ai_review_analysis_backlog ai_review_analysis_backlog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_backlog"
    ADD CONSTRAINT "ai_review_analysis_backlog_pkey" PRIMARY KEY ("event_envelope_id");


--
-- Name: ai_review_analysis_enrollments ai_review_analysis_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_enrollments"
    ADD CONSTRAINT "ai_review_analysis_enrollments_pkey" PRIMARY KEY ("id");


--
-- Name: ai_review_analysis_mention_corrections ai_review_analysis_mention_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_mention_corrections"
    ADD CONSTRAINT "ai_review_analysis_mention_corrections_pkey" PRIMARY KEY ("id");


--
-- Name: ai_review_analysis_mention_sentences ai_review_analysis_mention_sentences_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_mention_sentences"
    ADD CONSTRAINT "ai_review_analysis_mention_sentences_pk" PRIMARY KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "mention_ordinal", "sentence_number");


--
-- Name: ai_review_analysis_mentions ai_review_analysis_mentions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_mentions"
    ADD CONSTRAINT "ai_review_analysis_mentions_pk" PRIMARY KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "mention_ordinal");


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id");


--
-- Name: audit_events audit_events_source_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_source_uniq" UNIQUE ("organization_id", "source_kind", "source_id");


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");


--
-- Name: authorization_execution_permits authorization_execution_permits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."authorization_execution_permits"
    ADD CONSTRAINT "authorization_execution_permits_pkey" PRIMARY KEY ("id");


--
-- Name: backup_erasure_ledger backup_erasure_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."backup_erasure_ledger"
    ADD CONSTRAINT "backup_erasure_ledger_pkey" PRIMARY KEY ("id");


--
-- Name: beta_feedback_masked_layouts beta_feedback_masked_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."beta_feedback_masked_layouts"
    ADD CONSTRAINT "beta_feedback_masked_layouts_pkey" PRIMARY KEY ("feedback_reference");


--
-- Name: beta_feedback_triage beta_feedback_triage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."beta_feedback_triage"
    ADD CONSTRAINT "beta_feedback_triage_pkey" PRIMARY KEY ("reference");


--
-- Name: beta_feedback_triage_transitions beta_feedback_triage_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."beta_feedback_triage_transitions"
    ADD CONSTRAINT "beta_feedback_triage_transitions_pkey" PRIMARY KEY ("transition_id");


--
-- Name: capability_execution_control capability_execution_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."capability_execution_control"
    ADD CONSTRAINT "capability_execution_control_pkey" PRIMARY KEY ("capability");


--
-- Name: event_consumer_receipts event_consumer_receipts_event_id_consumer_name_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."event_consumer_receipts"
    ADD CONSTRAINT "event_consumer_receipts_event_id_consumer_name_pk" PRIMARY KEY ("event_id", "consumer_name");


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");


--
-- Name: goal_month_target_changes goal_month_target_changes_change_result_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_month_target_changes"
    ADD CONSTRAINT "goal_month_target_changes_change_result_key" UNIQUE ("change_id", "monthly_result_id");


--
-- Name: goal_month_target_changes goal_month_target_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_month_target_changes"
    ADD CONSTRAINT "goal_month_target_changes_pkey" PRIMARY KEY ("id");


--
-- Name: goal_monthly_results goal_monthly_results_assignment_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_monthly_results"
    ADD CONSTRAINT "goal_monthly_results_assignment_period_key" UNIQUE ("assignment_id", "period_start", "period_end");


--
-- Name: goal_monthly_results goal_monthly_results_org_property_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_monthly_results"
    ADD CONSTRAINT "goal_monthly_results_org_property_id_key" UNIQUE ("organization_id", "property_id", "id");


--
-- Name: goal_monthly_results goal_monthly_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_monthly_results"
    ADD CONSTRAINT "goal_monthly_results_pkey" PRIMARY KEY ("id");


--
-- Name: goal_program_versions goal_program_versions_assignment_fk_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_program_versions"
    ADD CONSTRAINT "goal_program_versions_assignment_fk_key" UNIQUE ("organization_id", "property_id", "program_id", "id", "metric_key");


--
-- Name: goal_program_versions goal_program_versions_org_property_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_program_versions"
    ADD CONSTRAINT "goal_program_versions_org_property_id_key" UNIQUE ("organization_id", "property_id", "id");


--
-- Name: goal_program_versions goal_program_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_program_versions"
    ADD CONSTRAINT "goal_program_versions_pkey" PRIMARY KEY ("id");


--
-- Name: goal_program_versions goal_program_versions_program_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_program_versions"
    ADD CONSTRAINT "goal_program_versions_program_version_key" UNIQUE ("program_id", "version");


--
-- Name: goal_programs goal_programs_org_property_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_programs"
    ADD CONSTRAINT "goal_programs_org_property_id_key" UNIQUE ("organization_id", "property_id", "id");


--
-- Name: goal_programs goal_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_programs"
    ADD CONSTRAINT "goal_programs_pkey" PRIMARY KEY ("id");


--
-- Name: goal_result_revisions goal_result_revisions_org_property_result_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_result_revisions"
    ADD CONSTRAINT "goal_result_revisions_org_property_result_id_key" UNIQUE ("organization_id", "property_id", "monthly_result_id", "id");


--
-- Name: goal_result_revisions goal_result_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_result_revisions"
    ADD CONSTRAINT "goal_result_revisions_pkey" PRIMARY KEY ("id");


--
-- Name: goal_result_revisions goal_result_revisions_result_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_result_revisions"
    ADD CONSTRAINT "goal_result_revisions_result_revision_key" UNIQUE ("monthly_result_id", "revision");


--
-- Name: goal_subject_assignments goal_subject_assignments_org_property_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_subject_assignments"
    ADD CONSTRAINT "goal_subject_assignments_org_property_id_key" UNIQUE ("organization_id", "property_id", "id");


--
-- Name: goal_subject_assignments goal_subject_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_subject_assignments"
    ADD CONSTRAINT "goal_subject_assignments_pkey" PRIMARY KEY ("id");


--
-- Name: goal_subject_assignments goal_subject_assignments_result_fk_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_subject_assignments"
    ADD CONSTRAINT "goal_subject_assignments_result_fk_key" UNIQUE ("organization_id", "property_id", "program_id", "program_version_id", "id");


--
-- Name: google_connections google_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_connections"
    ADD CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id");


--
-- Name: google_import_discovery_records google_import_discovery_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_import_discovery_records"
    ADD CONSTRAINT "google_import_discovery_records_pkey" PRIMARY KEY ("reference_key");


--
-- Name: google_import_items google_import_items_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_import_items"
    ADD CONSTRAINT "google_import_items_org_id_key" UNIQUE ("organization_id", "id");


--
-- Name: google_import_items google_import_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_import_items"
    ADD CONSTRAINT "google_import_items_pkey" PRIMARY KEY ("id");


--
-- Name: google_imports google_imports_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_imports"
    ADD CONSTRAINT "google_imports_org_id_key" UNIQUE ("organization_id", "id");


--
-- Name: google_imports google_imports_org_request_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_imports"
    ADD CONSTRAINT "google_imports_org_request_unique" UNIQUE ("organization_id", "request_id");


--
-- Name: google_imports google_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_imports"
    ADD CONSTRAINT "google_imports_pkey" PRIMARY KEY ("id");


--
-- Name: google_notification_accounts google_notification_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_notification_accounts"
    ADD CONSTRAINT "google_notification_accounts_pkey" PRIMARY KEY ("account_key");


--
-- Name: google_reply_observation_heads google_reply_observation_heads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_reply_observation_heads"
    ADD CONSTRAINT "google_reply_observation_heads_pkey" PRIMARY KEY ("review_id");


--
-- Name: google_reply_observations google_reply_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_reply_observations"
    ADD CONSTRAINT "google_reply_observations_pkey" PRIMARY KEY ("id");


--
-- Name: goal_program_versions gpv_no_overlapping_effective_intervals; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_program_versions"
    ADD CONSTRAINT "gpv_no_overlapping_effective_intervals" EXCLUDE USING "gist" ("organization_id" WITH =, "property_id" WITH =, "program_id" WITH =, "tstzrange"("effective_from", "effective_to", '[)'::"text") WITH &&);


--
-- Name: goal_subject_assignments gsa_no_overlapping_subject_metric_intervals; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_subject_assignments"
    ADD CONSTRAINT "gsa_no_overlapping_subject_metric_intervals" EXCLUDE USING "gist" ("organization_id" WITH =, "property_id" WITH =, "subject_kind" WITH =, COALESCE("property_subject_id", "portal_group_id", "portal_id") WITH =, "metric_key" WITH =, "tstzrange"("effective_from", "effective_to", '[)'::"text") WITH &&);


--
-- Name: guest_contact_request_reveal_audits guest_contact_request_reveal_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_contact_request_reveal_audits"
    ADD CONSTRAINT "guest_contact_request_reveal_audits_pkey" PRIMARY KEY ("id");


--
-- Name: guest_contact_requests guest_contact_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_contact_requests"
    ADD CONSTRAINT "guest_contact_requests_pkey" PRIMARY KEY ("id");


--
-- Name: guest_network_pressure_records guest_network_pressure_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_network_pressure_records"
    ADD CONSTRAINT "guest_network_pressure_records_pkey" PRIMARY KEY ("id");


--
-- Name: guest_qualified_scans guest_qualified_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_qualified_scans"
    ADD CONSTRAINT "guest_qualified_scans_pkey" PRIMARY KEY ("id");


--
-- Name: guest_response_experience_snapshots guest_response_experience_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_experience_snapshots"
    ADD CONSTRAINT "guest_response_experience_snapshots_pkey" PRIMARY KEY ("response_id");


--
-- Name: guest_response_integrity_decisions guest_response_integrity_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_integrity_decisions"
    ADD CONSTRAINT "guest_response_integrity_decisions_pkey" PRIMARY KEY ("id");


--
-- Name: guest_response_private_feedback guest_response_private_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_private_feedback"
    ADD CONSTRAINT "guest_response_private_feedback_pkey" PRIMARY KEY ("response_id");


--
-- Name: guest_response_session_bindings guest_response_session_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_session_bindings"
    ADD CONSTRAINT "guest_response_session_bindings_pkey" PRIMARY KEY ("response_id");


--
-- Name: guest_responses guest_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_responses"
    ADD CONSTRAINT "guest_responses_pkey" PRIMARY KEY ("id");


--
-- Name: idempotency_receipts idempotency_receipts_scope_key_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."idempotency_receipts"
    ADD CONSTRAINT "idempotency_receipts_scope_key_pk" PRIMARY KEY ("scope", "key");


--
-- Name: inbox_assignment_history inbox_assignment_history_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_assignment_history"
    ADD CONSTRAINT "inbox_assignment_history_pk" PRIMARY KEY ("inbox_item_id", "resulting_command_revision");


--
-- Name: inbox_escalation_history inbox_escalation_history_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_escalation_history"
    ADD CONSTRAINT "inbox_escalation_history_pk" PRIMARY KEY ("inbox_item_id", "resulting_command_revision");


--
-- Name: inbox_feedback_handling_outcomes inbox_feedback_handling_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_feedback_handling_outcomes"
    ADD CONSTRAINT "inbox_feedback_handling_outcomes_pkey" PRIMARY KEY ("id");


--
-- Name: inbox_handling_cycle_heads inbox_handling_cycle_heads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_heads"
    ADD CONSTRAINT "inbox_handling_cycle_heads_pkey" PRIMARY KEY ("inbox_item_id");


--
-- Name: inbox_handling_cycle_response_targets inbox_handling_cycle_response_targets_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_response_targets"
    ADD CONSTRAINT "inbox_handling_cycle_response_targets_pk" PRIMARY KEY ("inbox_item_id", "cycle_number");


--
-- Name: inbox_handling_cycle_transitions inbox_handling_cycle_transitions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_transitions"
    ADD CONSTRAINT "inbox_handling_cycle_transitions_pk" PRIMARY KEY ("inbox_item_id", "state_revision");


--
-- Name: inbox_handling_cycles inbox_handling_cycles_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycles"
    ADD CONSTRAINT "inbox_handling_cycles_pk" PRIMARY KEY ("inbox_item_id", "cycle_number");


--
-- Name: inbox_items inbox_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_items"
    ADD CONSTRAINT "inbox_items_pkey" PRIMARY KEY ("id");


--
-- Name: inbox_notes inbox_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_notes"
    ADD CONSTRAINT "inbox_notes_pkey" PRIMARY KEY ("id");


--
-- Name: inbox_priority_history inbox_priority_history_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_priority_history"
    ADD CONSTRAINT "inbox_priority_history_pk" PRIMARY KEY ("inbox_item_id", "resulting_command_revision");


--
-- Name: inbox_private_feedback_target_property_overrides inbox_private_feedback_target_property_overrides_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_private_feedback_target_property_overrides"
    ADD CONSTRAINT "inbox_private_feedback_target_property_overrides_pk" PRIMARY KEY ("organization_id", "property_id");


--
-- Name: inbox_response_target_exclusions inbox_response_target_exclusions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_response_target_exclusions"
    ADD CONSTRAINT "inbox_response_target_exclusions_pk" PRIMARY KEY ("inbox_item_id", "cycle_number");


--
-- Name: inbox_response_target_organization_policies inbox_response_target_organization_policies_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_response_target_organization_policies"
    ADD CONSTRAINT "inbox_response_target_organization_policies_pk" PRIMARY KEY ("organization_id", "target_kind");


--
-- Name: inbox_response_target_reminders inbox_response_target_reminders_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_response_target_reminders"
    ADD CONSTRAINT "inbox_response_target_reminders_pk" PRIMARY KEY ("inbox_item_id", "cycle_number", "reminder_kind");


--
-- Name: inbox_user_views inbox_user_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_user_views"
    ADD CONSTRAINT "inbox_user_views_pkey" PRIMARY KEY ("id");


--
-- Name: invitation invitation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."invitation"
    ADD CONSTRAINT "invitation_pkey" PRIMARY KEY ("id");


--
-- Name: material_review_revisions material_review_revisions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."material_review_revisions"
    ADD CONSTRAINT "material_review_revisions_pk" PRIMARY KEY ("review_id", "revision");


--
-- Name: member member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."member"
    ADD CONSTRAINT "member_pkey" PRIMARY KEY ("id");


--
-- Name: merchant_ai_consent_evidence merchant_ai_consent_evidence_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_consent_evidence"
    ADD CONSTRAINT "merchant_ai_consent_evidence_pk" PRIMARY KEY ("authorization_lineage_id", "state_version");


--
-- Name: merchant_ai_decision_deferrals merchant_ai_decision_deferrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_decision_deferrals"
    ADD CONSTRAINT "merchant_ai_decision_deferrals_pkey" PRIMARY KEY ("property_id");


--
-- Name: merchant_ai_enablement merchant_ai_enablement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_enablement"
    ADD CONSTRAINT "merchant_ai_enablement_pkey" PRIMARY KEY ("property_id");


--
-- Name: merchant_ai_notice_update_receipts merchant_ai_notice_update_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_notice_update_receipts"
    ADD CONSTRAINT "merchant_ai_notice_update_receipts_pkey" PRIMARY KEY ("user_id", "organization_id", "notice_version", "notice_digest");


--
-- Name: metric_corrections metric_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_corrections"
    ADD CONSTRAINT "metric_corrections_pkey" PRIMARY KEY ("id");


--
-- Name: metric_current_google_reputation_snapshots metric_current_google_reputation_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_current_google_reputation_snapshots"
    ADD CONSTRAINT "metric_current_google_reputation_snapshots_pkey" PRIMARY KEY ("property_id");


--
-- Name: metric_readings metric_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_readings"
    ADD CONSTRAINT "metric_readings_pkey" PRIMARY KEY ("id");


--
-- Name: notification_category_defaults notification_category_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_category_defaults"
    ADD CONSTRAINT "notification_category_defaults_pkey" PRIMARY KEY ("id");


--
-- Name: notification_digest_batch_members notification_digest_batch_members_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_digest_batch_members"
    ADD CONSTRAINT "notification_digest_batch_members_pk" PRIMARY KEY ("batch_id", "notification_email_id");


--
-- Name: notification_digest_batches notification_digest_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_digest_batches"
    ADD CONSTRAINT "notification_digest_batches_pkey" PRIMARY KEY ("id");


--
-- Name: notification_email_queue notification_email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_email_queue"
    ADD CONSTRAINT "notification_email_queue_pkey" PRIMARY KEY ("id");


--
-- Name: notification_email_suppression_removals notification_email_suppression_removals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_email_suppression_removals"
    ADD CONSTRAINT "notification_email_suppression_removals_pkey" PRIMARY KEY ("address_hash");


--
-- Name: notification_email_suppressions notification_email_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_email_suppressions"
    ADD CONSTRAINT "notification_email_suppressions_pkey" PRIMARY KEY ("address_hash");


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");


--
-- Name: notification_property_delivery_windows notification_property_delivery_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_property_delivery_windows"
    ADD CONSTRAINT "notification_property_delivery_windows_pkey" PRIMARY KEY ("id");


--
-- Name: notification_unsubscribe_scopes notification_unsubscribe_scopes_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_unsubscribe_scopes"
    ADD CONSTRAINT "notification_unsubscribe_scopes_pk" PRIMARY KEY ("target_kind", "target_id", "property_id", "category");


--
-- Name: notification_user_settings notification_user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_user_settings"
    ADD CONSTRAINT "notification_user_settings_pkey" PRIMARY KEY ("id");


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");


--
-- Name: operational_action_history_heads operational_action_history_heads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."operational_action_history_heads"
    ADD CONSTRAINT "operational_action_history_heads_pkey" PRIMARY KEY ("organization_id");


--
-- Name: operational_action_history_legal_holds operational_action_history_legal_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."operational_action_history_legal_holds"
    ADD CONSTRAINT "operational_action_history_legal_holds_pkey" PRIMARY KEY ("id");


--
-- Name: operational_action_history_records operational_action_history_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."operational_action_history_records"
    ADD CONSTRAINT "operational_action_history_records_pkey" PRIMARY KEY ("id");


--
-- Name: organizationRole organizationRole_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organizationRole"
    ADD CONSTRAINT "organizationRole_pkey" PRIMARY KEY ("id");


--
-- Name: organization_export_retrieval_issuances organization_export_retrieval_issuances_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization_export_retrieval_issuances"
    ADD CONSTRAINT "organization_export_retrieval_issuances_pk" PRIMARY KEY ("export_id", "export_revision");


--
-- Name: organization_exports organization_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization_exports"
    ADD CONSTRAINT "organization_exports_pkey" PRIMARY KEY ("id");


--
-- Name: organization_lifecycle_authority organization_lifecycle_authority_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization_lifecycle_authority"
    ADD CONSTRAINT "organization_lifecycle_authority_pkey" PRIMARY KEY ("organization_id");


--
-- Name: organization_lifecycle_events organization_lifecycle_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization_lifecycle_events"
    ADD CONSTRAINT "organization_lifecycle_events_pkey" PRIMARY KEY ("id");


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization"
    ADD CONSTRAINT "organization_pkey" PRIMARY KEY ("id");


--
-- Name: organization_reply_voices organization_reply_voices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization_reply_voices"
    ADD CONSTRAINT "organization_reply_voices_pkey" PRIMARY KEY ("organization_id");


--
-- Name: organization_role_policy organization_role_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization_role_policy"
    ADD CONSTRAINT "organization_role_policy_pkey" PRIMARY KEY ("id");


--
-- Name: organization organization_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization"
    ADD CONSTRAINT "organization_slug_key" UNIQUE ("slug");


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox_events"
    ADD CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id");


--
-- Name: permission_version permission_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."permission_version"
    ADD CONSTRAINT "permission_version_pkey" PRIMARY KEY ("organization_id");


--
-- Name: portal_group_memberships pgm_no_overlapping_portal_intervals; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_memberships"
    ADD CONSTRAINT "pgm_no_overlapping_portal_intervals" EXCLUDE USING "gist" ("organization_id" WITH =, "property_id" WITH =, "portal_id" WITH =, "tstzrange"("effective_from", "effective_to", '[)'::"text") WITH &&);


--
-- Name: policy_consent policy_consent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."policy_consent"
    ADD CONSTRAINT "policy_consent_pkey" PRIMARY KEY ("id");


--
-- Name: portal_access_artifacts portal_access_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_access_artifacts"
    ADD CONSTRAINT "portal_access_artifacts_pkey" PRIMARY KEY ("id");


--
-- Name: portal_address_downloads portal_address_downloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_address_downloads"
    ADD CONSTRAINT "portal_address_downloads_pkey" PRIMARY KEY ("id");


--
-- Name: portal_approved_destinations portal_approved_destinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_approved_destinations"
    ADD CONSTRAINT "portal_approved_destinations_pkey" PRIMARY KEY ("id");


--
-- Name: portal_goal_prompt_deferrals portal_goal_prompt_deferrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_goal_prompt_deferrals"
    ADD CONSTRAINT "portal_goal_prompt_deferrals_pkey" PRIMARY KEY ("property_id");


--
-- Name: portal_group_history portal_group_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_history"
    ADD CONSTRAINT "portal_group_history_pkey" PRIMARY KEY ("id");


--
-- Name: portal_group_members portal_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_members"
    ADD CONSTRAINT "portal_group_members_pkey" PRIMARY KEY ("id");


--
-- Name: portal_group_memberships portal_group_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_memberships"
    ADD CONSTRAINT "portal_group_memberships_pkey" PRIMARY KEY ("id");


--
-- Name: portal_groups portal_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_groups"
    ADD CONSTRAINT "portal_groups_pkey" PRIMARY KEY ("id");


--
-- Name: portal_health_intervals portal_health_intervals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_health_intervals"
    ADD CONSTRAINT "portal_health_intervals_pkey" PRIMARY KEY ("id");


--
-- Name: portal_last_prints portal_last_prints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_last_prints"
    ADD CONSTRAINT "portal_last_prints_pkey" PRIMARY KEY ("portal_id");


--
-- Name: portal_link_categories portal_link_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_link_categories"
    ADD CONSTRAINT "portal_link_categories_pkey" PRIMARY KEY ("id");


--
-- Name: portal_link_texts portal_link_texts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_link_texts"
    ADD CONSTRAINT "portal_link_texts_pkey" PRIMARY KEY ("id");


--
-- Name: portal_links portal_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_links"
    ADD CONSTRAINT "portal_links_pkey" PRIMARY KEY ("id");


--
-- Name: portal_localized_overrides portal_localized_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_localized_overrides"
    ADD CONSTRAINT "portal_localized_overrides_pkey" PRIMARY KEY ("id");


--
-- Name: portal_look_overrides portal_look_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_look_overrides"
    ADD CONSTRAINT "portal_look_overrides_pkey" PRIMARY KEY ("id");


--
-- Name: portal_media_assets portal_media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_media_assets"
    ADD CONSTRAINT "portal_media_assets_pkey" PRIMARY KEY ("id");


--
-- Name: portal_metric_lifetime_aggregates portal_metric_lifetime_aggregates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_metric_lifetime_aggregates"
    ADD CONSTRAINT "portal_metric_lifetime_aggregates_pkey" PRIMARY KEY ("id");


--
-- Name: portal_page_edits portal_page_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_page_edits"
    ADD CONSTRAINT "portal_page_edits_pkey" PRIMARY KEY ("id");


--
-- Name: portal_pending_content_changes portal_pending_content_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_pending_content_changes"
    ADD CONSTRAINT "portal_pending_content_changes_pkey" PRIMARY KEY ("id");


--
-- Name: portal_print_wordings portal_print_wordings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_print_wordings"
    ADD CONSTRAINT "portal_print_wordings_pkey" PRIMARY KEY ("portal_id");


--
-- Name: portal_publication_activations portal_publication_activations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_publication_activations"
    ADD CONSTRAINT "portal_publication_activations_pkey" PRIMARY KEY ("id");


--
-- Name: portal_publication_snapshots portal_publication_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_publication_snapshots"
    ADD CONSTRAINT "portal_publication_snapshots_pkey" PRIMARY KEY ("id");


--
-- Name: portal_responsibilities portal_responsibilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsibilities"
    ADD CONSTRAINT "portal_responsibilities_pkey" PRIMARY KEY ("id");


--
-- Name: portal_responsible_managers portal_responsible_managers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsible_managers"
    ADD CONSTRAINT "portal_responsible_managers_pkey" PRIMARY KEY ("id");


--
-- Name: portal_tokens portal_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_tokens"
    ADD CONSTRAINT "portal_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: portals portals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portals"
    ADD CONSTRAINT "portals_pkey" PRIMARY KEY ("id");


--
-- Name: portal_responsibilities pr_no_overlapping_primary_intervals; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsibilities"
    ADD CONSTRAINT "pr_no_overlapping_primary_intervals" EXCLUDE USING "gist" ("organization_id" WITH =, "property_id" WITH =, "portal_id" WITH =, "tstzrange"("effective_from", "effective_to", '[)'::"text") WITH &&) WHERE (("kind" = 'primary'::"public"."responsibility_kind"));


--
-- Name: portal_responsibilities pr_no_overlapping_responsibility_intervals; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsibilities"
    ADD CONSTRAINT "pr_no_overlapping_responsibility_intervals" EXCLUDE USING "gist" ("organization_id" WITH =, "property_id" WITH =, "portal_id" WITH =, "staff_participation_id" WITH =, "kind" WITH =, "tstzrange"("effective_from", "effective_to", '[)'::"text") WITH &&);


--
-- Name: privacy_requests privacy_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."privacy_requests"
    ADD CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id");


--
-- Name: product_update_receipts product_update_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_update_receipts"
    ADD CONSTRAINT "product_update_receipts_pkey" PRIMARY KEY ("user_id", "organization_id", "entry_id");


--
-- Name: product_update_settings product_update_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_update_settings"
    ADD CONSTRAINT "product_update_settings_pkey" PRIMARY KEY ("user_id", "organization_id");


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."properties"
    ADD CONSTRAINT "properties_pkey" PRIMARY KEY ("id");


--
-- Name: property_access_grant property_access_grant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_access_grant"
    ADD CONSTRAINT "property_access_grant_pkey" PRIMARY KEY ("id");


--
-- Name: property_access_grants property_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_access_grants"
    ADD CONSTRAINT "property_access_grants_pkey" PRIMARY KEY ("id");


--
-- Name: property_erase_authorities property_erase_authorities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_erase_authorities"
    ADD CONSTRAINT "property_erase_authorities_pkey" PRIMARY KEY ("id");


--
-- Name: property_portal_brand_contents property_portal_brand_contents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_portal_brand_contents"
    ADD CONSTRAINT "property_portal_brand_contents_pkey" PRIMARY KEY ("id");


--
-- Name: property_portal_brand_profiles property_portal_brand_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_portal_brand_profiles"
    ADD CONSTRAINT "property_portal_brand_profiles_pkey" PRIMARY KEY ("id");


--
-- Name: property_rating_goal_changes property_rating_goal_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_rating_goal_changes"
    ADD CONSTRAINT "property_rating_goal_changes_pkey" PRIMARY KEY ("id");


--
-- Name: property_rating_goal_deferrals property_rating_goal_deferrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_rating_goal_deferrals"
    ADD CONSTRAINT "property_rating_goal_deferrals_pkey" PRIMARY KEY ("property_id");


--
-- Name: property_rating_goals property_rating_goals_org_property_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_rating_goals"
    ADD CONSTRAINT "property_rating_goals_org_property_id_key" UNIQUE ("organization_id", "property_id", "id");


--
-- Name: property_rating_goals property_rating_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_rating_goals"
    ADD CONSTRAINT "property_rating_goals_pkey" PRIMARY KEY ("id");


--
-- Name: property_reply_voices property_reply_voices_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_reply_voices"
    ADD CONSTRAINT "property_reply_voices_pk" PRIMARY KEY ("organization_id", "property_id");


--
-- Name: property_responsible_managers property_responsible_managers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_responsible_managers"
    ADD CONSTRAINT "property_responsible_managers_pkey" PRIMARY KEY ("id");


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");


--
-- Name: recent_activity_actor_label_redactions recent_activity_actor_label_redactions_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recent_activity_actor_label_redactions"
    ADD CONSTRAINT "recent_activity_actor_label_redactions_pk" PRIMARY KEY ("organization_id", "actor_subject_id");


--
-- Name: recent_activity_entries recent_activity_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recent_activity_entries"
    ADD CONSTRAINT "recent_activity_entries_pkey" PRIMARY KEY ("id");


--
-- Name: recent_activity_replay_facts recent_activity_replay_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recent_activity_replay_facts"
    ADD CONSTRAINT "recent_activity_replay_facts_pkey" PRIMARY KEY ("replay_key");


--
-- Name: recovery_runs recovery_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recovery_runs"
    ADD CONSTRAINT "recovery_runs_pkey" PRIMARY KEY ("id");


--
-- Name: replies replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."replies"
    ADD CONSTRAINT "replies_pkey" PRIMARY KEY ("id");


--
-- Name: reply_ai_frame_reservations reply_ai_frame_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_ai_frame_reservations"
    ADD CONSTRAINT "reply_ai_frame_reservations_pkey" PRIMARY KEY ("id");


--
-- Name: reply_publication_attempts reply_publication_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_attempts"
    ADD CONSTRAINT "reply_publication_attempts_pkey" PRIMARY KEY ("id");


--
-- Name: reply_publication_authorizations reply_publication_authorizations_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_authorizations"
    ADD CONSTRAINT "reply_publication_authorizations_pk" PRIMARY KEY ("reply_id", "publication_cycle");


--
-- Name: reply_template_revisions reply_template_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_template_revisions"
    ADD CONSTRAINT "reply_template_revisions_pkey" PRIMARY KEY ("id");


--
-- Name: reply_template_visibility reply_template_visibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_template_visibility"
    ADD CONSTRAINT "reply_template_visibility_pkey" PRIMARY KEY ("id");


--
-- Name: reply_template_wordings reply_template_wordings_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_template_wordings"
    ADD CONSTRAINT "reply_template_wordings_pk" PRIMARY KEY ("revision_id", "wording_key", "language_group");


--
-- Name: reply_templates reply_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_templates"
    ADD CONSTRAINT "reply_templates_pkey" PRIMARY KEY ("id");


--
-- Name: resend_webhook_deliveries resend_webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."resend_webhook_deliveries"
    ADD CONSTRAINT "resend_webhook_deliveries_pkey" PRIMARY KEY ("event_id");


--
-- Name: retention_runs retention_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."retention_runs"
    ADD CONSTRAINT "retention_runs_pkey" PRIMARY KEY ("id");


--
-- Name: review_ai_analysis_heads review_ai_analysis_heads_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_ai_analysis_heads"
    ADD CONSTRAINT "review_ai_analysis_heads_pk" PRIMARY KEY ("organization_id", "property_id", "source_epoch");


--
-- Name: review_ai_analysis_released_sequences review_ai_analysis_released_sequences_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_ai_analysis_released_sequences"
    ADD CONSTRAINT "review_ai_analysis_released_sequences_pk" PRIMARY KEY ("organization_id", "property_id", "source_epoch", "analysis_sequence");


--
-- Name: review_first_sightings review_first_sightings_organization_id_property_id_review_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_first_sightings"
    ADD CONSTRAINT "review_first_sightings_organization_id_property_id_review_id_pk" PRIMARY KEY ("organization_id", "property_id", "review_id");


--
-- Name: review_google_reputation_snapshot_facts review_google_reputation_snapshot_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_google_reputation_snapshot_facts"
    ADD CONSTRAINT "review_google_reputation_snapshot_facts_pkey" PRIMARY KEY ("run_id");


--
-- Name: review_lifecycle_recovery_executions review_lifecycle_recovery_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_lifecycle_recovery_executions"
    ADD CONSTRAINT "review_lifecycle_recovery_executions_pkey" PRIMARY KEY ("id");


--
-- Name: review_provider_deletion_candidates review_provider_deletion_candidates_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_deletion_candidates"
    ADD CONSTRAINT "review_provider_deletion_candidates_pk" PRIMARY KEY ("run_id", "review_id");


--
-- Name: review_provider_history_cutoffs review_provider_history_cutoffs_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_history_cutoffs"
    ADD CONSTRAINT "review_provider_history_cutoffs_pk" PRIMARY KEY ("organization_id", "property_id", "source_epoch");


--
-- Name: review_provider_snapshot_members review_provider_snapshot_members_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_snapshot_members"
    ADD CONSTRAINT "review_provider_snapshot_members_pk" PRIMARY KEY ("run_id", "review_id");


--
-- Name: review_provider_snapshot_runs review_provider_snapshot_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_snapshot_runs"
    ADD CONSTRAINT "review_provider_snapshot_runs_pkey" PRIMARY KEY ("id");


--
-- Name: review_provider_subject_hmac_key_versions review_provider_subject_hmac_key_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_subject_hmac_key_versions"
    ADD CONSTRAINT "review_provider_subject_hmac_key_versions_pkey" PRIMARY KEY ("key_version");


--
-- Name: review_provider_subjects review_provider_subjects_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_subjects"
    ADD CONSTRAINT "review_provider_subjects_pk" PRIMARY KEY ("organization_id", "property_id", "source_epoch", "key_version", "locator_hmac");


--
-- Name: review_refresh_runs review_refresh_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_refresh_runs"
    ADD CONSTRAINT "review_refresh_runs_pkey" PRIMARY KEY ("id");


--
-- Name: review_source_contents review_source_contents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_source_contents"
    ADD CONSTRAINT "review_source_contents_pkey" PRIMARY KEY ("review_id");


--
-- Name: review_source_observations review_source_observations_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_source_observations"
    ADD CONSTRAINT "review_source_observations_pk" PRIMARY KEY ("review_id", "observation_sequence");


--
-- Name: review_sync_runs review_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_sync_runs"
    ADD CONSTRAINT "review_sync_runs_pkey" PRIMARY KEY ("id");


--
-- Name: review_sync_state review_sync_state_property_id_source_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_sync_state"
    ADD CONSTRAINT "review_sync_state_property_id_source_pk" PRIMARY KEY ("property_id", "source");


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");


--
-- Name: scan_events scan_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_events"
    ADD CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id");


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."session"
    ADD CONSTRAINT "session_pkey" PRIMARY KEY ("id");


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."session"
    ADD CONSTRAINT "session_token_key" UNIQUE ("token");


--
-- Name: setup_checklist_milestones setup_checklist_milestones_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."setup_checklist_milestones"
    ADD CONSTRAINT "setup_checklist_milestones_pk" PRIMARY KEY ("organization_id", "step");


--
-- Name: staff_onboardings staff_onboardings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_onboardings"
    ADD CONSTRAINT "staff_onboardings_pkey" PRIMARY KEY ("id");


--
-- Name: staff_participants staff_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_participants"
    ADD CONSTRAINT "staff_participants_pkey" PRIMARY KEY ("id");


--
-- Name: staff_participations staff_participations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_participations"
    ADD CONSTRAINT "staff_participations_pkey" PRIMARY KEY ("id");


--
-- Name: staff_property_settings staff_property_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_property_settings"
    ADD CONSTRAINT "staff_property_settings_pkey" PRIMARY KEY ("organization_id", "property_id");


--
-- Name: staff_user_links staff_user_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_user_links"
    ADD CONSTRAINT "staff_user_links_pkey" PRIMARY KEY ("id");


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user"
    ADD CONSTRAINT "user_email_key" UNIQUE ("email");


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user"
    ADD CONSTRAINT "user_pkey" PRIMARY KEY ("id");


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."verification"
    ADD CONSTRAINT "verification_pkey" PRIMARY KEY ("id");


--
-- Name: work_items work_items_idempotency_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."work_items"
    ADD CONSTRAINT "work_items_idempotency_unique" UNIQUE ("organization_id", "kind", "idempotency_key");


--
-- Name: work_items work_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."work_items"
    ADD CONSTRAINT "work_items_pkey" PRIMARY KEY ("id");


--
-- Name: account_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "account_userId_idx" ON "public"."account" USING "btree" ("userId");


--
-- Name: ai_draft_measurement_links_generation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_draft_measurement_links_generation_idx" ON "public"."ai_draft_measurement_links" USING "btree" ("generation_id");


--
-- Name: ai_draft_measurements_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_draft_measurements_created_idx" ON "public"."ai_draft_measurements" USING "btree" ("created_at");


--
-- Name: ai_draft_measurements_request_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_draft_measurements_request_unique" ON "public"."ai_draft_measurements" USING "btree" ("organization_id", "actor_user_id", "request_key");


--
-- Name: ai_execution_control_heads_control_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_execution_control_heads_control_unique" ON "public"."ai_execution_control_heads" USING "btree" ("control_id", "generation");


--
-- Name: ai_execution_control_transitions_scope_generation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_execution_control_transitions_scope_generation_unique" ON "public"."ai_execution_control_transitions" USING "btree" ("scope_key", "generation");


--
-- Name: ai_operations_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_operations_due_idx" ON "public"."ai_operations" USING "btree" ("state", "next_attempt_at");


--
-- Name: ai_operations_execution_permit_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_operations_execution_permit_unique" ON "public"."ai_operations" USING "btree" ("execution_permit_id") WHERE ("execution_permit_id" IS NOT NULL);


--
-- Name: ai_operations_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_operations_expiry_idx" ON "public"."ai_operations" USING "btree" ("expires_at");


--
-- Name: ai_operations_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_operations_idempotency_unique" ON "public"."ai_operations" USING "btree" ("idempotency_scope", "idempotency_key");


--
-- Name: ai_operations_one_rewrite_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_operations_one_rewrite_unique" ON "public"."ai_operations" USING "btree" ("rewrite_parent_operation_id") WHERE ("rewrite_parent_operation_id" IS NOT NULL);


--
-- Name: ai_operations_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_operations_property_idx" ON "public"."ai_operations" USING "btree" ("organization_id", "property_id", "created_at" DESC NULLS LAST);


--
-- Name: ai_operations_stale_reservation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_operations_stale_reservation_idx" ON "public"."ai_operations" USING "btree" ("budget_reserved_at") WHERE (("budget_settled_at" IS NULL) AND ("reserved_micros" > 0));


--
-- Name: ai_organization_cost_windows_month_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_organization_cost_windows_month_unique" ON "public"."ai_organization_cost_windows" USING "btree" ("organization_id", "window_start");


--
-- Name: ai_property_aggregate_contribution_mentions_identity_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_property_aggregate_contribution_mentions_identity_unique" ON "public"."ai_property_aggregate_contribution_mentions" USING "btree" ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "topic", COALESCE("thing", ''::character varying), "polarity");


--
-- Name: ai_property_aggregate_contribution_mentions_issue_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_aggregate_contribution_mentions_issue_group_idx" ON "public"."ai_property_aggregate_contribution_mentions" USING "btree" ("organization_id", "property_id", "issue_group_id") WHERE ("issue_group_id" IS NOT NULL);


--
-- Name: ai_property_aggregate_contributions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_aggregate_contributions_date_idx" ON "public"."ai_property_aggregate_contributions" USING "btree" ("organization_id", "property_id", "local_date", "source_epoch", "review_analysis_epoch");


--
-- Name: ai_property_aggregate_heads_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_aggregate_heads_current_idx" ON "public"."ai_property_aggregate_heads" USING "btree" ("organization_id", "property_id", "source_epoch", "review_analysis_epoch", "property_profile_version");


--
-- Name: ai_property_aggregate_settlements_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_aggregate_settlements_review_idx" ON "public"."ai_property_aggregate_settlements" USING "btree" ("organization_id", "property_id", "review_id", "source_epoch", "review_analysis_epoch", "analysis_sequence" DESC NULLS LAST);


--
-- Name: ai_property_daily_aggregates_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_daily_aggregates_window_idx" ON "public"."ai_property_daily_aggregates" USING "btree" ("organization_id", "property_id", "source_epoch", "review_analysis_epoch", "local_date");


--
-- Name: ai_property_daily_aspect_aggregates_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_daily_aspect_aggregates_window_idx" ON "public"."ai_property_daily_aspect_aggregates" USING "btree" ("organization_id", "property_id", "source_epoch", "review_analysis_epoch", "local_date");


--
-- Name: ai_property_issue_groups_canonical_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_property_issue_groups_canonical_active_unique" ON "public"."ai_property_issue_groups" USING "btree" ("organization_id", "property_id", "topic", "canonical_key") WHERE ("merged_into_issue_id" IS NULL);


--
-- Name: ai_property_issue_groups_merged_into_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_issue_groups_merged_into_idx" ON "public"."ai_property_issue_groups" USING "btree" ("organization_id", "property_id", "merged_into_issue_id") WHERE ("merged_into_issue_id" IS NOT NULL);


--
-- Name: ai_property_issue_groups_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_issue_groups_retention_idx" ON "public"."ai_property_issue_groups" USING "btree" ("expires_at");


--
-- Name: ai_property_issue_members_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_issue_members_group_idx" ON "public"."ai_property_issue_members" USING "btree" ("issue_group_id");


--
-- Name: ai_property_profiles_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_profiles_org_idx" ON "public"."ai_property_processing_profiles" USING "btree" ("organization_id", "updated_at" DESC NULLS LAST);


--
-- Name: ai_property_review_population_daily_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_review_population_daily_retention_idx" ON "public"."ai_property_review_population_daily" USING "btree" ("local_date");


--
-- Name: ai_property_trend_outcomes_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_trend_outcomes_expiry_idx" ON "public"."ai_property_trend_outcomes" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);


--
-- Name: ai_property_trend_outcomes_operation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_property_trend_outcomes_operation_unique" ON "public"."ai_property_trend_outcomes" USING "btree" ("operation_id") WHERE ("operation_id" IS NOT NULL);


--
-- Name: ai_property_trend_outcomes_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_trend_outcomes_property_idx" ON "public"."ai_property_trend_outcomes" USING "btree" ("organization_id", "property_id", "recorded_at" DESC NULLS LAST);


--
-- Name: ai_property_trend_schedules_generation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_property_trend_schedules_generation_unique" ON "public"."ai_property_trend_schedules" USING "btree" ("organization_id", "property_id", "due_local_date", "source_epoch", "review_analysis_epoch", "property_trends_epoch", "property_profile_version", "terminal_analysis_sequence", "aggregate_revision");


--
-- Name: ai_property_trend_schedules_outbox_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_property_trend_schedules_outbox_unique" ON "public"."ai_property_trend_schedules" USING "btree" ("outbox_event_id");


--
-- Name: ai_property_trend_schedules_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_property_trend_schedules_property_idx" ON "public"."ai_property_trend_schedules" USING "btree" ("organization_id", "property_id", "due_local_date" DESC NULLS LAST);


--
-- Name: ai_review_analyses_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_review_analyses_current_idx" ON "public"."ai_review_analyses" USING "btree" ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence");


--
-- Name: ai_review_analyses_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_review_analyses_expiry_idx" ON "public"."ai_review_analyses" USING "btree" ("expires_at");


--
-- Name: ai_review_analyses_operation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_review_analyses_operation_unique" ON "public"."ai_review_analyses" USING "btree" ("operation_id");


--
-- Name: ai_review_analysis_backlog_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_review_analysis_backlog_ready_idx" ON "public"."ai_review_analysis_backlog" USING "btree" ("property_id", "state", "next_attempt_at");


--
-- Name: ai_review_analysis_backlog_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_review_analysis_backlog_review_idx" ON "public"."ai_review_analysis_backlog" USING "btree" ("organization_id", "property_id", "review_id");


--
-- Name: ai_review_analysis_enrollments_actionable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_review_analysis_enrollments_actionable_idx" ON "public"."ai_review_analysis_enrollments" USING "btree" ("created_at", "id") WHERE (("state")::"text" = ANY ((ARRAY['queued'::character varying, 'running'::character varying])::"text"[]));


--
-- Name: ai_review_analysis_enrollments_fence_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_review_analysis_enrollments_fence_unique" ON "public"."ai_review_analysis_enrollments" USING "btree" ("organization_id", "property_id", "authorization_lineage_id", "authorization_state_version", "source_epoch", "review_analysis_epoch", "analysis_start_sequence");


--
-- Name: ai_review_analysis_enrollments_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_review_analysis_enrollments_one_active" ON "public"."ai_review_analysis_enrollments" USING "btree" ("organization_id", "property_id") WHERE (("state")::"text" = ANY ((ARRAY['awaiting_assisted_approval'::character varying, 'queued'::character varying, 'running'::character varying])::"text"[]));


--
-- Name: ai_review_analysis_enrollments_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_review_analysis_enrollments_property_idx" ON "public"."ai_review_analysis_enrollments" USING "btree" ("organization_id", "property_id", "created_at" DESC NULLS LAST);


--
-- Name: ai_review_analysis_enrollments_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_review_analysis_enrollments_scope_unique" ON "public"."ai_review_analysis_enrollments" USING "btree" ("id", "organization_id", "property_id");


--
-- Name: ai_review_analysis_enrollments_trigger_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_review_analysis_enrollments_trigger_unique" ON "public"."ai_review_analysis_enrollments" USING "btree" ("trigger_event_envelope_id");


--
-- Name: ai_review_analysis_mention_corrections_mention_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_review_analysis_mention_corrections_mention_unique" ON "public"."ai_review_analysis_mention_corrections" USING "btree" ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "mention_ordinal");


--
-- Name: ai_review_analysis_mentions_identity_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_review_analysis_mentions_identity_unique" ON "public"."ai_review_analysis_mentions" USING "btree" ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "topic", COALESCE("thing", ''::character varying), "polarity");


--
-- Name: audit_events_org_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_events_org_time_idx" ON "public"."audit_events" USING "btree" ("organization_id", "occurred_at", "id");


--
-- Name: audit_events_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_events_retention_idx" ON "public"."audit_events" USING "btree" ("occurred_at", "id");


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_created_at_idx" ON "public"."audit_logs" USING "btree" ("created_at");


--
-- Name: audit_logs_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_org_idx" ON "public"."audit_logs" USING "btree" ("organization_id");


--
-- Name: audit_logs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_user_idx" ON "public"."audit_logs" USING "btree" ("user_id");


--
-- Name: authorization_execution_permits_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "authorization_execution_permits_active_idx" ON "public"."authorization_execution_permits" USING "btree" ("capability", "state", "start_deadline_at", "operation_deadline_at");


--
-- Name: authorization_execution_permits_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "authorization_execution_permits_scope_idx" ON "public"."authorization_execution_permits" USING "btree" ("organization_id", "property_id", "connection_id");


--
-- Name: backup_erasure_ledger_lineage_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "backup_erasure_ledger_lineage_unique" ON "public"."backup_erasure_ledger" USING "btree" ("subject_class", "closure_lineage_id", "lifecycle_revision", "context");


--
-- Name: backup_erasure_ledger_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "backup_erasure_ledger_org_idx" ON "public"."backup_erasure_ledger" USING "btree" ("organization_id", "effective_erasure_at");


--
-- Name: backup_erasure_ledger_replay_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "backup_erasure_ledger_replay_idx" ON "public"."backup_erasure_ledger" USING "btree" ("effective_erasure_at");


--
-- Name: beta_feedback_masked_layout_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "beta_feedback_masked_layout_expiry_idx" ON "public"."beta_feedback_masked_layouts" USING "btree" ("expires_at");


--
-- Name: beta_feedback_triage_attachment_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "beta_feedback_triage_attachment_expiry_idx" ON "public"."beta_feedback_triage" USING "btree" ("attachment_expires_at");


--
-- Name: beta_feedback_triage_delivery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "beta_feedback_triage_delivery_idx" ON "public"."beta_feedback_triage" USING "btree" ("delivery_state", "created_at" DESC);


--
-- Name: beta_feedback_triage_provider_reference_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "beta_feedback_triage_provider_reference_unique" ON "public"."beta_feedback_triage" USING "btree" ("provider_reference");


--
-- Name: beta_feedback_triage_transition_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "beta_feedback_triage_transition_reference_idx" ON "public"."beta_feedback_triage_transitions" USING "btree" ("feedback_reference", "occurred_at" DESC);


--
-- Name: beta_feedback_triage_transition_revision_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "beta_feedback_triage_transition_revision_unique" ON "public"."beta_feedback_triage_transitions" USING "btree" ("feedback_reference", "result_revision");


--
-- Name: beta_feedback_triage_work_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "beta_feedback_triage_work_queue_idx" ON "public"."beta_feedback_triage" USING "btree" ("owner_queue", "triage_state", "updated_at" DESC);


--
-- Name: email_queue_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "email_queue_due_idx" ON "public"."notification_email_queue" USING "btree" ("status", "cadence", "not_before", "next_attempt_at");


--
-- Name: email_queue_id_tenant_recipient_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "email_queue_id_tenant_recipient_unique" ON "public"."notification_email_queue" USING "btree" ("id", "organization_id", "user_id");


--
-- Name: email_queue_non_mandatory_notification_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "email_queue_non_mandatory_notification_unique" ON "public"."notification_email_queue" USING "btree" ("notification_id") WHERE (("category")::"text" <> 'mandatory'::"text");


--
-- Name: email_queue_organization_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "email_queue_organization_idempotency_unique" ON "public"."notification_email_queue" USING "btree" ("organization_id", "idempotency_key") WHERE ("property_id" IS NULL);


--
-- Name: email_queue_property_digest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "email_queue_property_digest_idx" ON "public"."notification_email_queue" USING "btree" ("organization_id", "property_id", "status", "cadence");


--
-- Name: email_queue_property_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "email_queue_property_idempotency_unique" ON "public"."notification_email_queue" USING "btree" ("organization_id", "property_id", "idempotency_key") WHERE ("property_id" IS NOT NULL);


--
-- Name: feedback_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "feedback_portal_idx" ON "public"."feedback" USING "btree" ("portal_id");


--
-- Name: feedback_session_portal_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "feedback_session_portal_unique" ON "public"."feedback" USING "btree" ("session_id", "portal_id");


--
-- Name: goal_month_target_changes_program_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "goal_month_target_changes_program_idx" ON "public"."goal_month_target_changes" USING "btree" ("organization_id", "property_id", "program_id", "created_at");


--
-- Name: goal_monthly_results_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "goal_monthly_results_due_idx" ON "public"."goal_monthly_results" USING "btree" ("status", "period_end", "organization_id", "property_id");


--
-- Name: goal_monthly_results_target_change_fk_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "goal_monthly_results_target_change_fk_key" ON "public"."goal_monthly_results" USING "btree" ("organization_id", "property_id", "program_id", "id");


--
-- Name: goal_program_versions_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "goal_program_versions_effective_idx" ON "public"."goal_program_versions" USING "btree" ("organization_id", "property_id", "program_id", "effective_from");


--
-- Name: goal_program_versions_target_change_fk_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "goal_program_versions_target_change_fk_key" ON "public"."goal_program_versions" USING "btree" ("organization_id", "property_id", "program_id", "id");


--
-- Name: goal_programs_property_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "goal_programs_property_status_idx" ON "public"."goal_programs" USING "btree" ("organization_id", "property_id", "status");


--
-- Name: goal_result_revisions_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "goal_result_revisions_history_idx" ON "public"."goal_result_revisions" USING "btree" ("organization_id", "property_id", "monthly_result_id", "revision");


--
-- Name: goal_subject_assignments_program_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "goal_subject_assignments_program_idx" ON "public"."goal_subject_assignments" USING "btree" ("organization_id", "property_id", "program_id", "effective_from");


--
-- Name: goal_subject_assignments_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "goal_subject_assignments_subject_idx" ON "public"."goal_subject_assignments" USING "btree" ("organization_id", "property_id", "subject_kind", "property_subject_id", "portal_group_id", "portal_id");


--
-- Name: google_connections_google_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "google_connections_google_subject_idx" ON "public"."google_connections" USING "btree" ("google_subject") WHERE ("google_subject" IS NOT NULL);


--
-- Name: google_connections_org_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "google_connections_org_id_key" ON "public"."google_connections" USING "btree" ("organization_id", "id");


--
-- Name: google_connections_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_connections_status_idx" ON "public"."google_connections" USING "btree" ("status") WHERE ("status" <> ALL (ARRAY['active'::"public"."connection_status", 'disconnected'::"public"."connection_status"]));


--
-- Name: google_import_discovery_records_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_discovery_records_expiry_idx" ON "public"."google_import_discovery_records" USING "btree" ("expires_at", "reference_key");


--
-- Name: google_import_discovery_records_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_discovery_records_property_idx" ON "public"."google_import_discovery_records" USING "btree" ("organization_id", "affected_property_id") WHERE ("affected_property_id" IS NOT NULL);


--
-- Name: google_import_discovery_records_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_discovery_records_scope_idx" ON "public"."google_import_discovery_records" USING "btree" ("organization_id", "user_id", "connection_id");


--
-- Name: google_import_items_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_items_connection_idx" ON "public"."google_import_items" USING "btree" ("organization_id", "connection_id");


--
-- Name: google_import_items_destination_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_items_destination_idx" ON "public"."google_import_items" USING "btree" ("organization_id", "destination_property_id", "created_at", "id");


--
-- Name: google_import_items_dispatch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_items_dispatch_idx" ON "public"."google_import_items" USING "btree" ("next_dispatch_at", "id");


--
-- Name: google_import_items_existing_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_items_existing_property_idx" ON "public"."google_import_items" USING "btree" ("organization_id", "existing_property_id");


--
-- Name: google_import_items_expired_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_items_expired_idx" ON "public"."google_import_items" USING "btree" ("status", "effect_deadline_at", "id");


--
-- Name: google_import_items_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_import_items_parent_idx" ON "public"."google_import_items" USING "btree" ("organization_id", "import_id", "created_at", "id");


--
-- Name: google_imports_purge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_imports_purge_idx" ON "public"."google_imports" USING "btree" ("purge_at", "id");


--
-- Name: google_reply_observation_heads_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_reply_observation_heads_scope_idx" ON "public"."google_reply_observation_heads" USING "btree" ("organization_id", "property_id", "state");


--
-- Name: google_reply_observations_confirmation_binding_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "google_reply_observations_confirmation_binding_unique" ON "public"."google_reply_observations" USING "btree" ("organization_id", "property_id", "review_id", "observation_revision", "matched_reply_id", "matched_publication_cycle", "matched_attempt_number", "source_epoch", "material_review_revision");


--
-- Name: google_reply_observations_head_binding_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "google_reply_observations_head_binding_unique" ON "public"."google_reply_observations" USING "btree" ("organization_id", "property_id", "review_id", "id", "observation_revision", "source_epoch", "material_review_revision", "state", "provenance");


--
-- Name: google_reply_observations_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "google_reply_observations_idempotency_key" ON "public"."google_reply_observations" USING "btree" ("organization_id", "review_id", "observation_key");


--
-- Name: google_reply_observations_revision_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "google_reply_observations_revision_key" ON "public"."google_reply_observations" USING "btree" ("organization_id", "property_id", "review_id", "observation_revision");


--
-- Name: google_reply_observations_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "google_reply_observations_scope_idx" ON "public"."google_reply_observations" USING "btree" ("organization_id", "property_id", "review_id", "observation_revision");


--
-- Name: guest_contact_requests_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_contact_requests_expiry_idx" ON "public"."guest_contact_requests" USING "btree" ("status", "expires_at", "id");


--
-- Name: guest_contact_requests_org_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_contact_requests_org_id_key" ON "public"."guest_contact_requests" USING "btree" ("organization_id", "id");


--
-- Name: guest_contact_requests_response_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_contact_requests_response_key" ON "public"."guest_contact_requests" USING "btree" ("organization_id", "response_id");


--
-- Name: guest_contact_requests_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_contact_requests_scope_id_key" ON "public"."guest_contact_requests" USING "btree" ("organization_id", "property_id", "portal_id", "id");


--
-- Name: guest_contact_reveal_audits_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_contact_reveal_audits_request_idx" ON "public"."guest_contact_request_reveal_audits" USING "btree" ("organization_id", "contact_request_id", "revealed_at");


--
-- Name: guest_network_pressure_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_network_pressure_expiry_idx" ON "public"."guest_network_pressure_records" USING "btree" ("expires_at");


--
-- Name: guest_network_pressure_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_network_pressure_lookup_idx" ON "public"."guest_network_pressure_records" USING "btree" ("organization_id", "property_id", "portal_id", "pseudonym", "action", "observed_at");


--
-- Name: guest_qualified_scans_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_qualified_scans_occurred_at_idx" ON "public"."guest_qualified_scans" USING "btree" ("occurred_at");


--
-- Name: guest_qualified_scans_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_qualified_scans_scope_id_key" ON "public"."guest_qualified_scans" USING "btree" ("organization_id", "property_id", "portal_id", "id");


--
-- Name: guest_qualified_scans_scope_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_qualified_scans_scope_time_idx" ON "public"."guest_qualified_scans" USING "btree" ("organization_id", "property_id", "portal_id", "occurred_at");


--
-- Name: guest_qualified_scans_source_event_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_qualified_scans_source_event_key" ON "public"."guest_qualified_scans" USING "btree" ("source_event_id");


--
-- Name: guest_response_experience_snapshots_org_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_response_experience_snapshots_org_key" ON "public"."guest_response_experience_snapshots" USING "btree" ("organization_id", "response_id");


--
-- Name: guest_response_integrity_decisions_response_revision_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_response_integrity_decisions_response_revision_key" ON "public"."guest_response_integrity_decisions" USING "btree" ("response_id", "revision");


--
-- Name: guest_response_integrity_decisions_scope_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_response_integrity_decisions_scope_outcome_idx" ON "public"."guest_response_integrity_decisions" USING "btree" ("organization_id", "property_id", "portal_id", "outcome", "decided_at");


--
-- Name: guest_response_private_feedback_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_response_private_feedback_expiry_idx" ON "public"."guest_response_private_feedback" USING "btree" ("expires_at");


--
-- Name: guest_response_session_bindings_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_response_session_bindings_dedupe" ON "public"."guest_response_session_bindings" USING "btree" ("organization_id", "portal_id", "session_id");


--
-- Name: guest_response_session_bindings_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_response_session_bindings_expiry_idx" ON "public"."guest_response_session_bindings" USING "btree" ("expires_at");


--
-- Name: guest_responses_org_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_responses_org_id_key" ON "public"."guest_responses" USING "btree" ("organization_id", "id");


--
-- Name: guest_responses_portal_integrity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_responses_portal_integrity_idx" ON "public"."guest_responses" USING "btree" ("organization_id", "property_id", "portal_id", "integrity_outcome");


--
-- Name: guest_responses_portal_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_responses_portal_status_idx" ON "public"."guest_responses" USING "btree" ("organization_id", "property_id", "portal_id", "status");


--
-- Name: guest_responses_retention_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guest_responses_retention_deadline_idx" ON "public"."guest_responses" USING "btree" ("retention_deadline");


--
-- Name: guest_responses_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "guest_responses_scope_id_key" ON "public"."guest_responses" USING "btree" ("organization_id", "property_id", "portal_id", "id");


--
-- Name: idempotency_receipts_recorded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idempotency_receipts_recorded_at_idx" ON "public"."idempotency_receipts" USING "btree" ("recorded_at", "scope", "key");


--
-- Name: inbox_assignment_history_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_assignment_history_assignee_idx" ON "public"."inbox_assignment_history" USING "btree" ("organization_id", "next_assignee", "occurred_at");


--
-- Name: inbox_assignment_history_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_assignment_history_scope_idx" ON "public"."inbox_assignment_history" USING "btree" ("organization_id", "property_id", "occurred_at", "inbox_item_id");


--
-- Name: inbox_escalation_history_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_escalation_history_item_idx" ON "public"."inbox_escalation_history" USING "btree" ("inbox_item_id", "occurred_at");


--
-- Name: inbox_escalation_history_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_escalation_history_scope_idx" ON "public"."inbox_escalation_history" USING "btree" ("organization_id", "property_id", "occurred_at", "inbox_item_id");


--
-- Name: inbox_feedback_handling_outcomes_chain_target_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_chain_target_unique" ON "public"."inbox_feedback_handling_outcomes" USING "btree" ("inbox_item_id", "cycle_number", "id", "outcome_revision");


--
-- Name: inbox_feedback_handling_outcomes_command_revision_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_command_revision_unique" ON "public"."inbox_feedback_handling_outcomes" USING "btree" ("inbox_item_id", "resulting_command_revision");


--
-- Name: inbox_feedback_handling_outcomes_cycle_revision_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_cycle_revision_unique" ON "public"."inbox_feedback_handling_outcomes" USING "btree" ("inbox_item_id", "cycle_number", "outcome_revision");


--
-- Name: inbox_feedback_handling_outcomes_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_feedback_handling_outcomes_scope_idx" ON "public"."inbox_feedback_handling_outcomes" USING "btree" ("organization_id", "property_id", "inbox_item_id", "cycle_number", "outcome_revision");


--
-- Name: inbox_handling_cycle_heads_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_handling_cycle_heads_scope_idx" ON "public"."inbox_handling_cycle_heads" USING "btree" ("organization_id", "property_id", "status");


--
-- Name: inbox_handling_cycle_response_targets_active_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_handling_cycle_response_targets_active_due_idx" ON "public"."inbox_handling_cycle_response_targets" USING "btree" ("organization_id", "target_kind", "due_at", "inbox_item_id") WHERE (("completion_at" IS NULL) AND (("performance_eligibility")::"text" = 'measured'::"text"));


--
-- Name: inbox_handling_cycle_response_targets_property_result_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_handling_cycle_response_targets_property_result_idx" ON "public"."inbox_handling_cycle_response_targets" USING "btree" ("organization_id", "property_id", "target_kind", "result", "start_at");


--
-- Name: inbox_handling_cycle_response_targets_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_handling_cycle_response_targets_scope_unique" ON "public"."inbox_handling_cycle_response_targets" USING "btree" ("inbox_item_id", "cycle_number", "organization_id", "property_id", "target_kind");


--
-- Name: inbox_handling_cycle_transitions_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_handling_cycle_transitions_scope_idx" ON "public"."inbox_handling_cycle_transitions" USING "btree" ("organization_id", "property_id", "inbox_item_id", "state_revision");


--
-- Name: inbox_handling_cycle_transitions_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_handling_cycle_transitions_source_idx" ON "public"."inbox_handling_cycle_transitions" USING "btree" ("source_type", "source_id", "source_revision");


--
-- Name: inbox_handling_cycles_outcome_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_handling_cycles_outcome_scope_unique" ON "public"."inbox_handling_cycles" USING "btree" ("inbox_item_id", "cycle_number", "organization_id", "property_id", "source_type", "source_id", "source_revision");


--
-- Name: inbox_handling_cycles_review_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_handling_cycles_review_revision_idx" ON "public"."inbox_handling_cycles" USING "btree" ("review_id", "material_review_revision", "cycle_number");


--
-- Name: inbox_handling_cycles_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_handling_cycles_scope_idx" ON "public"."inbox_handling_cycles" USING "btree" ("organization_id", "property_id", "inbox_item_id", "cycle_number");


--
-- Name: inbox_handling_cycles_source_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_handling_cycles_source_revision_idx" ON "public"."inbox_handling_cycles" USING "btree" ("source_type", "source_id", "source_revision", "cycle_number");


--
-- Name: inbox_items_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_items_created_at_idx" ON "public"."inbox_items" USING "btree" ("created_at", "id");


--
-- Name: inbox_items_cycle_source_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_items_cycle_source_scope_unique" ON "public"."inbox_items" USING "btree" ("id", "organization_id", "source_type", "source_id");


--
-- Name: inbox_items_org_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_items_org_assigned_to_idx" ON "public"."inbox_items" USING "btree" ("organization_id", "assigned_to");


--
-- Name: inbox_items_org_escalated_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_items_org_escalated_active_idx" ON "public"."inbox_items" USING "btree" ("organization_id", "is_escalated", "escalation_resolved_at");


--
-- Name: inbox_items_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_items_org_property_idx" ON "public"."inbox_items" USING "btree" ("organization_id", "property_id");


--
-- Name: inbox_items_org_property_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_items_org_property_status_idx" ON "public"."inbox_items" USING "btree" ("organization_id", "property_id", "status");


--
-- Name: inbox_items_org_source_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_items_org_source_date_idx" ON "public"."inbox_items" USING "btree" ("organization_id", "source_date" DESC NULLS LAST, "id" DESC NULLS LAST);


--
-- Name: inbox_items_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_items_org_status_idx" ON "public"."inbox_items" USING "btree" ("organization_id", "status");


--
-- Name: inbox_items_source_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_items_source_date_idx" ON "public"."inbox_items" USING "btree" ("source_date");


--
-- Name: inbox_items_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_items_source_unique" ON "public"."inbox_items" USING "btree" ("source_type", "source_id", "organization_id");


--
-- Name: inbox_notes_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_notes_item_idx" ON "public"."inbox_notes" USING "btree" ("inbox_item_id");


--
-- Name: inbox_priority_history_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_priority_history_item_idx" ON "public"."inbox_priority_history" USING "btree" ("inbox_item_id", "occurred_at");


--
-- Name: inbox_priority_history_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_priority_history_scope_idx" ON "public"."inbox_priority_history" USING "btree" ("organization_id", "property_id", "occurred_at", "inbox_item_id");


--
-- Name: inbox_response_target_reminders_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "inbox_response_target_reminders_due_idx" ON "public"."inbox_response_target_reminders" USING "btree" ("scheduled_for", "inbox_item_id", "cycle_number", "reminder_kind") WHERE (("delivered_at" IS NULL) AND ("cancelled_at" IS NULL));


--
-- Name: inbox_response_target_reminders_event_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_response_target_reminders_event_unique" ON "public"."inbox_response_target_reminders" USING "btree" ("event_id");


--
-- Name: inbox_user_views_org_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "inbox_user_views_org_user_unique" ON "public"."inbox_user_views" USING "btree" ("organization_id", "user_id");


--
-- Name: invitation_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "invitation_email_idx" ON "public"."invitation" USING "btree" ("email");


--
-- Name: invitation_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "invitation_organizationId_idx" ON "public"."invitation" USING "btree" ("organizationId");


--
-- Name: material_review_revisions_exact_binding_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "material_review_revisions_exact_binding_unique" ON "public"."material_review_revisions" USING "btree" ("organization_id", "property_id", "review_id", "source_epoch", "revision");


--
-- Name: material_review_revisions_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "material_review_revisions_scope_idx" ON "public"."material_review_revisions" USING "btree" ("organization_id", "property_id", "review_id", "revision");


--
-- Name: member_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "member_organizationId_idx" ON "public"."member" USING "btree" ("organizationId");


--
-- Name: member_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "member_userId_idx" ON "public"."member" USING "btree" ("userId");


--
-- Name: merchant_ai_consent_evidence_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "merchant_ai_consent_evidence_idempotency_unique" ON "public"."merchant_ai_consent_evidence" USING "btree" ("organization_id", "idempotency_key");


--
-- Name: merchant_ai_consent_evidence_property_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "merchant_ai_consent_evidence_property_version_idx" ON "public"."merchant_ai_consent_evidence" USING "btree" ("organization_id", "property_id", "state_version");


--
-- Name: merchant_ai_consent_evidence_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "merchant_ai_consent_evidence_scope_unique" ON "public"."merchant_ai_consent_evidence" USING "btree" ("authorization_lineage_id", "state_version", "organization_id", "property_id");


--
-- Name: merchant_ai_consent_evidence_standing_update_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "merchant_ai_consent_evidence_standing_update_idx" ON "public"."merchant_ai_consent_evidence" USING "btree" ("organization_id", "notice_version", "notice_digest", "occurred_at" DESC) WHERE (("reason_code")::"text" = 'standing_renewal'::"text");


--
-- Name: merchant_ai_decision_deferrals_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "merchant_ai_decision_deferrals_org_idx" ON "public"."merchant_ai_decision_deferrals" USING "btree" ("organization_id");


--
-- Name: merchant_ai_enablement_enabled_notice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "merchant_ai_enablement_enabled_notice_idx" ON "public"."merchant_ai_enablement" USING "btree" ("notice_version", "notice_digest") WHERE ("state" = 'enabled'::"text");


--
-- Name: merchant_ai_enablement_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "merchant_ai_enablement_org_idx" ON "public"."merchant_ai_enablement" USING "btree" ("organization_id", "updated_at" DESC NULLS LAST);


--
-- Name: merchant_ai_notice_update_receipts_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "merchant_ai_notice_update_receipts_org_idx" ON "public"."merchant_ai_notice_update_receipts" USING "btree" ("organization_id");


--
-- Name: metric_corrections_reading_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_corrections_reading_idx" ON "public"."metric_corrections" USING "btree" ("reading_id", "recorded_at");


--
-- Name: metric_corrections_root_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "metric_corrections_root_unique" ON "public"."metric_corrections" USING "btree" ("reading_id") WHERE ("supersedes_correction_id" IS NULL);


--
-- Name: metric_corrections_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "metric_corrections_source_unique" ON "public"."metric_corrections" USING "btree" ("source_event_id");


--
-- Name: metric_corrections_supersedes_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "metric_corrections_supersedes_unique" ON "public"."metric_corrections" USING "btree" ("supersedes_correction_id") WHERE ("supersedes_correction_id" IS NOT NULL);


--
-- Name: metric_current_google_reputation_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_current_google_reputation_scope_idx" ON "public"."metric_current_google_reputation_snapshots" USING "btree" ("organization_id", "property_id");


--
-- Name: metric_current_google_reputation_source_event_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "metric_current_google_reputation_source_event_unique" ON "public"."metric_current_google_reputation_snapshots" USING "btree" ("source_event_id");


--
-- Name: metric_current_google_reputation_source_run_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "metric_current_google_reputation_source_run_unique" ON "public"."metric_current_google_reputation_snapshots" USING "btree" ("source_run_id");


--
-- Name: metric_readings_group_only_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_group_only_idx" ON "public"."metric_readings" USING "btree" ("group_id");


--
-- Name: metric_readings_org_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_org_group_idx" ON "public"."metric_readings" USING "btree" ("organization_id", "group_id");


--
-- Name: metric_readings_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_org_idx" ON "public"."metric_readings" USING "btree" ("organization_id");


--
-- Name: metric_readings_org_key_recorded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_org_key_recorded_idx" ON "public"."metric_readings" USING "btree" ("organization_id", "metric_key", "recorded_at");


--
-- Name: metric_readings_org_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_org_portal_idx" ON "public"."metric_readings" USING "btree" ("organization_id", "portal_id");


--
-- Name: metric_readings_org_prop_recorded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_org_prop_recorded_idx" ON "public"."metric_readings" USING "btree" ("organization_id", "property_id", "recorded_at");


--
-- Name: metric_readings_org_prop_version_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_org_prop_version_event_idx" ON "public"."metric_readings" USING "btree" ("organization_id", "property_id", "definition_version_id", "event_at");


--
-- Name: metric_readings_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_org_property_idx" ON "public"."metric_readings" USING "btree" ("organization_id", "property_id");


--
-- Name: metric_readings_portal_only_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_portal_only_idx" ON "public"."metric_readings" USING "btree" ("portal_id");


--
-- Name: metric_readings_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_property_idx" ON "public"."metric_readings" USING "btree" ("property_id");


--
-- Name: metric_readings_recorded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_recorded_at_idx" ON "public"."metric_readings" USING "btree" ("recorded_at");


--
-- Name: metric_readings_version_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "metric_readings_version_event_idx" ON "public"."metric_readings" USING "btree" ("definition_version_id", "event_at");


--
-- Name: metric_readings_version_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "metric_readings_version_source_unique" ON "public"."metric_readings" USING "btree" ("definition_version_id", "source_event_id") WHERE (("definition_version_id" IS NOT NULL) AND ("source_event_id" IS NOT NULL));


--
-- Name: notification_category_defaults_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_category_defaults_scope_unique" ON "public"."notification_category_defaults" USING "btree" ("user_id", "organization_id", "category", "channel");


--
-- Name: notification_digest_batch_members_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_digest_batch_members_email_unique" ON "public"."notification_digest_batch_members" USING "btree" ("notification_email_id");


--
-- Name: notification_digest_batch_members_order_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_digest_batch_members_order_unique" ON "public"."notification_digest_batch_members" USING "btree" ("batch_id", "sort_index");


--
-- Name: notification_digest_batches_id_tenant_recipient_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_digest_batches_id_tenant_recipient_unique" ON "public"."notification_digest_batches" USING "btree" ("id", "organization_id", "user_id");


--
-- Name: notification_digest_batches_open_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_digest_batches_open_unique" ON "public"."notification_digest_batches" USING "btree" ("organization_id", "user_id") WHERE (("state")::"text" = ANY ((ARRAY['prepared'::character varying, 'retryable'::character varying])::"text"[]));


--
-- Name: notification_digest_batches_provider_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_digest_batches_provider_key_unique" ON "public"."notification_digest_batches" USING "btree" ("provider_idempotency_key");


--
-- Name: notification_digest_batches_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_digest_batches_retention_idx" ON "public"."notification_digest_batches" USING "btree" ("state", "updated_at");


--
-- Name: notification_digest_batches_sequence_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_digest_batches_sequence_unique" ON "public"."notification_digest_batches" USING "btree" ("organization_id", "user_id", "local_date", "sequence");


--
-- Name: notification_email_queue_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_email_queue_created_at_idx" ON "public"."notification_email_queue" USING "btree" ("created_at");


--
-- Name: notification_email_queue_immediate_acceptance_health_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_email_queue_immediate_acceptance_health_idx" ON "public"."notification_email_queue" USING "btree" ("created_at" DESC NULLS LAST, "id") WHERE ((("cadence")::"text" = 'immediate'::"text") AND ("not_before" IS NULL));


--
-- Name: notification_preferences_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_preferences_org_property_idx" ON "public"."notification_preferences" USING "btree" ("organization_id", "property_id");


--
-- Name: notification_prefs_default_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_prefs_default_scope_unique" ON "public"."notification_preferences" USING "btree" ("user_id", "organization_id", "category", "channel") WHERE ("property_id" IS NULL);


--
-- Name: notification_prefs_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_prefs_scope_unique" ON "public"."notification_preferences" USING "btree" ("user_id", "organization_id", "property_id", "category", "channel");


--
-- Name: notification_property_delivery_windows_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_property_delivery_windows_org_property_idx" ON "public"."notification_property_delivery_windows" USING "btree" ("organization_id", "property_id");


--
-- Name: notification_property_delivery_windows_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_property_delivery_windows_scope_unique" ON "public"."notification_property_delivery_windows" USING "btree" ("user_id", "organization_id", "property_id");


--
-- Name: notification_unsubscribe_scopes_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_unsubscribe_scopes_organization_idx" ON "public"."notification_unsubscribe_scopes" USING "btree" ("organization_id");


--
-- Name: notification_unsubscribe_scopes_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notification_unsubscribe_scopes_retention_idx" ON "public"."notification_unsubscribe_scopes" USING "btree" ("created_at");


--
-- Name: notification_user_settings_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notification_user_settings_scope_unique" ON "public"."notification_user_settings" USING "btree" ("user_id", "organization_id");


--
-- Name: notifications_coalesced_latest_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_coalesced_latest_at_idx" ON "public"."notifications" USING "btree" ("coalesced_latest_at") WHERE ("coalesced_latest_at" IS NOT NULL);


--
-- Name: notifications_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_created_at_idx" ON "public"."notifications" USING "btree" ("created_at");


--
-- Name: notifications_feed_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_feed_activity_idx" ON "public"."notifications" USING "btree" ("user_id", "organization_id", COALESCE("coalesced_latest_at", "created_at") DESC, "id" DESC) WHERE (("status")::"text" <> 'dismissed'::"text");


--
-- Name: notifications_inbox_item_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_inbox_item_resource_idx" ON "public"."notifications" USING "btree" ("resource_id") WHERE (("resource_type")::"text" = 'inbox_item'::"text");


--
-- Name: notifications_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_org_idx" ON "public"."notifications" USING "btree" ("organization_id", "created_at");


--
-- Name: notifications_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_org_property_idx" ON "public"."notifications" USING "btree" ("organization_id", "property_id");


--
-- Name: notifications_unread_resource_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "notifications_unread_resource_unique" ON "public"."notifications" USING "btree" ("user_id", "type", "resource_id") WHERE ((("status")::"text" = 'unread'::"text") AND ("resolved_at" IS NULL));


--
-- Name: notifications_unresolved_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_unresolved_resource_idx" ON "public"."notifications" USING "btree" ("organization_id", "resource_id", "type") WHERE ((("status")::"text" = 'unread'::"text") AND ("resolved_at" IS NULL));


--
-- Name: notifications_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_user_status_idx" ON "public"."notifications" USING "btree" ("user_id", "status", "created_at");


--
-- Name: operational_action_history_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "operational_action_history_actor_idx" ON "public"."operational_action_history_records" USING "btree" ("organization_id", "actor_id", "occurred_at");


--
-- Name: operational_action_history_hold_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "operational_action_history_hold_org_idx" ON "public"."operational_action_history_legal_holds" USING "btree" ("organization_id", "released_at", "protects_from");


--
-- Name: operational_action_history_org_sequence_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "operational_action_history_org_sequence_uniq" ON "public"."operational_action_history_records" USING "btree" ("organization_id", "sequence");


--
-- Name: operational_action_history_org_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "operational_action_history_org_time_idx" ON "public"."operational_action_history_records" USING "btree" ("organization_id", "occurred_at" DESC NULLS LAST, "sequence" DESC NULLS LAST);


--
-- Name: operational_action_history_provenance_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "operational_action_history_provenance_uniq" ON "public"."operational_action_history_records" USING "btree" ("organization_id", "provenance_kind", "provenance_id");


--
-- Name: operational_action_history_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "operational_action_history_resource_idx" ON "public"."operational_action_history_records" USING "btree" ("organization_id", "resource_type", "resource_id", "occurred_at");


--
-- Name: organizationRole_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organizationRole_organizationId_idx" ON "public"."organizationRole" USING "btree" ("organizationId");


--
-- Name: organizationRole_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organizationRole_role_idx" ON "public"."organizationRole" USING "btree" ("role");


--
-- Name: organization_export_retrieval_issuances_digest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_export_retrieval_issuances_digest_idx" ON "public"."organization_export_retrieval_issuances" USING "btree" ("export_id", "token_digest");


--
-- Name: organization_export_retrieval_issuances_operation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_export_retrieval_issuances_operation_idx" ON "public"."organization_export_retrieval_issuances" USING "btree" ("export_id", "operation_id");


--
-- Name: organization_export_retrieval_issuances_org_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organization_export_retrieval_issuances_org_time_idx" ON "public"."organization_export_retrieval_issuances" USING "btree" ("organization_id", "issued_at" DESC);


--
-- Name: organization_exports_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organization_exports_expiry_idx" ON "public"."organization_exports" USING "btree" ("state", "object_expires_at");


--
-- Name: organization_exports_generation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organization_exports_generation_idx" ON "public"."organization_exports" USING "btree" ("state", "generation_lease_expires_at", "created_at");


--
-- Name: organization_exports_one_open_per_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_exports_one_open_per_org_idx" ON "public"."organization_exports" USING "btree" ("organization_id") WHERE ("state" = ANY (ARRAY['requested'::"text", 'generating'::"text", 'egress_pending'::"text", 'ready'::"text", 'retrieval_issued'::"text"]));


--
-- Name: organization_exports_pre_egress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organization_exports_pre_egress_idx" ON "public"."organization_exports" USING "btree" ("state", "pre_egress_recorded_at");


--
-- Name: organization_lifecycle_events_idempotency_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_lifecycle_events_idempotency_unique" ON "public"."organization_lifecycle_events" USING "btree" ("context", "phase", "kind");


--
-- Name: organization_lifecycle_events_org_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organization_lifecycle_events_org_time_idx" ON "public"."organization_lifecycle_events" USING "btree" ("organization_id", "recorded_at" DESC);


--
-- Name: organization_lifecycle_state_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organization_lifecycle_state_deadline_idx" ON "public"."organization_lifecycle_authority" USING "btree" ("state", "recoverable_until");


--
-- Name: organization_lifecycle_transition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organization_lifecycle_transition_idx" ON "public"."organization_lifecycle_authority" USING "btree" ("last_transition_at" DESC);


--
-- Name: organization_role_org_role_lower_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_role_org_role_lower_unique" ON "public"."organizationRole" USING "btree" ("organizationId", "lower"("role"));


--
-- Name: organization_role_policy_org_role_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_role_policy_org_role_unique" ON "public"."organization_role_policy" USING "btree" ("organization_id", "role");


--
-- Name: outbox_events_consumer_redelivery_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_events_consumer_redelivery_due_idx" ON "public"."outbox_events" USING "btree" ("consumer_redelivery_next_at", "published_at") WHERE (("published_at" IS NOT NULL) AND ("recovery_fenced_at" IS NULL));


--
-- Name: outbox_events_inbox_item_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_events_inbox_item_created_idx" ON "public"."outbox_events" USING "btree" ("source_aggregate_id") WHERE ("event_type" = 'inbox.inbox_item.created'::"text");


--
-- Name: outbox_events_lease_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_events_lease_expires_idx" ON "public"."outbox_events" USING "btree" ("lease_expires_at") WHERE (("published_at" IS NULL) AND ("lease_expires_at" IS NOT NULL) AND ("recovery_fenced_at" IS NULL));


--
-- Name: outbox_events_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_events_org_created_idx" ON "public"."outbox_events" USING "btree" ("organization_id", "created_at" DESC NULLS LAST);


--
-- Name: outbox_events_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_events_published_at_idx" ON "public"."outbox_events" USING "btree" ("published_at");


--
-- Name: outbox_events_recovery_fence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_events_recovery_fence_idx" ON "public"."outbox_events" USING "btree" ("recovery_fence_run_id", "created_at") WHERE ("recovery_fenced_at" IS NOT NULL);


--
-- Name: outbox_events_unpublished_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_events_unpublished_idx" ON "public"."outbox_events" USING "btree" ("created_at") WHERE (("published_at" IS NULL) AND ("lease_expires_at" IS NULL) AND ("recovery_fenced_at" IS NULL));


--
-- Name: pag_org_prop_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "pag_org_prop_user_idx" ON "public"."property_access_grants" USING "btree" ("organization_id", "property_id", "user_id");


--
-- Name: pag_unique_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pag_unique_active" ON "public"."property_access_grants" USING "btree" ("organization_id", "property_id", "user_id", "kind") WHERE ("status" = 'active'::"public"."grant_status");


--
-- Name: pgm_org_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "pgm_org_portal_idx" ON "public"."portal_group_memberships" USING "btree" ("organization_id", "portal_id");


--
-- Name: pgm_unique_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pgm_unique_active" ON "public"."portal_group_memberships" USING "btree" ("organization_id", "portal_id") WHERE ("effective_to" IS NULL);


--
-- Name: policy_consent_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "policy_consent_active_unique" ON "public"."policy_consent" USING "btree" ("organization_id", "subject_type", "subject_id", "purpose") WHERE ("state" = 'granted'::"text");


--
-- Name: portal_access_artifacts_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_access_artifacts_portal_idx" ON "public"."portal_access_artifacts" USING "btree" ("organization_id", "property_id", "portal_id");


--
-- Name: portal_access_artifacts_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_access_artifacts_scope_id_key" ON "public"."portal_access_artifacts" USING "btree" ("organization_id", "property_id", "portal_id", "id");


--
-- Name: portal_access_artifacts_token_channel_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_access_artifacts_token_channel_key" ON "public"."portal_access_artifacts" USING "btree" ("portal_token_id", "channel") WHERE (("status")::"text" = 'published'::"text");


--
-- Name: portal_address_downloads_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_address_downloads_portal_idx" ON "public"."portal_address_downloads" USING "btree" ("organization_id", "portal_id", "downloaded_at");


--
-- Name: portal_approved_destinations_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_approved_destinations_scope_id_key" ON "public"."portal_approved_destinations" USING "btree" ("organization_id", "property_id", "id");


--
-- Name: portal_approved_destinations_uri_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_approved_destinations_uri_unique" ON "public"."portal_approved_destinations" USING "btree" ("organization_id", "property_id", "normalized_uri");


--
-- Name: portal_goal_prompt_deferrals_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_goal_prompt_deferrals_org_idx" ON "public"."portal_goal_prompt_deferrals" USING "btree" ("organization_id");


--
-- Name: portal_group_history_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_group_history_group_idx" ON "public"."portal_group_history" USING "btree" ("organization_id", "portal_group_id", "occurred_at");


--
-- Name: portal_group_members_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_group_members_group_idx" ON "public"."portal_group_members" USING "btree" ("portal_group_id");


--
-- Name: portal_group_members_portal_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_group_members_portal_id_unique" ON "public"."portal_group_members" USING "btree" ("portal_id");


--
-- Name: portal_groups_org_property_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_groups_org_property_id_key" ON "public"."portal_groups" USING "btree" ("organization_id", "property_id", "id");


--
-- Name: portal_groups_org_property_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_groups_org_property_name_unique" ON "public"."portal_groups" USING "btree" ("organization_id", "property_id", "name") WHERE ("deleted_at" IS NULL);


--
-- Name: portal_health_intervals_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_health_intervals_history_idx" ON "public"."portal_health_intervals" USING "btree" ("organization_id", "property_id", "portal_id", "effective_from");


--
-- Name: portal_health_intervals_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_health_intervals_one_current" ON "public"."portal_health_intervals" USING "btree" ("organization_id", "portal_id") WHERE ("effective_to" IS NULL);


--
-- Name: portal_link_categories_org_portal_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_link_categories_org_portal_id_key" ON "public"."portal_link_categories" USING "btree" ("organization_id", "portal_id", "id");


--
-- Name: portal_link_categories_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_link_categories_portal_idx" ON "public"."portal_link_categories" USING "btree" ("portal_id");


--
-- Name: portal_link_texts_link_locale_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_link_texts_link_locale_unique" ON "public"."portal_link_texts" USING "btree" ("organization_id", "link_id", "locale");


--
-- Name: portal_link_texts_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_link_texts_portal_idx" ON "public"."portal_link_texts" USING "btree" ("organization_id", "portal_id");


--
-- Name: portal_links_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_links_category_idx" ON "public"."portal_links" USING "btree" ("category_id");


--
-- Name: portal_links_org_portal_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_links_org_portal_id_key" ON "public"."portal_links" USING "btree" ("organization_id", "portal_id", "id");


--
-- Name: portal_links_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_links_portal_idx" ON "public"."portal_links" USING "btree" ("portal_id");


--
-- Name: portal_localized_overrides_locale_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_localized_overrides_locale_unique" ON "public"."portal_localized_overrides" USING "btree" ("organization_id", "portal_id", "locale");


--
-- Name: portal_look_overrides_portal_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_look_overrides_portal_unique" ON "public"."portal_look_overrides" USING "btree" ("organization_id", "portal_id");


--
-- Name: portal_look_overrides_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_look_overrides_property_idx" ON "public"."portal_look_overrides" USING "btree" ("organization_id", "property_id");


--
-- Name: portal_media_assets_object_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_media_assets_object_key_unique" ON "public"."portal_media_assets" USING "btree" ("object_key");


--
-- Name: portal_media_assets_org_property_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_media_assets_org_property_id_key" ON "public"."portal_media_assets" USING "btree" ("organization_id", "property_id", "id");


--
-- Name: portal_metric_lifetime_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_metric_lifetime_property_idx" ON "public"."portal_metric_lifetime_aggregates" USING "btree" ("organization_id", "property_id");


--
-- Name: portal_metric_lifetime_scope_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_metric_lifetime_scope_unique" ON "public"."portal_metric_lifetime_aggregates" USING "btree" ("organization_id", "property_id", "portal_id");


--
-- Name: portal_page_edits_property_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_page_edits_property_portal_idx" ON "public"."portal_page_edits" USING "btree" ("organization_id", "property_id", "portal_id", "occurred_at");


--
-- Name: portal_pending_content_changes_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_pending_content_changes_open_idx" ON "public"."portal_pending_content_changes" USING "btree" ("organization_id", "property_id", "portal_id", "changed_at") WHERE ("resolved_at" IS NULL);


--
-- Name: portal_pending_content_changes_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_pending_content_changes_source_unique" ON "public"."portal_pending_content_changes" USING "btree" ("organization_id", "portal_id", "change_kind", "change_key", "source_version");


--
-- Name: portal_publication_activations_one_current_per_portal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_publication_activations_one_current_per_portal" ON "public"."portal_publication_activations" USING "btree" ("organization_id", "portal_id") WHERE ("deactivated_at" IS NULL);


--
-- Name: portal_publication_activations_portal_sequence_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_publication_activations_portal_sequence_unique" ON "public"."portal_publication_activations" USING "btree" ("organization_id", "portal_id", "activation_sequence");


--
-- Name: portal_publication_activations_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_publication_activations_snapshot_idx" ON "public"."portal_publication_activations" USING "btree" ("organization_id", "portal_id", "snapshot_id");


--
-- Name: portal_publication_snapshots_contact_evidence_binding_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_publication_snapshots_contact_evidence_binding_key" ON "public"."portal_publication_snapshots" USING "btree" ("organization_id", "property_id", "portal_id", "id", "version", "configuration_digest", "contact_request_enabled", "contact_notice_id", "contact_notice_version", "contact_notice_digest", "contact_notice_locale", "contact_request_purpose", "contact_retention_policy_version");


--
-- Name: portal_publication_snapshots_evidence_binding_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_publication_snapshots_evidence_binding_key" ON "public"."portal_publication_snapshots" USING "btree" ("organization_id", "property_id", "portal_id", "id", "version", "configuration_digest");


--
-- Name: portal_publication_snapshots_portal_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_publication_snapshots_portal_created_idx" ON "public"."portal_publication_snapshots" USING "btree" ("organization_id", "portal_id", "created_at");


--
-- Name: portal_publication_snapshots_portal_version_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_publication_snapshots_portal_version_unique" ON "public"."portal_publication_snapshots" USING "btree" ("organization_id", "portal_id", "version");


--
-- Name: portal_publication_snapshots_tenant_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_publication_snapshots_tenant_scope_id_key" ON "public"."portal_publication_snapshots" USING "btree" ("organization_id", "property_id", "portal_id", "id");


--
-- Name: portal_tokens_active_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portal_tokens_active_lookup_idx" ON "public"."portal_tokens" USING "btree" ("token_identifier", "status", "grace_period_ends");


--
-- Name: portal_tokens_hash_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_tokens_hash_unique" ON "public"."portal_tokens" USING "btree" ("token_hash");


--
-- Name: portal_tokens_identifier_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_tokens_identifier_unique" ON "public"."portal_tokens" USING "btree" ("token_identifier");


--
-- Name: portal_tokens_nfc_print_code_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_tokens_nfc_print_code_hash_key" ON "public"."portal_tokens" USING "btree" ("nfc_print_code_hash") WHERE ("nfc_print_code_hash" IS NOT NULL);


--
-- Name: portal_tokens_portal_version_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_tokens_portal_version_unique" ON "public"."portal_tokens" USING "btree" ("organization_id", "portal_id", "version");


--
-- Name: portal_tokens_qr_print_code_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_tokens_qr_print_code_hash_key" ON "public"."portal_tokens" USING "btree" ("qr_print_code_hash") WHERE ("qr_print_code_hash" IS NOT NULL);


--
-- Name: portal_tokens_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portal_tokens_scope_id_key" ON "public"."portal_tokens" USING "btree" ("organization_id", "property_id", "portal_id", "id");


--
-- Name: portals_org_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portals_org_id_key" ON "public"."portals" USING "btree" ("organization_id", "id");


--
-- Name: portals_org_property_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portals_org_property_id_key" ON "public"."portals" USING "btree" ("organization_id", "property_id", "id");


--
-- Name: portals_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "portals_org_property_idx" ON "public"."portals" USING "btree" ("organization_id", "property_id");


--
-- Name: portals_org_property_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "portals_org_property_slug_unique" ON "public"."portals" USING "btree" ("organization_id", "property_id", "slug") WHERE ("deleted_at" IS NULL);


--
-- Name: pr_org_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "pr_org_portal_idx" ON "public"."portal_responsibilities" USING "btree" ("organization_id", "portal_id");


--
-- Name: pr_scope_id_participation_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pr_scope_id_participation_key" ON "public"."portal_responsibilities" USING "btree" ("organization_id", "property_id", "portal_id", "id", "staff_participation_id");


--
-- Name: pr_unique_active_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pr_unique_active_primary" ON "public"."portal_responsibilities" USING "btree" ("organization_id", "portal_id") WHERE (("kind" = 'primary'::"public"."responsibility_kind") AND ("effective_to" IS NULL));


--
-- Name: privacy_requests_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "privacy_requests_scope_idx" ON "public"."privacy_requests" USING "btree" ("organization_id", "property_id", "state");


--
-- Name: privacy_requests_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "privacy_requests_subject_idx" ON "public"."privacy_requests" USING "btree" ("subject_ref", "received_at");


--
-- Name: prm_org_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "prm_org_portal_idx" ON "public"."portal_responsible_managers" USING "btree" ("organization_id", "portal_id");


--
-- Name: prm_org_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "prm_org_user_idx" ON "public"."portal_responsible_managers" USING "btree" ("organization_id", "user_id");


--
-- Name: prm_unique_active_manager; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "prm_unique_active_manager" ON "public"."portal_responsible_managers" USING "btree" ("organization_id", "portal_id", "user_id") WHERE ("effective_to" IS NULL);


--
-- Name: properties_lifecycle_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "properties_lifecycle_state_idx" ON "public"."properties" USING "btree" ("lifecycle_state") WHERE (("lifecycle_state")::"text" <> 'purged'::"text");


--
-- Name: properties_org_gbp_location_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "properties_org_gbp_location_id_unique" ON "public"."properties" USING "btree" ("organization_id", "gbp_location_id") WHERE (("gbp_location_id" IS NOT NULL) AND ("deleted_at" IS NULL));


--
-- Name: properties_org_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "properties_org_id_key" ON "public"."properties" USING "btree" ("organization_id", "id");


--
-- Name: properties_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "properties_org_idx" ON "public"."properties" USING "btree" ("organization_id");


--
-- Name: properties_org_lower_name_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "properties_org_lower_name_id_active_idx" ON "public"."properties" USING "btree" ("organization_id", "lower"(("name")::"text"), "id") WHERE ("deleted_at" IS NULL);


--
-- Name: properties_org_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "properties_org_slug_unique" ON "public"."properties" USING "btree" ("organization_id", "slug") WHERE ("deleted_at" IS NULL);


--
-- Name: property_access_grant_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "property_access_grant_active_unique" ON "public"."property_access_grant" USING "btree" ("organization_id", "property_id", "user_id") WHERE ("revoked_at" IS NULL);


--
-- Name: property_access_grant_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "property_access_grant_user_idx" ON "public"."property_access_grant" USING "btree" ("organization_id", "user_id") WHERE ("revoked_at" IS NULL);


--
-- Name: property_erase_authorities_live_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "property_erase_authorities_live_unique" ON "public"."property_erase_authorities" USING "btree" ("property_id") WHERE (("state")::"text" <> ALL ((ARRAY['purged'::character varying, 'cancelled'::character varying])::"text"[]));


--
-- Name: property_erase_authorities_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "property_erase_authorities_org_idx" ON "public"."property_erase_authorities" USING "btree" ("organization_id", "property_id");


--
-- Name: property_erase_authorities_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "property_erase_authorities_state_idx" ON "public"."property_erase_authorities" USING "btree" ("state", "state_changed_at");


--
-- Name: property_portal_brand_contents_locale_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "property_portal_brand_contents_locale_unique" ON "public"."property_portal_brand_contents" USING "btree" ("organization_id", "property_id", "locale");


--
-- Name: property_portal_brand_profiles_property_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "property_portal_brand_profiles_property_unique" ON "public"."property_portal_brand_profiles" USING "btree" ("organization_id", "property_id");


--
-- Name: property_portal_brand_profiles_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "property_portal_brand_profiles_scope_id_key" ON "public"."property_portal_brand_profiles" USING "btree" ("organization_id", "property_id", "id");


--
-- Name: property_rating_goal_changes_goal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "property_rating_goal_changes_goal_idx" ON "public"."property_rating_goal_changes" USING "btree" ("organization_id", "property_id", "goal_id", "changed_at");


--
-- Name: property_rating_goal_deferrals_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "property_rating_goal_deferrals_org_idx" ON "public"."property_rating_goal_deferrals" USING "btree" ("organization_id");


--
-- Name: property_rating_goals_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "property_rating_goals_one_active_idx" ON "public"."property_rating_goals" USING "btree" ("organization_id", "property_id") WHERE (("status")::"text" = 'active'::"text");


--
-- Name: property_rating_goals_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "property_rating_goals_property_idx" ON "public"."property_rating_goals" USING "btree" ("organization_id", "property_id", "created_at");


--
-- Name: property_rm_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "property_rm_org_property_idx" ON "public"."property_responsible_managers" USING "btree" ("organization_id", "property_id");


--
-- Name: property_rm_org_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "property_rm_org_user_idx" ON "public"."property_responsible_managers" USING "btree" ("organization_id", "user_id");


--
-- Name: property_rm_unique_active_manager; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "property_rm_unique_active_manager" ON "public"."property_responsible_managers" USING "btree" ("organization_id", "property_id", "user_id") WHERE ("effective_to" IS NULL);


--
-- Name: ratings_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ratings_portal_idx" ON "public"."ratings" USING "btree" ("portal_id");


--
-- Name: ratings_session_portal_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ratings_session_portal_unique" ON "public"."ratings" USING "btree" ("session_id", "portal_id");


--
-- Name: recent_activity_actor_label_redactions_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_actor_label_redactions_expiry_idx" ON "public"."recent_activity_actor_label_redactions" USING "btree" ("expires_at", "organization_id", "actor_subject_id");


--
-- Name: recent_activity_entries_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_entries_actor_idx" ON "public"."recent_activity_entries" USING "btree" ("actor_id", "created_at");


--
-- Name: recent_activity_entries_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_entries_created_at_idx" ON "public"."recent_activity_entries" USING "btree" ("created_at");


--
-- Name: recent_activity_entries_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_entries_event_id_idx" ON "public"."recent_activity_entries" USING "btree" ("event_id");


--
-- Name: recent_activity_entries_event_id_org_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "recent_activity_entries_event_id_org_uniq" ON "public"."recent_activity_entries" USING "btree" ("event_id", "organization_id");


--
-- Name: recent_activity_entries_org_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_entries_org_property_idx" ON "public"."recent_activity_entries" USING "btree" ("organization_id", "property_id", "created_at");


--
-- Name: recent_activity_entries_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_entries_resource_idx" ON "public"."recent_activity_entries" USING "btree" ("resource_type", "resource_id", "created_at");


--
-- Name: recent_activity_replay_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_replay_actor_idx" ON "public"."recent_activity_replay_facts" USING "btree" ("organization_id", "actor_subject_id", "replay_key");


--
-- Name: recent_activity_replay_org_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_replay_org_time_idx" ON "public"."recent_activity_replay_facts" USING "btree" ("organization_id", "source_occurred_at" DESC NULLS LAST, "replay_key");


--
-- Name: recent_activity_replay_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_replay_retention_idx" ON "public"."recent_activity_replay_facts" USING "btree" ("source_occurred_at", "replay_key");


--
-- Name: recent_activity_replay_source_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recent_activity_replay_source_event_idx" ON "public"."recent_activity_replay_facts" USING "btree" ("source_event_id", "organization_id");


--
-- Name: recovery_runs_completed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "recovery_runs_completed_idx" ON "public"."recovery_runs" USING "btree" ("completed_at" DESC NULLS LAST);


--
-- Name: recovery_runs_generation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "recovery_runs_generation_unique" ON "public"."recovery_runs" USING "btree" ("generation");


--
-- Name: recovery_runs_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "recovery_runs_source_unique" ON "public"."recovery_runs" USING "btree" ("source_manifest_sha256", "restore_point_at");


--
-- Name: replies_attempt_binding_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "replies_attempt_binding_unique" ON "public"."replies" USING "btree" ("organization_id", "review_id", "id");


--
-- Name: replies_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "replies_org_idx" ON "public"."replies" USING "btree" ("organization_id");


--
-- Name: replies_origin_operation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "replies_origin_operation_unique" ON "public"."replies" USING "btree" ("origin_operation_id") WHERE ("origin_operation_id" IS NOT NULL);


--
-- Name: replies_publication_reconcile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "replies_publication_reconcile_idx" ON "public"."replies" USING "btree" ("reconcile_due_at", "id") WHERE (("publication_state" = ANY (ARRAY['pending_observation'::"text", 'ambiguous'::"text"])) AND ("reconcile_due_at" IS NOT NULL));


--
-- Name: replies_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "replies_review_idx" ON "public"."replies" USING "btree" ("review_id");


--
-- Name: replies_review_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "replies_review_source_unique" ON "public"."replies" USING "btree" ("review_id", "source", "organization_id");


--
-- Name: reply_ai_frame_generation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_ai_frame_generation_unique" ON "public"."reply_ai_frame_reservations" USING "btree" ("organization_id", "property_id", "language_group", "rating_band", "voice_digest", "generation_seed");


--
-- Name: reply_publication_attempts_cycle_attempt_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_publication_attempts_cycle_attempt_key" ON "public"."reply_publication_attempts" USING "btree" ("reply_id", "publication_cycle", "attempt_number");


--
-- Name: reply_publication_attempts_observation_binding_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_publication_attempts_observation_binding_unique" ON "public"."reply_publication_attempts" USING "btree" ("organization_id", "property_id", "review_id", "reply_id", "publication_cycle", "attempt_number", "source_epoch", "material_review_revision");


--
-- Name: reply_publication_attempts_operation_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_publication_attempts_operation_key" ON "public"."reply_publication_attempts" USING "btree" ("organization_id", "provider_operation_key");


--
-- Name: reply_publication_attempts_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reply_publication_attempts_review_idx" ON "public"."reply_publication_attempts" USING "btree" ("organization_id", "review_id", "created_at");


--
-- Name: reply_publication_authorizations_attempt_binding_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_publication_authorizations_attempt_binding_unique" ON "public"."reply_publication_authorizations" USING "btree" ("organization_id", "property_id", "review_id", "reply_id", "publication_cycle", "source_epoch", "material_review_revision", "reply_state_revision", "normalization_version", "expected_reply_digest");


--
-- Name: reply_publication_authorizations_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reply_publication_authorizations_review_idx" ON "public"."reply_publication_authorizations" USING "btree" ("organization_id", "review_id", "authorized_at");


--
-- Name: reply_template_revisions_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_template_revisions_number_unique" ON "public"."reply_template_revisions" USING "btree" ("template_id", "number");


--
-- Name: reply_template_revisions_template_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_template_revisions_template_id_key" ON "public"."reply_template_revisions" USING "btree" ("template_id", "id");


--
-- Name: reply_template_visibility_account_builtin_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_template_visibility_account_builtin_unique" ON "public"."reply_template_visibility" USING "btree" ("organization_id", "builtin_key") WHERE (("property_id" IS NULL) AND ("builtin_key" IS NOT NULL));


--
-- Name: reply_template_visibility_account_template_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_template_visibility_account_template_unique" ON "public"."reply_template_visibility" USING "btree" ("organization_id", "template_id") WHERE (("property_id" IS NULL) AND ("template_id" IS NOT NULL));


--
-- Name: reply_template_visibility_property_builtin_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_template_visibility_property_builtin_unique" ON "public"."reply_template_visibility" USING "btree" ("organization_id", "property_id", "builtin_key") WHERE (("property_id" IS NOT NULL) AND ("builtin_key" IS NOT NULL));


--
-- Name: reply_template_visibility_property_template_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_template_visibility_property_template_unique" ON "public"."reply_template_visibility" USING "btree" ("organization_id", "property_id", "template_id") WHERE (("property_id" IS NOT NULL) AND ("template_id" IS NOT NULL));


--
-- Name: reply_templates_account_builtin_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_templates_account_builtin_unique" ON "public"."reply_templates" USING "btree" ("organization_id", "builtin_key") WHERE (("property_id" IS NULL) AND ("builtin_key" IS NOT NULL) AND ("archived_at" IS NULL));


--
-- Name: reply_templates_property_base_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_templates_property_base_unique" ON "public"."reply_templates" USING "btree" ("organization_id", "property_id", "based_on_template_id") WHERE (("property_id" IS NOT NULL) AND ("based_on_template_id" IS NOT NULL) AND ("archived_at" IS NULL));


--
-- Name: reply_templates_property_builtin_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_templates_property_builtin_unique" ON "public"."reply_templates" USING "btree" ("organization_id", "property_id", "builtin_key") WHERE (("property_id" IS NOT NULL) AND ("builtin_key" IS NOT NULL) AND ("archived_at" IS NULL));


--
-- Name: reply_templates_scope_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reply_templates_scope_active_idx" ON "public"."reply_templates" USING "btree" ("organization_id", "property_id", "archived_at");


--
-- Name: reply_templates_scope_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reply_templates_scope_id_key" ON "public"."reply_templates" USING "btree" ("organization_id", "property_id", "id");


--
-- Name: resend_webhook_deliveries_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "resend_webhook_deliveries_retention_idx" ON "public"."resend_webhook_deliveries" USING "btree" ("applied_at");


--
-- Name: retention_runs_subject_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "retention_runs_subject_started_idx" ON "public"."retention_runs" USING "btree" ("subject", "started_at");


--
-- Name: review_first_sightings_first_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_first_sightings_first_seen_idx" ON "public"."review_first_sightings" USING "btree" ("first_seen_at");


--
-- Name: review_first_sightings_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_first_sightings_property_idx" ON "public"."review_first_sightings" USING "btree" ("property_id", "first_seen_at");


--
-- Name: review_google_reputation_snapshot_event_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_google_reputation_snapshot_event_unique" ON "public"."review_google_reputation_snapshot_facts" USING "btree" ("event_id");


--
-- Name: review_google_reputation_snapshot_observed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_google_reputation_snapshot_observed_idx" ON "public"."review_google_reputation_snapshot_facts" USING "btree" ("organization_id", "property_id", "source_epoch", COALESCE("numbers_observed_at", "evaluated_at") DESC);


--
-- Name: review_google_reputation_snapshot_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_google_reputation_snapshot_scope_idx" ON "public"."review_google_reputation_snapshot_facts" USING "btree" ("organization_id", "property_id", "source_epoch", "evaluated_at" DESC NULLS LAST);


--
-- Name: review_lifecycle_recovery_approval_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_lifecycle_recovery_approval_unique" ON "public"."review_lifecycle_recovery_executions" USING "btree" ("approval_id");


--
-- Name: review_lifecycle_recovery_bundle_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_lifecycle_recovery_bundle_unique" ON "public"."review_lifecycle_recovery_executions" USING "btree" ("approval_bundle_sha256");


--
-- Name: review_lifecycle_recovery_generation_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_lifecycle_recovery_generation_unique" ON "public"."review_lifecycle_recovery_executions" USING "btree" ("recovery_generation");


--
-- Name: review_lifecycle_recovery_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_lifecycle_recovery_state_idx" ON "public"."review_lifecycle_recovery_executions" USING "btree" ("state");


--
-- Name: review_provider_snapshot_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_provider_snapshot_one_active_idx" ON "public"."review_provider_snapshot_runs" USING "btree" ("organization_id", "property_id", "source_epoch") WHERE (("state")::"text" = ANY ((ARRAY['scanning'::character varying, 'confirming'::character varying, 'deleting'::character varying])::"text"[]));


--
-- Name: review_provider_snapshot_runs_completed_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_provider_snapshot_runs_completed_property_idx" ON "public"."review_provider_snapshot_runs" USING "btree" ("organization_id", "property_id", "source_epoch") WHERE (("state")::"text" = 'completed'::"text");


--
-- Name: review_provider_subject_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_provider_subject_one_active_idx" ON "public"."review_provider_subject_hmac_key_versions" USING "btree" ("state") WHERE (("state")::"text" = 'active'::"text");


--
-- Name: review_provider_subjects_review_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_provider_subjects_review_unique" ON "public"."review_provider_subjects" USING "btree" ("organization_id", "property_id", "source_epoch", "review_id");


--
-- Name: review_refresh_runs_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_refresh_runs_started_at_idx" ON "public"."review_refresh_runs" USING "btree" ("started_at");


--
-- Name: review_source_contents_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_source_contents_connection_idx" ON "public"."review_source_contents" USING "btree" ("google_connection_id");


--
-- Name: review_source_contents_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_source_contents_expiry_idx" ON "public"."review_source_contents" USING "btree" ("content_expires_at", "review_id");


--
-- Name: review_source_contents_provider_identity_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_source_contents_provider_identity_unique" ON "public"."review_source_contents" USING "btree" ("platform", "external_id", "organization_id");


--
-- Name: review_source_observations_digest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_source_observations_digest_idx" ON "public"."review_source_observations" USING "btree" ("review_id", "source_epoch", "observation_digest");


--
-- Name: review_source_observations_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_source_observations_expiry_idx" ON "public"."review_source_observations" USING "btree" ("content_state", "content_expires_at", "review_id", "observation_sequence");


--
-- Name: review_source_observations_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "review_source_observations_key_unique" ON "public"."review_source_observations" USING "btree" ("review_id", "source_epoch", "observation_key");


--
-- Name: review_sync_runs_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_sync_runs_started_at_idx" ON "public"."review_sync_runs" USING "btree" ("started_at");


--
-- Name: review_sync_state_due_incremental_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_sync_state_due_incremental_idx" ON "public"."review_sync_state" USING "btree" ("next_incremental_at") WHERE ("next_incremental_at" IS NOT NULL);


--
-- Name: review_sync_state_lease_expired_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_sync_state_lease_expired_idx" ON "public"."review_sync_state" USING "btree" ("lease_until") WHERE ("lease_until" IS NOT NULL);


--
-- Name: reviews_content_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_content_expires_idx" ON "public"."reviews" USING "btree" ("content_expires_at", "id") WHERE ("content_expires_at" IS NOT NULL);


--
-- Name: reviews_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_expires_idx" ON "public"."reviews" USING "btree" ("expires_at");


--
-- Name: reviews_google_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_google_connection_idx" ON "public"."reviews" USING "btree" ("google_connection_id");


--
-- Name: reviews_lifecycle_cursor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_lifecycle_cursor_idx" ON "public"."reviews" USING "btree" ("created_at", "id");


--
-- Name: reviews_org_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reviews_org_id_key" ON "public"."reviews" USING "btree" ("organization_id", "id");


--
-- Name: reviews_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_org_idx" ON "public"."reviews" USING "btree" ("organization_id");


--
-- Name: reviews_org_property_reviewed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_org_property_reviewed_idx" ON "public"."reviews" USING "btree" ("organization_id", "property_id", "reviewed_at");


--
-- Name: reviews_platform_external_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reviews_platform_external_unique" ON "public"."reviews" USING "btree" ("platform", "external_id", "organization_id");


--
-- Name: reviews_property_created_cursor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_property_created_cursor_idx" ON "public"."reviews" USING "btree" ("property_id", "source_created_at" DESC NULLS LAST, "id" DESC NULLS LAST);


--
-- Name: reviews_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_property_idx" ON "public"."reviews" USING "btree" ("property_id");


--
-- Name: reviews_property_updated_cursor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reviews_property_updated_cursor_idx" ON "public"."reviews" USING "btree" ("property_id", "source_updated_at" DESC NULLS LAST, "id" DESC NULLS LAST);


--
-- Name: reviews_tenant_identity_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "reviews_tenant_identity_unique" ON "public"."reviews" USING "btree" ("organization_id", "property_id", "id");


--
-- Name: scan_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_events_created_at_idx" ON "public"."scan_events" USING "btree" ("created_at");


--
-- Name: scan_events_ip_hash_redaction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_events_ip_hash_redaction_idx" ON "public"."scan_events" USING "btree" ("created_at") WHERE ("ip_hash" IS NOT NULL);


--
-- Name: scan_events_portal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_events_portal_idx" ON "public"."scan_events" USING "btree" ("portal_id");


--
-- Name: scan_events_session_id_redaction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_events_session_id_redaction_idx" ON "public"."scan_events" USING "btree" ("created_at") WHERE ("session_id" IS NOT NULL);


--
-- Name: scan_events_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_events_session_idx" ON "public"."scan_events" USING "btree" ("session_id");


--
-- Name: session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "session_userId_idx" ON "public"."session" USING "btree" ("userId");


--
-- Name: sp_org_prop_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sp_org_prop_user_idx" ON "public"."staff_participations" USING "btree" ("organization_id", "property_id", "user_id");


--
-- Name: sp_org_property_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "sp_org_property_id_key" ON "public"."staff_participations" USING "btree" ("organization_id", "property_id", "id");


--
-- Name: sp_org_property_id_participant_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "sp_org_property_id_participant_key" ON "public"."staff_participations" USING "btree" ("organization_id", "property_id", "id", "staff_participant_id");


--
-- Name: sp_unique_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "sp_unique_active" ON "public"."staff_participations" USING "btree" ("organization_id", "property_id", "user_id") WHERE ("status" = 'active'::"public"."participation_status");


--
-- Name: sp_unique_active_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "sp_unique_active_participant" ON "public"."staff_participations" USING "btree" ("organization_id", "property_id", "staff_participant_id") WHERE (("status" = 'active'::"public"."participation_status") AND ("staff_participant_id" IS NOT NULL));


--
-- Name: sp_unique_active_personal_portal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "sp_unique_active_personal_portal" ON "public"."staff_participations" USING "btree" ("organization_id", "property_id", "personal_portal_id") WHERE (("status" = 'active'::"public"."participation_status") AND ("personal_portal_id" IS NOT NULL));


--
-- Name: staff_onboardings_unfinished_address; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "staff_onboardings_unfinished_address" ON "public"."staff_onboardings" USING "btree" ("organization_id", "property_id", "email") WHERE (("status")::"text" = ANY ((ARRAY['running'::character varying, 'failed'::character varying])::"text"[]));


--
-- Name: staff_participants_org_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "staff_participants_org_id_key" ON "public"."staff_participants" USING "btree" ("organization_id", "id");


--
-- Name: staff_participants_org_status_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "staff_participants_org_status_name_idx" ON "public"."staff_participants" USING "btree" ("organization_id", "status", "display_name");


--
-- Name: staff_user_links_org_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "staff_user_links_org_participant_idx" ON "public"."staff_user_links" USING "btree" ("organization_id", "staff_participant_id");


--
-- Name: staff_user_links_org_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "staff_user_links_org_user_idx" ON "public"."staff_user_links" USING "btree" ("organization_id", "user_id");


--
-- Name: staff_user_links_unique_active_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "staff_user_links_unique_active_participant" ON "public"."staff_user_links" USING "btree" ("organization_id", "staff_participant_id") WHERE ("effective_to" IS NULL);


--
-- Name: staff_user_links_unique_active_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "staff_user_links_unique_active_user" ON "public"."staff_user_links" USING "btree" ("organization_id", "user_id") WHERE ("effective_to" IS NULL);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "verification_identifier_idx" ON "public"."verification" USING "btree" ("identifier");


--
-- Name: work_items_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "work_items_due_idx" ON "public"."work_items" USING "btree" ("dispatch_after", "organization_id", "id") WHERE ("state" = 'pending'::"text");


--
-- Name: work_items_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "work_items_lease_idx" ON "public"."work_items" USING "btree" ("lease_expires_at", "id") WHERE ("state" = 'running'::"text");


--
-- Name: work_items_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "work_items_org_created_idx" ON "public"."work_items" USING "btree" ("organization_id", "created_at", "id");


--
-- Name: ai_execution_control_heads ai_execution_control_heads_transition_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "ai_execution_control_heads_transition_guard" BEFORE DELETE OR UPDATE ON "public"."ai_execution_control_heads" FOR EACH ROW EXECUTE FUNCTION "public"."reject_ai_execution_control_head_mutation_v1"();


--
-- Name: backup_erasure_ledger backup_erasure_ledger_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "backup_erasure_ledger_truncate_guard" BEFORE TRUNCATE ON "public"."backup_erasure_ledger" FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_backup_erasure_ledger_mutation_v1"();

ALTER TABLE "public"."backup_erasure_ledger" ENABLE ALWAYS TRIGGER "backup_erasure_ledger_truncate_guard";


--
-- Name: backup_erasure_ledger backup_erasure_ledger_update_delete_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "backup_erasure_ledger_update_delete_guard" BEFORE DELETE OR UPDATE ON "public"."backup_erasure_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."reject_backup_erasure_ledger_mutation_v1"();

ALTER TABLE "public"."backup_erasure_ledger" ENABLE ALWAYS TRIGGER "backup_erasure_ledger_update_delete_guard";


--
-- Name: beta_feedback_triage beta_feedback_triage_revision_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "beta_feedback_triage_revision_guard" BEFORE UPDATE ON "public"."beta_feedback_triage" FOR EACH ROW EXECUTE FUNCTION "public"."guard_beta_feedback_triage_revision_v1"();


--
-- Name: goal_monthly_results goal_monthly_results_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "goal_monthly_results_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."goal_monthly_results" FOR EACH ROW EXECUTE FUNCTION "public"."guard_goal_monthly_result_v1"();


--
-- Name: goal_programs goal_programs_transition_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "goal_programs_transition_guard" BEFORE UPDATE ON "public"."goal_programs" FOR EACH ROW EXECUTE FUNCTION "public"."guard_goal_program_transition_v1"();


--
-- Name: goal_result_revisions goal_result_revisions_insert_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "goal_result_revisions_insert_guard" BEFORE INSERT ON "public"."goal_result_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."validate_goal_result_revision_v1"();


--
-- Name: guest_responses guest_responses_retire_contact_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "guest_responses_retire_contact_request" AFTER UPDATE OF "status", "deleted_at", "feedback_withdrawn_at" ON "public"."guest_responses" FOR EACH ROW WHEN (((("old"."status")::"text" IS DISTINCT FROM ("new"."status")::"text") OR ("old"."deleted_at" IS DISTINCT FROM "new"."deleted_at") OR ("old"."feedback_withdrawn_at" IS DISTINCT FROM "new"."feedback_withdrawn_at"))) EXECUTE FUNCTION "public"."retire_guest_contact_on_response_terminal_v1"();


--
-- Name: inbox_feedback_handling_outcomes inbox_feedback_handling_outcomes_append_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "inbox_feedback_handling_outcomes_append_guard" BEFORE INSERT ON "public"."inbox_feedback_handling_outcomes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_inbox_feedback_handling_outcome_append_v1"();


--
-- Name: inbox_handling_cycle_response_targets inbox_handling_cycle_response_targets_terminal_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "inbox_handling_cycle_response_targets_terminal_guard" BEFORE DELETE OR UPDATE ON "public"."inbox_handling_cycle_response_targets" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_inbox_response_target_terminal_v1"();


--
-- Name: inbox_response_target_exclusions inbox_response_target_exclusions_append_only_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "inbox_response_target_exclusions_append_only_guard" BEFORE DELETE OR UPDATE ON "public"."inbox_response_target_exclusions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_inbox_response_target_exclusion_append_only_v1"();


--
-- Name: inbox_response_target_reminders inbox_response_target_reminders_schedule_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "inbox_response_target_reminders_schedule_guard" BEFORE INSERT ON "public"."inbox_response_target_reminders" FOR EACH ROW EXECUTE FUNCTION "public"."validate_inbox_response_target_reminder_schedule_v1"();


--
-- Name: inbox_response_target_reminders inbox_response_target_reminders_terminal_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "inbox_response_target_reminders_terminal_guard" BEFORE DELETE OR UPDATE ON "public"."inbox_response_target_reminders" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_inbox_response_target_reminder_terminal_v1"();


--
-- Name: member member_fence_google_connector_departure; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "member_fence_google_connector_departure" BEFORE DELETE OR UPDATE OF "role" ON "public"."member" FOR EACH ROW EXECUTE FUNCTION "public"."fence_google_connector_departure_v1"();


--
-- Name: member member_last_owner_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "member_last_owner_del" BEFORE DELETE ON "public"."member" FOR EACH ROW EXECUTE FUNCTION "public"."guard_last_owner"();


--
-- Name: member member_last_owner_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "member_last_owner_upd" BEFORE UPDATE OF "role", "organizationId" ON "public"."member" FOR EACH ROW WHEN ((("old"."role" IS DISTINCT FROM "new"."role") OR ("old"."organizationId" IS DISTINCT FROM "new"."organizationId"))) EXECUTE FUNCTION "public"."guard_last_owner"();


--
-- Name: member member_perm_ver_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "member_perm_ver_del" AFTER DELETE ON "public"."member" FOR EACH ROW EXECUTE FUNCTION "public"."tgr_bump_perm_ba"();


--
-- Name: member member_perm_ver_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "member_perm_ver_ins" AFTER INSERT ON "public"."member" FOR EACH ROW EXECUTE FUNCTION "public"."tgr_bump_perm_ba"();


--
-- Name: member member_perm_ver_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "member_perm_ver_upd" AFTER UPDATE OF "role", "organizationId" ON "public"."member" FOR EACH ROW EXECUTE FUNCTION "public"."tgr_bump_perm_ba"();


--
-- Name: merchant_ai_consent_evidence merchant_ai_consent_evidence_append_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "merchant_ai_consent_evidence_append_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."merchant_ai_consent_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."guard_merchant_ai_evidence_v1"();


--
-- Name: merchant_ai_consent_evidence merchant_ai_consent_evidence_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "merchant_ai_consent_evidence_truncate_guard" BEFORE TRUNCATE ON "public"."merchant_ai_consent_evidence" FOR EACH STATEMENT EXECUTE FUNCTION "public"."guard_merchant_ai_evidence_v1"();


--
-- Name: merchant_ai_enablement merchant_ai_enablement_transition_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "merchant_ai_enablement_transition_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."merchant_ai_enablement" FOR EACH ROW EXECUTE FUNCTION "public"."guard_merchant_ai_enablement_v1"();


--
-- Name: merchant_ai_enablement merchant_ai_enablement_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "merchant_ai_enablement_truncate_guard" BEFORE TRUNCATE ON "public"."merchant_ai_enablement" FOR EACH STATEMENT EXECUTE FUNCTION "public"."guard_merchant_ai_enablement_v1"();


--
-- Name: notifications notifications_normalize_source_content; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "notifications_normalize_source_content" BEFORE INSERT OR UPDATE OF "payload", "title", "body", "type" ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_notification_source_content_v1"();


--
-- Name: operational_action_history_heads operational_action_history_heads_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "operational_action_history_heads_truncate_guard" BEFORE TRUNCATE ON "public"."operational_action_history_heads" FOR EACH STATEMENT EXECUTE FUNCTION "public"."guard_operational_action_history_head_mutation_v1"();


--
-- Name: operational_action_history_heads operational_action_history_heads_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "operational_action_history_heads_update_guard" BEFORE DELETE OR UPDATE ON "public"."operational_action_history_heads" FOR EACH ROW EXECUTE FUNCTION "public"."guard_operational_action_history_head_mutation_v1"();


--
-- Name: operational_action_history_legal_holds operational_action_history_legal_holds_mutation_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "operational_action_history_legal_holds_mutation_guard" BEFORE DELETE OR UPDATE ON "public"."operational_action_history_legal_holds" FOR EACH ROW EXECUTE FUNCTION "public"."guard_operational_action_history_hold_mutation_v1"();


--
-- Name: operational_action_history_legal_holds operational_action_history_legal_holds_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "operational_action_history_legal_holds_truncate_guard" BEFORE TRUNCATE ON "public"."operational_action_history_legal_holds" FOR EACH STATEMENT EXECUTE FUNCTION "public"."guard_operational_action_history_hold_mutation_v1"();


--
-- Name: operational_action_history_records operational_action_history_records_mutation_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "operational_action_history_records_mutation_guard" BEFORE DELETE OR UPDATE ON "public"."operational_action_history_records" FOR EACH ROW EXECUTE FUNCTION "public"."guard_operational_action_history_record_mutation_v1"();


--
-- Name: operational_action_history_records operational_action_history_records_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "operational_action_history_records_truncate_guard" BEFORE TRUNCATE ON "public"."operational_action_history_records" FOR EACH STATEMENT EXECUTE FUNCTION "public"."guard_operational_action_history_record_mutation_v1"();


--
-- Name: organization_export_retrieval_issuances organization_export_retrieval_issuance_commit_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER "organization_export_retrieval_issuance_commit_guard" AFTER INSERT ON "public"."organization_export_retrieval_issuances" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."verify_organization_export_retrieval_issuance_v1"();


--
-- Name: organization_export_retrieval_issuances organization_export_retrieval_issuance_insert_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_export_retrieval_issuance_insert_guard" BEFORE INSERT ON "public"."organization_export_retrieval_issuances" FOR EACH ROW EXECUTE FUNCTION "public"."guard_organization_export_retrieval_issuance_v1"();


--
-- Name: organization_export_retrieval_issuances organization_export_retrieval_issuances_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_export_retrieval_issuances_truncate_guard" BEFORE TRUNCATE ON "public"."organization_export_retrieval_issuances" FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_identity_lifecycle_evidence_mutation_v1"();


--
-- Name: organization_export_retrieval_issuances organization_export_retrieval_issuances_update_delete_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_export_retrieval_issuances_update_delete_guard" BEFORE DELETE OR UPDATE ON "public"."organization_export_retrieval_issuances" FOR EACH ROW EXECUTE FUNCTION "public"."reject_identity_lifecycle_evidence_mutation_v1"();


--
-- Name: organization_exports organization_export_revision_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_export_revision_guard" BEFORE UPDATE ON "public"."organization_exports" FOR EACH ROW EXECUTE FUNCTION "public"."guard_organization_export_revision_v1"();


--
-- Name: organization organization_lifecycle_authority_provision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_lifecycle_authority_provision" AFTER INSERT ON "public"."organization" FOR EACH ROW EXECUTE FUNCTION "public"."provision_organization_lifecycle_authority_v1"();


--
-- Name: organization_lifecycle_events organization_lifecycle_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_lifecycle_events_append_only" BEFORE DELETE OR UPDATE OR TRUNCATE ON "public"."organization_lifecycle_events" FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_organization_lifecycle_event_mutation_v1"();


--
-- Name: organization_lifecycle_authority organization_lifecycle_revision_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_lifecycle_revision_guard" BEFORE UPDATE ON "public"."organization_lifecycle_authority" FOR EACH ROW EXECUTE FUNCTION "public"."guard_organization_lifecycle_revision_v1"();


--
-- Name: organizationRole organization_role_perm_ver_iud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_role_perm_ver_iud" AFTER INSERT OR DELETE OR UPDATE ON "public"."organizationRole" FOR EACH ROW EXECUTE FUNCTION "public"."tgr_bump_perm_ba"();


--
-- Name: organization_role_policy organization_role_policy_perm_ver_iud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "organization_role_policy_perm_ver_iud" AFTER INSERT OR DELETE OR UPDATE ON "public"."organization_role_policy" FOR EACH ROW EXECUTE FUNCTION "public"."tgr_bump_perm_app"();


--
-- Name: privacy_requests privacy_requests_transition_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "privacy_requests_transition_guard" BEFORE DELETE OR UPDATE ON "public"."privacy_requests" FOR EACH ROW EXECUTE FUNCTION "public"."reject_privacy_request_mutation_v1"();


--
-- Name: privacy_requests privacy_requests_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "privacy_requests_truncate_guard" BEFORE TRUNCATE ON "public"."privacy_requests" FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_privacy_request_mutation_v1"();


--
-- Name: property_access_grant property_access_grant_perm_ver_iud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "property_access_grant_perm_ver_iud" AFTER INSERT OR DELETE OR UPDATE ON "public"."property_access_grant" FOR EACH ROW EXECUTE FUNCTION "public"."tgr_bump_perm_app"();


--
-- Name: property_erase_authorities property_erase_authorities_transition_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "property_erase_authorities_transition_guard" BEFORE DELETE OR UPDATE ON "public"."property_erase_authorities" FOR EACH ROW EXECUTE FUNCTION "public"."reject_property_erase_authority_mutation_v1"();

ALTER TABLE "public"."property_erase_authorities" ENABLE ALWAYS TRIGGER "property_erase_authorities_transition_guard";


--
-- Name: property_erase_authorities property_erase_authorities_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "property_erase_authorities_truncate_guard" BEFORE TRUNCATE ON "public"."property_erase_authorities" FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_property_erase_authority_mutation_v1"();


--
-- Name: replies replies_advance_state_revision_on_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "replies_advance_state_revision_on_delete" BEFORE DELETE ON "public"."replies" FOR EACH ROW EXECUTE FUNCTION "public"."advance_review_reply_state_revision_on_delete_v1"();


--
-- Name: replies replies_increment_state_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "replies_increment_state_revision" BEFORE INSERT OR UPDATE ON "public"."replies" FOR EACH ROW EXECUTE FUNCTION "public"."increment_reply_state_revision"();


--
-- Name: replies replies_invalidate_ai_adoption; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "replies_invalidate_ai_adoption" AFTER DELETE OR UPDATE ON "public"."replies" FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_ai_reply_adoption_v1"();


--
-- Name: review_lifecycle_recovery_executions review_lifecycle_recovery_executions_mutation_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "review_lifecycle_recovery_executions_mutation_guard" BEFORE DELETE OR UPDATE ON "public"."review_lifecycle_recovery_executions" FOR EACH ROW EXECUTE FUNCTION "public"."guard_review_lifecycle_recovery_execution_v1"();


--
-- Name: review_lifecycle_recovery_executions review_lifecycle_recovery_executions_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "review_lifecycle_recovery_executions_truncate_guard" BEFORE TRUNCATE ON "public"."review_lifecycle_recovery_executions" FOR EACH STATEMENT EXECUTE FUNCTION "public"."guard_review_lifecycle_recovery_execution_v1"();


--
-- Name: reviews reviews_protect_reply_state_revision; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "reviews_protect_reply_state_revision" BEFORE UPDATE OF "reply_state_revision" ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."protect_review_reply_state_revision_v1"();


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."account"
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE;


--
-- Name: ai_draft_measurement_links ai_draft_measurement_links_generation_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_draft_measurement_links"
    ADD CONSTRAINT "ai_draft_measurement_links_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."ai_draft_measurements"("id") ON DELETE CASCADE;


--
-- Name: ai_draft_measurement_links ai_draft_measurement_links_reply_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_draft_measurement_links"
    ADD CONSTRAINT "ai_draft_measurement_links_reply_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE CASCADE;


--
-- Name: ai_draft_measurements ai_draft_measurements_operation_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_draft_measurements"
    ADD CONSTRAINT "ai_draft_measurements_operation_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE CASCADE;


--
-- Name: ai_draft_measurements ai_draft_measurements_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_draft_measurements"
    ADD CONSTRAINT "ai_draft_measurements_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_execution_control_heads ai_execution_control_heads_transition_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_execution_control_heads"
    ADD CONSTRAINT "ai_execution_control_heads_transition_fk" FOREIGN KEY ("control_id", "generation") REFERENCES "public"."ai_execution_control_transitions"("control_id", "generation") ON DELETE RESTRICT;


--
-- Name: ai_operations ai_operations_capability_control_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_operations"
    ADD CONSTRAINT "ai_operations_capability_control_fk" FOREIGN KEY ("capability_control_id", "capability_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id", "generation") ON DELETE RESTRICT;


--
-- Name: ai_operations ai_operations_global_control_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_operations"
    ADD CONSTRAINT "ai_operations_global_control_fk" FOREIGN KEY ("global_control_id", "global_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id", "generation") ON DELETE RESTRICT;


--
-- Name: ai_operations ai_operations_provider_control_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_operations"
    ADD CONSTRAINT "ai_operations_provider_control_fk" FOREIGN KEY ("provider_control_id", "provider_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id", "generation") ON DELETE RESTRICT;


--
-- Name: ai_operations ai_operations_rewrite_parent_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_operations"
    ADD CONSTRAINT "ai_operations_rewrite_parent_fk" FOREIGN KEY ("rewrite_parent_operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE RESTRICT;


--
-- Name: ai_operations ai_operations_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_operations"
    ADD CONSTRAINT "ai_operations_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_aggregate_contribution_aspects ai_property_aggregate_contribution_aspects_contribution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_contribution_aspects"
    ADD CONSTRAINT "ai_property_aggregate_contribution_aspects_contribution_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") REFERENCES "public"."ai_property_aggregate_contributions"("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") ON DELETE CASCADE;


--
-- Name: ai_property_aggregate_contribution_mentions ai_property_aggregate_contribution_mentions_contribution_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_contribution_mentions"
    ADD CONSTRAINT "ai_property_aggregate_contribution_mentions_contribution_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") REFERENCES "public"."ai_property_aggregate_contributions"("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") ON DELETE CASCADE;


--
-- Name: ai_property_aggregate_contribution_mentions ai_property_aggregate_contribution_mentions_issue_group_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_contribution_mentions"
    ADD CONSTRAINT "ai_property_aggregate_contribution_mentions_issue_group_fk" FOREIGN KEY ("organization_id", "property_id", "issue_group_id", "topic") REFERENCES "public"."ai_property_issue_groups"("organization_id", "property_id", "id", "topic") DEFERRABLE INITIALLY DEFERRED;


--
-- Name: ai_property_aggregate_contributions ai_property_aggregate_contributions_analysis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_contributions"
    ADD CONSTRAINT "ai_property_aggregate_contributions_analysis_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") REFERENCES "public"."ai_review_analyses"("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") ON DELETE CASCADE;


--
-- Name: ai_property_aggregate_heads ai_property_aggregate_heads_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_heads"
    ADD CONSTRAINT "ai_property_aggregate_heads_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_aggregate_settlements ai_property_aggregate_settlements_review_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_settlements"
    ADD CONSTRAINT "ai_property_aggregate_settlements_review_fk" FOREIGN KEY ("organization_id", "property_id", "review_id") REFERENCES "public"."reviews"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_aggregate_settlements ai_property_aggregate_settlements_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_aggregate_settlements"
    ADD CONSTRAINT "ai_property_aggregate_settlements_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_daily_aggregates ai_property_daily_aggregates_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_daily_aggregates"
    ADD CONSTRAINT "ai_property_daily_aggregates_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_daily_aspect_aggregates ai_property_daily_aspect_aggregates_daily_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_daily_aspect_aggregates"
    ADD CONSTRAINT "ai_property_daily_aspect_aggregates_daily_fk" FOREIGN KEY ("organization_id", "property_id", "local_date", "source_epoch", "review_analysis_epoch", "property_profile_version") REFERENCES "public"."ai_property_daily_aggregates"("organization_id", "property_id", "local_date", "source_epoch", "review_analysis_epoch", "property_profile_version") ON DELETE CASCADE;


--
-- Name: ai_property_issue_groups ai_property_issue_groups_merged_into_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_issue_groups"
    ADD CONSTRAINT "ai_property_issue_groups_merged_into_fk" FOREIGN KEY ("organization_id", "property_id", "merged_into_issue_id", "topic") REFERENCES "public"."ai_property_issue_groups"("organization_id", "property_id", "id", "topic") ON DELETE CASCADE;


--
-- Name: ai_property_issue_groups ai_property_issue_groups_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_issue_groups"
    ADD CONSTRAINT "ai_property_issue_groups_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_issue_members ai_property_issue_members_group_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_issue_members"
    ADD CONSTRAINT "ai_property_issue_members_group_fk" FOREIGN KEY ("organization_id", "property_id", "issue_group_id", "topic") REFERENCES "public"."ai_property_issue_groups"("organization_id", "property_id", "id", "topic") ON DELETE CASCADE;


--
-- Name: ai_property_processing_profiles ai_property_profiles_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_processing_profiles"
    ADD CONSTRAINT "ai_property_profiles_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_review_population_daily ai_property_review_population_daily_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_review_population_daily"
    ADD CONSTRAINT "ai_property_review_population_daily_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_trend_outcomes ai_property_trend_outcomes_operation_id_ai_operations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_trend_outcomes"
    ADD CONSTRAINT "ai_property_trend_outcomes_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE RESTRICT;


--
-- Name: ai_property_trend_outcomes ai_property_trend_outcomes_schedule_id_ai_property_trend_schedu; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_trend_outcomes"
    ADD CONSTRAINT "ai_property_trend_outcomes_schedule_id_ai_property_trend_schedu" FOREIGN KEY ("schedule_id") REFERENCES "public"."ai_property_trend_schedules"("id") ON DELETE CASCADE;


--
-- Name: ai_property_trend_outcomes ai_property_trend_outcomes_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_trend_outcomes"
    ADD CONSTRAINT "ai_property_trend_outcomes_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_property_trend_schedules ai_property_trend_schedules_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_property_trend_schedules"
    ADD CONSTRAINT "ai_property_trend_schedules_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_review_analyses ai_review_analyses_material_review_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analyses"
    ADD CONSTRAINT "ai_review_analyses_material_review_revision_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision") REFERENCES "public"."material_review_revisions"("organization_id", "property_id", "review_id", "source_epoch", "revision") ON DELETE RESTRICT;


--
-- Name: ai_review_analyses ai_review_analyses_operation_id_ai_operations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analyses"
    ADD CONSTRAINT "ai_review_analyses_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE RESTRICT;


--
-- Name: ai_review_analyses ai_review_analyses_review_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analyses"
    ADD CONSTRAINT "ai_review_analyses_review_fk" FOREIGN KEY ("organization_id", "property_id", "review_id") REFERENCES "public"."reviews"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: ai_review_analyses ai_review_analyses_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analyses"
    ADD CONSTRAINT "ai_review_analyses_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_review_analysis_aspects ai_review_analysis_aspects_analysis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_aspects"
    ADD CONSTRAINT "ai_review_analysis_aspects_analysis_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") REFERENCES "public"."ai_review_analyses"("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") ON DELETE CASCADE;


--
-- Name: ai_review_analysis_backlog ai_review_analysis_backlog_review_id_reviews_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_backlog"
    ADD CONSTRAINT "ai_review_analysis_backlog_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE CASCADE;


--
-- Name: ai_review_analysis_backlog ai_review_analysis_backlog_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_backlog"
    ADD CONSTRAINT "ai_review_analysis_backlog_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_review_analysis_enrollments ai_review_analysis_enrollments_authorization_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_enrollments"
    ADD CONSTRAINT "ai_review_analysis_enrollments_authorization_fk" FOREIGN KEY ("authorization_lineage_id", "authorization_state_version", "organization_id", "property_id") REFERENCES "public"."merchant_ai_consent_evidence"("authorization_lineage_id", "state_version", "organization_id", "property_id") ON DELETE RESTRICT;


--
-- Name: ai_review_analysis_enrollments ai_review_analysis_enrollments_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_enrollments"
    ADD CONSTRAINT "ai_review_analysis_enrollments_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ai_review_analysis_mention_corrections ai_review_analysis_mention_corrections_issue_group_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_mention_corrections"
    ADD CONSTRAINT "ai_review_analysis_mention_corrections_issue_group_fk" FOREIGN KEY ("organization_id", "property_id", "replacement_issue_group_id", "topic") REFERENCES "public"."ai_property_issue_groups"("organization_id", "property_id", "id", "topic") ON DELETE CASCADE;


--
-- Name: ai_review_analysis_mention_corrections ai_review_analysis_mention_corrections_mention_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_mention_corrections"
    ADD CONSTRAINT "ai_review_analysis_mention_corrections_mention_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "mention_ordinal") REFERENCES "public"."ai_review_analysis_mentions"("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "mention_ordinal") ON DELETE CASCADE;


--
-- Name: ai_review_analysis_mention_sentences ai_review_analysis_mention_sentences_mention_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_mention_sentences"
    ADD CONSTRAINT "ai_review_analysis_mention_sentences_mention_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "mention_ordinal") REFERENCES "public"."ai_review_analysis_mentions"("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence", "mention_ordinal") ON DELETE CASCADE;


--
-- Name: ai_review_analysis_mentions ai_review_analysis_mentions_analysis_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_review_analysis_mentions"
    ADD CONSTRAINT "ai_review_analysis_mentions_analysis_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") REFERENCES "public"."ai_review_analyses"("organization_id", "property_id", "review_id", "source_epoch", "source_revision", "analysis_sequence") ON DELETE CASCADE;


--
-- Name: beta_feedback_masked_layouts beta_feedback_masked_layouts_feedback_reference_beta_feedback_t; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."beta_feedback_masked_layouts"
    ADD CONSTRAINT "beta_feedback_masked_layouts_feedback_reference_beta_feedback_t" FOREIGN KEY ("feedback_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE CASCADE;


--
-- Name: beta_feedback_triage beta_feedback_triage_duplicate_reference_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."beta_feedback_triage"
    ADD CONSTRAINT "beta_feedback_triage_duplicate_reference_fk" FOREIGN KEY ("duplicate_of_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE RESTRICT;


--
-- Name: beta_feedback_triage_transitions beta_feedback_triage_transition_duplicate_reference_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."beta_feedback_triage_transitions"
    ADD CONSTRAINT "beta_feedback_triage_transition_duplicate_reference_fk" FOREIGN KEY ("duplicate_of_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE RESTRICT;


--
-- Name: beta_feedback_triage_transitions beta_feedback_triage_transitions_feedback_reference_beta_feedba; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."beta_feedback_triage_transitions"
    ADD CONSTRAINT "beta_feedback_triage_transitions_feedback_reference_beta_feedba" FOREIGN KEY ("feedback_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE RESTRICT;


--
-- Name: event_consumer_receipts event_consumer_receipts_event_id_outbox_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."event_consumer_receipts"
    ADD CONSTRAINT "event_consumer_receipts_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE CASCADE;


--
-- Name: feedback feedback_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE RESTRICT;


--
-- Name: feedback feedback_rating_id_ratings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE SET NULL;


--
-- Name: goal_month_target_changes goal_month_target_changes_following_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_month_target_changes"
    ADD CONSTRAINT "goal_month_target_changes_following_version_fk" FOREIGN KEY ("organization_id", "property_id", "program_id", "following_version_id") REFERENCES "public"."goal_program_versions"("organization_id", "property_id", "program_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_month_target_changes goal_month_target_changes_program_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_month_target_changes"
    ADD CONSTRAINT "goal_month_target_changes_program_fk" FOREIGN KEY ("organization_id", "property_id", "program_id") REFERENCES "public"."goal_programs"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_month_target_changes goal_month_target_changes_result_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_month_target_changes"
    ADD CONSTRAINT "goal_month_target_changes_result_fk" FOREIGN KEY ("organization_id", "property_id", "program_id", "monthly_result_id") REFERENCES "public"."goal_monthly_results"("organization_id", "property_id", "program_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_monthly_results goal_monthly_results_assignment_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_monthly_results"
    ADD CONSTRAINT "goal_monthly_results_assignment_fk" FOREIGN KEY ("organization_id", "property_id", "program_id", "program_version_id", "assignment_id") REFERENCES "public"."goal_subject_assignments"("organization_id", "property_id", "program_id", "program_version_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_program_versions goal_program_versions_program_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_program_versions"
    ADD CONSTRAINT "goal_program_versions_program_fk" FOREIGN KEY ("organization_id", "property_id", "program_id") REFERENCES "public"."goal_programs"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_programs goal_programs_property_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_programs"
    ADD CONSTRAINT "goal_programs_property_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_result_revisions goal_result_revisions_result_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_result_revisions"
    ADD CONSTRAINT "goal_result_revisions_result_fk" FOREIGN KEY ("organization_id", "property_id", "monthly_result_id") REFERENCES "public"."goal_monthly_results"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_result_revisions goal_result_revisions_supersedes_revision_id_goal_result_revisi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_result_revisions"
    ADD CONSTRAINT "goal_result_revisions_supersedes_revision_id_goal_result_revisi" FOREIGN KEY ("supersedes_revision_id") REFERENCES "public"."goal_result_revisions"("id") ON DELETE RESTRICT;


--
-- Name: goal_subject_assignments goal_subject_assignments_portal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_subject_assignments"
    ADD CONSTRAINT "goal_subject_assignments_portal_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_subject_assignments goal_subject_assignments_portal_group_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_subject_assignments"
    ADD CONSTRAINT "goal_subject_assignments_portal_group_fk" FOREIGN KEY ("organization_id", "property_id", "portal_group_id") REFERENCES "public"."portal_groups"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_subject_assignments goal_subject_assignments_property_subject_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_subject_assignments"
    ADD CONSTRAINT "goal_subject_assignments_property_subject_fk" FOREIGN KEY ("organization_id", "property_subject_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: goal_subject_assignments goal_subject_assignments_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."goal_subject_assignments"
    ADD CONSTRAINT "goal_subject_assignments_version_fk" FOREIGN KEY ("organization_id", "property_id", "program_id", "program_version_id", "metric_key") REFERENCES "public"."goal_program_versions"("organization_id", "property_id", "program_id", "id", "metric_key") ON DELETE RESTRICT;


--
-- Name: google_import_discovery_records google_import_discovery_records_connection_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_import_discovery_records"
    ADD CONSTRAINT "google_import_discovery_records_connection_tenant_fk" FOREIGN KEY ("organization_id", "connection_id") REFERENCES "public"."google_connections"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: google_import_discovery_records google_import_discovery_records_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_import_discovery_records"
    ADD CONSTRAINT "google_import_discovery_records_property_tenant_fk" FOREIGN KEY ("organization_id", "affected_property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: google_import_items google_import_items_connection_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_import_items"
    ADD CONSTRAINT "google_import_items_connection_tenant_fk" FOREIGN KEY ("organization_id", "connection_id") REFERENCES "public"."google_connections"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: google_import_items google_import_items_parent_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_import_items"
    ADD CONSTRAINT "google_import_items_parent_tenant_fk" FOREIGN KEY ("organization_id", "import_id") REFERENCES "public"."google_imports"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: google_import_items google_import_items_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_import_items"
    ADD CONSTRAINT "google_import_items_property_tenant_fk" FOREIGN KEY ("organization_id", "existing_property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: google_reply_observation_heads google_reply_observation_heads_exact_observation_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_reply_observation_heads"
    ADD CONSTRAINT "google_reply_observation_heads_exact_observation_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "observation_id", "observation_revision", "source_epoch", "material_review_revision", "state", "provenance") REFERENCES "public"."google_reply_observations"("organization_id", "property_id", "review_id", "id", "observation_revision", "source_epoch", "material_review_revision", "state", "provenance") ON DELETE RESTRICT;


--
-- Name: google_reply_observations google_reply_observations_matched_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_reply_observations"
    ADD CONSTRAINT "google_reply_observations_matched_attempt_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "matched_reply_id", "matched_publication_cycle", "matched_attempt_number", "source_epoch", "material_review_revision") REFERENCES "public"."reply_publication_attempts"("organization_id", "property_id", "review_id", "reply_id", "publication_cycle", "attempt_number", "source_epoch", "material_review_revision") ON DELETE RESTRICT;


--
-- Name: google_reply_observations google_reply_observations_material_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_reply_observations"
    ADD CONSTRAINT "google_reply_observations_material_revision_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id", "property_id", "review_id", "source_epoch", "revision") ON DELETE RESTRICT;


--
-- Name: google_reply_observations google_reply_observations_review_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."google_reply_observations"
    ADD CONSTRAINT "google_reply_observations_review_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "review_id") REFERENCES "public"."reviews"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: guest_contact_requests guest_contact_requests_portal_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_contact_requests"
    ADD CONSTRAINT "guest_contact_requests_portal_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: guest_contact_requests guest_contact_requests_publication_evidence_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_contact_requests"
    ADD CONSTRAINT "guest_contact_requests_publication_evidence_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "publication_snapshot_id", "publication_version", "publication_digest", "contact_request_enabled", "notice_id", "notice_version", "notice_digest", "notice_locale", "purpose", "retention_policy_version") REFERENCES "public"."portal_publication_snapshots"("organization_id", "property_id", "portal_id", "id", "version", "configuration_digest", "contact_request_enabled", "contact_notice_id", "contact_notice_version", "contact_notice_digest", "contact_notice_locale", "contact_request_purpose", "contact_retention_policy_version") ON DELETE RESTRICT;


--
-- Name: guest_contact_requests guest_contact_requests_response_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_contact_requests"
    ADD CONSTRAINT "guest_contact_requests_response_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "property_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: guest_contact_request_reveal_audits guest_contact_reveal_audits_request_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_contact_request_reveal_audits"
    ADD CONSTRAINT "guest_contact_reveal_audits_request_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "contact_request_id") REFERENCES "public"."guest_contact_requests"("organization_id", "property_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: guest_network_pressure_records guest_network_pressure_portal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_network_pressure_records"
    ADD CONSTRAINT "guest_network_pressure_portal_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: guest_qualified_scans guest_qualified_scans_artifact_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_qualified_scans"
    ADD CONSTRAINT "guest_qualified_scans_artifact_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "access_artifact_id") REFERENCES "public"."portal_access_artifacts"("organization_id", "property_id", "portal_id", "id") ON DELETE RESTRICT;


--
-- Name: guest_qualified_scans guest_qualified_scans_group_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_qualified_scans"
    ADD CONSTRAINT "guest_qualified_scans_group_fk" FOREIGN KEY ("organization_id", "property_id", "portal_group_id") REFERENCES "public"."portal_groups"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: guest_qualified_scans guest_qualified_scans_participant_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_qualified_scans"
    ADD CONSTRAINT "guest_qualified_scans_participant_scope_fk" FOREIGN KEY ("organization_id", "property_id", "attributed_staff_participation_id", "attributed_staff_participant_id") REFERENCES "public"."staff_participations"("organization_id", "property_id", "id", "staff_participant_id") ON DELETE RESTRICT;


--
-- Name: guest_qualified_scans guest_qualified_scans_portal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_qualified_scans"
    ADD CONSTRAINT "guest_qualified_scans_portal_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: guest_qualified_scans guest_qualified_scans_responsibility_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_qualified_scans"
    ADD CONSTRAINT "guest_qualified_scans_responsibility_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "attribution_responsibility_id", "attributed_staff_participation_id") REFERENCES "public"."portal_responsibilities"("organization_id", "property_id", "portal_id", "id", "staff_participation_id") ON DELETE RESTRICT;


--
-- Name: guest_response_experience_snapshots guest_response_experience_snapshots_publication_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_experience_snapshots"
    ADD CONSTRAINT "guest_response_experience_snapshots_publication_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "publication_snapshot_id", "publication_version", "publication_digest") REFERENCES "public"."portal_publication_snapshots"("organization_id", "property_id", "portal_id", "id", "version", "configuration_digest") ON DELETE RESTRICT;


--
-- Name: guest_response_experience_snapshots guest_response_experience_snapshots_response_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_experience_snapshots"
    ADD CONSTRAINT "guest_response_experience_snapshots_response_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "property_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: guest_response_integrity_decisions guest_response_integrity_decisions_response_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_integrity_decisions"
    ADD CONSTRAINT "guest_response_integrity_decisions_response_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "property_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: guest_response_private_feedback guest_response_private_feedback_response_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_private_feedback"
    ADD CONSTRAINT "guest_response_private_feedback_response_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "property_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: guest_response_private_feedback guest_response_private_feedback_response_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_private_feedback"
    ADD CONSTRAINT "guest_response_private_feedback_response_tenant_fk" FOREIGN KEY ("organization_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: guest_response_session_bindings guest_response_session_bindings_response_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_session_bindings"
    ADD CONSTRAINT "guest_response_session_bindings_response_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "property_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: guest_response_session_bindings guest_response_session_bindings_response_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_response_session_bindings"
    ADD CONSTRAINT "guest_response_session_bindings_response_tenant_fk" FOREIGN KEY ("organization_id", "response_id") REFERENCES "public"."guest_responses"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: guest_responses guest_responses_participant_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_responses"
    ADD CONSTRAINT "guest_responses_participant_scope_fk" FOREIGN KEY ("organization_id", "property_id", "attributed_staff_participation_id", "attributed_staff_participant_id") REFERENCES "public"."staff_participations"("organization_id", "property_id", "id", "staff_participant_id") ON DELETE RESTRICT;


--
-- Name: guest_responses guest_responses_portal_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_responses"
    ADD CONSTRAINT "guest_responses_portal_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: guest_responses guest_responses_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_responses"
    ADD CONSTRAINT "guest_responses_portal_tenant_fk" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "public"."portals"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: guest_responses guest_responses_responsibility_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."guest_responses"
    ADD CONSTRAINT "guest_responses_responsibility_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "attribution_responsibility_id", "attributed_staff_participation_id") REFERENCES "public"."portal_responsibilities"("organization_id", "property_id", "portal_id", "id", "staff_participation_id") ON DELETE RESTRICT;


--
-- Name: inbox_assignment_history inbox_assignment_history_inbox_item_id_inbox_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_assignment_history"
    ADD CONSTRAINT "inbox_assignment_history_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE CASCADE;


--
-- Name: inbox_escalation_history inbox_escalation_history_inbox_item_id_inbox_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_escalation_history"
    ADD CONSTRAINT "inbox_escalation_history_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE CASCADE;


--
-- Name: inbox_feedback_handling_outcomes inbox_feedback_handling_outcomes_completion_transition_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_feedback_handling_outcomes"
    ADD CONSTRAINT "inbox_feedback_handling_outcomes_completion_transition_fk" FOREIGN KEY ("inbox_item_id", "completion_state_revision") REFERENCES "public"."inbox_handling_cycle_transitions"("inbox_item_id", "state_revision") ON DELETE CASCADE;


--
-- Name: inbox_feedback_handling_outcomes inbox_feedback_handling_outcomes_cycle_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_feedback_handling_outcomes"
    ADD CONSTRAINT "inbox_feedback_handling_outcomes_cycle_scope_fk" FOREIGN KEY ("inbox_item_id", "cycle_number", "organization_id", "property_id", "source_type", "feedback_id", "source_revision") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id", "cycle_number", "organization_id", "property_id", "source_type", "source_id", "source_revision") ON DELETE CASCADE;


--
-- Name: inbox_feedback_handling_outcomes inbox_feedback_handling_outcomes_supersedes_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_feedback_handling_outcomes"
    ADD CONSTRAINT "inbox_feedback_handling_outcomes_supersedes_fk" FOREIGN KEY ("inbox_item_id", "cycle_number", "supersedes_outcome_id", "supersedes_outcome_revision") REFERENCES "public"."inbox_feedback_handling_outcomes"("inbox_item_id", "cycle_number", "id", "outcome_revision") ON DELETE CASCADE;


--
-- Name: inbox_handling_cycle_heads inbox_handling_cycle_heads_current_cycle_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_heads"
    ADD CONSTRAINT "inbox_handling_cycle_heads_current_cycle_fk" FOREIGN KEY ("inbox_item_id", "current_cycle_number") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id", "cycle_number") ON DELETE CASCADE;


--
-- Name: inbox_handling_cycle_heads inbox_handling_cycle_heads_inbox_item_id_inbox_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_heads"
    ADD CONSTRAINT "inbox_handling_cycle_heads_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE CASCADE;


--
-- Name: inbox_handling_cycle_heads inbox_handling_cycle_heads_material_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_heads"
    ADD CONSTRAINT "inbox_handling_cycle_heads_material_revision_fk" FOREIGN KEY ("review_id", "current_material_review_revision") REFERENCES "public"."material_review_revisions"("review_id", "revision") ON DELETE RESTRICT;


--
-- Name: inbox_handling_cycle_heads inbox_handling_cycle_heads_source_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_heads"
    ADD CONSTRAINT "inbox_handling_cycle_heads_source_scope_fk" FOREIGN KEY ("inbox_item_id", "organization_id", "source_type", "source_id") REFERENCES "public"."inbox_items"("id", "organization_id", "source_type", "source_id") ON DELETE CASCADE;


--
-- Name: inbox_handling_cycle_response_targets inbox_handling_cycle_response_targets_cycle_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_response_targets"
    ADD CONSTRAINT "inbox_handling_cycle_response_targets_cycle_scope_fk" FOREIGN KEY ("inbox_item_id", "cycle_number", "organization_id", "property_id", "source_type", "source_id", "source_revision") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id", "cycle_number", "organization_id", "property_id", "source_type", "source_id", "source_revision") ON DELETE CASCADE;


--
-- Name: inbox_handling_cycle_transitions inbox_handling_cycle_transitions_cycle_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_transitions"
    ADD CONSTRAINT "inbox_handling_cycle_transitions_cycle_fk" FOREIGN KEY ("inbox_item_id", "cycle_number") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id", "cycle_number") ON DELETE CASCADE;


--
-- Name: inbox_handling_cycle_transitions inbox_handling_cycle_transitions_source_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycle_transitions"
    ADD CONSTRAINT "inbox_handling_cycle_transitions_source_scope_fk" FOREIGN KEY ("inbox_item_id", "organization_id", "source_type", "source_id") REFERENCES "public"."inbox_items"("id", "organization_id", "source_type", "source_id") ON DELETE CASCADE;


--
-- Name: inbox_handling_cycles inbox_handling_cycles_inbox_item_id_inbox_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycles"
    ADD CONSTRAINT "inbox_handling_cycles_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE CASCADE;


--
-- Name: inbox_handling_cycles inbox_handling_cycles_material_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycles"
    ADD CONSTRAINT "inbox_handling_cycles_material_revision_fk" FOREIGN KEY ("review_id", "material_review_revision") REFERENCES "public"."material_review_revisions"("review_id", "revision") ON DELETE RESTRICT;


--
-- Name: inbox_handling_cycles inbox_handling_cycles_source_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_handling_cycles"
    ADD CONSTRAINT "inbox_handling_cycles_source_scope_fk" FOREIGN KEY ("inbox_item_id", "organization_id", "source_type", "source_id") REFERENCES "public"."inbox_items"("id", "organization_id", "source_type", "source_id") ON DELETE CASCADE;


--
-- Name: inbox_notes inbox_notes_inbox_item_id_inbox_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_notes"
    ADD CONSTRAINT "inbox_notes_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE CASCADE;


--
-- Name: inbox_priority_history inbox_priority_history_inbox_item_id_inbox_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_priority_history"
    ADD CONSTRAINT "inbox_priority_history_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE CASCADE;


--
-- Name: inbox_private_feedback_target_property_overrides inbox_private_feedback_target_property_overrides_property_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_private_feedback_target_property_overrides"
    ADD CONSTRAINT "inbox_private_feedback_target_property_overrides_property_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: inbox_response_target_exclusions inbox_response_target_exclusions_target_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_response_target_exclusions"
    ADD CONSTRAINT "inbox_response_target_exclusions_target_scope_fk" FOREIGN KEY ("inbox_item_id", "cycle_number", "organization_id", "property_id", "target_kind") REFERENCES "public"."inbox_handling_cycle_response_targets"("inbox_item_id", "cycle_number", "organization_id", "property_id", "target_kind") ON DELETE CASCADE;


--
-- Name: inbox_response_target_reminders inbox_response_target_reminders_target_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."inbox_response_target_reminders"
    ADD CONSTRAINT "inbox_response_target_reminders_target_scope_fk" FOREIGN KEY ("inbox_item_id", "cycle_number", "organization_id", "property_id", "target_kind") REFERENCES "public"."inbox_handling_cycle_response_targets"("inbox_item_id", "cycle_number", "organization_id", "property_id", "target_kind") ON DELETE CASCADE;


--
-- Name: invitation invitation_inviterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."invitation"
    ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE CASCADE;


--
-- Name: invitation invitation_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."invitation"
    ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE CASCADE;


--
-- Name: material_review_revisions material_review_revisions_review_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."material_review_revisions"
    ADD CONSTRAINT "material_review_revisions_review_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "review_id") REFERENCES "public"."reviews"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: member member_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."member"
    ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE CASCADE;


--
-- Name: member member_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."member"
    ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE;


--
-- Name: merchant_ai_consent_evidence merchant_ai_consent_evidence_review_head_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_consent_evidence"
    ADD CONSTRAINT "merchant_ai_consent_evidence_review_head_fk" FOREIGN KEY ("organization_id", "property_id", "authorized_source_epoch") REFERENCES "public"."review_ai_analysis_heads"("organization_id", "property_id", "source_epoch") ON DELETE RESTRICT;


--
-- Name: merchant_ai_consent_evidence merchant_ai_consent_evidence_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_consent_evidence"
    ADD CONSTRAINT "merchant_ai_consent_evidence_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: merchant_ai_decision_deferrals merchant_ai_decision_deferrals_property_id_properties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_decision_deferrals"
    ADD CONSTRAINT "merchant_ai_decision_deferrals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE CASCADE;


--
-- Name: merchant_ai_decision_deferrals merchant_ai_decision_deferrals_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_decision_deferrals"
    ADD CONSTRAINT "merchant_ai_decision_deferrals_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: merchant_ai_enablement merchant_ai_enablement_evidence_head_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_enablement"
    ADD CONSTRAINT "merchant_ai_enablement_evidence_head_fk" FOREIGN KEY ("authorization_lineage_id", "state_version") REFERENCES "public"."merchant_ai_consent_evidence"("authorization_lineage_id", "state_version") ON DELETE RESTRICT;


--
-- Name: merchant_ai_enablement merchant_ai_enablement_property_id_properties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_enablement"
    ADD CONSTRAINT "merchant_ai_enablement_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE CASCADE;


--
-- Name: merchant_ai_enablement merchant_ai_enablement_review_head_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_enablement"
    ADD CONSTRAINT "merchant_ai_enablement_review_head_fk" FOREIGN KEY ("organization_id", "property_id", "authorized_source_epoch") REFERENCES "public"."review_ai_analysis_heads"("organization_id", "property_id", "source_epoch") ON DELETE RESTRICT;


--
-- Name: merchant_ai_enablement merchant_ai_enablement_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_enablement"
    ADD CONSTRAINT "merchant_ai_enablement_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: merchant_ai_notice_update_receipts merchant_ai_notice_update_receipts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_notice_update_receipts"
    ADD CONSTRAINT "merchant_ai_notice_update_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE;


--
-- Name: merchant_ai_notice_update_receipts merchant_ai_notice_update_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."merchant_ai_notice_update_receipts"
    ADD CONSTRAINT "merchant_ai_notice_update_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE;


--
-- Name: metric_corrections metric_corrections_reading_id_metric_readings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_corrections"
    ADD CONSTRAINT "metric_corrections_reading_id_metric_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."metric_readings"("id") ON DELETE RESTRICT;


--
-- Name: metric_corrections metric_corrections_supersedes_correction_id_metric_corrections_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_corrections"
    ADD CONSTRAINT "metric_corrections_supersedes_correction_id_metric_corrections_" FOREIGN KEY ("supersedes_correction_id") REFERENCES "public"."metric_corrections"("id") ON DELETE RESTRICT;


--
-- Name: metric_current_google_reputation_snapshots metric_current_google_reputation_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_current_google_reputation_snapshots"
    ADD CONSTRAINT "metric_current_google_reputation_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: metric_readings metric_readings_group_id_portal_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_readings"
    ADD CONSTRAINT "metric_readings_group_id_portal_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."portal_groups"("id") ON DELETE SET NULL;


--
-- Name: metric_readings metric_readings_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_readings"
    ADD CONSTRAINT "metric_readings_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE CASCADE;


--
-- Name: metric_readings metric_readings_property_id_properties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_readings"
    ADD CONSTRAINT "metric_readings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE CASCADE;


--
-- Name: metric_readings metric_readings_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_readings"
    ADD CONSTRAINT "metric_readings_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: metric_readings metric_readings_staff_participant_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_readings"
    ADD CONSTRAINT "metric_readings_staff_participant_scope_fk" FOREIGN KEY ("organization_id", "property_id", "attributed_staff_participation_id", "attributed_staff_participant_id") REFERENCES "public"."staff_participations"("organization_id", "property_id", "id", "staff_participant_id") ON DELETE RESTRICT;


--
-- Name: metric_readings metric_readings_staff_responsibility_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."metric_readings"
    ADD CONSTRAINT "metric_readings_staff_responsibility_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "attribution_responsibility_id", "attributed_staff_participation_id") REFERENCES "public"."portal_responsibilities"("organization_id", "property_id", "portal_id", "id", "staff_participation_id") ON DELETE RESTRICT;


--
-- Name: notification_digest_batch_members notification_digest_batch_members_batch_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_digest_batch_members"
    ADD CONSTRAINT "notification_digest_batch_members_batch_tenant_fk" FOREIGN KEY ("batch_id", "organization_id", "user_id") REFERENCES "public"."notification_digest_batches"("id", "organization_id", "user_id") ON DELETE CASCADE;


--
-- Name: notification_digest_batch_members notification_digest_batch_members_email_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_digest_batch_members"
    ADD CONSTRAINT "notification_digest_batch_members_email_tenant_fk" FOREIGN KEY ("notification_email_id", "organization_id", "user_id") REFERENCES "public"."notification_email_queue"("id", "organization_id", "user_id") ON DELETE CASCADE;


--
-- Name: notification_email_queue notification_email_queue_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_email_queue"
    ADD CONSTRAINT "notification_email_queue_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: notification_property_delivery_windows notification_property_delivery_windows_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_property_delivery_windows"
    ADD CONSTRAINT "notification_property_delivery_windows_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: notification_unsubscribe_scopes notification_unsubscribe_scopes_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notification_unsubscribe_scopes"
    ADD CONSTRAINT "notification_unsubscribe_scopes_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: notifications notifications_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: organizationRole organizationRole_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organizationRole"
    ADD CONSTRAINT "organizationRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE CASCADE;


--
-- Name: organization_export_retrieval_issuances organization_export_retrieval_issuances_export_id_organization_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."organization_export_retrieval_issuances"
    ADD CONSTRAINT "organization_export_retrieval_issuances_export_id_organization_" FOREIGN KEY ("export_id") REFERENCES "public"."organization_exports"("id");


--
-- Name: outbox_events outbox_events_recovery_fence_run_id_recovery_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox_events"
    ADD CONSTRAINT "outbox_events_recovery_fence_run_id_recovery_runs_id_fk" FOREIGN KEY ("recovery_fence_run_id") REFERENCES "public"."recovery_runs"("id") ON DELETE RESTRICT;


--
-- Name: property_access_grants pag_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_access_grants"
    ADD CONSTRAINT "pag_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: policy_consent policy_consent_organization_id_organization_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."policy_consent"
    ADD CONSTRAINT "policy_consent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE;


--
-- Name: portal_access_artifacts portal_access_artifacts_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_access_artifacts"
    ADD CONSTRAINT "portal_access_artifacts_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_access_artifacts portal_access_artifacts_token_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_access_artifacts"
    ADD CONSTRAINT "portal_access_artifacts_token_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "portal_token_id") REFERENCES "public"."portal_tokens"("organization_id", "property_id", "portal_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_address_downloads portal_address_downloads_token_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_address_downloads"
    ADD CONSTRAINT "portal_address_downloads_token_scope_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "portal_token_id") REFERENCES "public"."portal_tokens"("organization_id", "property_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: portal_approved_destinations portal_approved_destinations_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_approved_destinations"
    ADD CONSTRAINT "portal_approved_destinations_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_goal_prompt_deferrals portal_goal_prompt_deferrals_property_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_goal_prompt_deferrals"
    ADD CONSTRAINT "portal_goal_prompt_deferrals_property_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: portal_group_history portal_group_history_group_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_history"
    ADD CONSTRAINT "portal_group_history_group_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_group_id") REFERENCES "public"."portal_groups"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: portal_group_members portal_group_members_portal_group_id_portal_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_members"
    ADD CONSTRAINT "portal_group_members_portal_group_id_portal_groups_id_fk" FOREIGN KEY ("portal_group_id") REFERENCES "public"."portal_groups"("id") ON DELETE CASCADE;


--
-- Name: portal_group_members portal_group_members_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_members"
    ADD CONSTRAINT "portal_group_members_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE CASCADE;


--
-- Name: portal_group_memberships portal_group_memberships_portal_group_id_portal_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_memberships"
    ADD CONSTRAINT "portal_group_memberships_portal_group_id_portal_groups_id_fk" FOREIGN KEY ("portal_group_id") REFERENCES "public"."portal_groups"("id") ON DELETE RESTRICT;


--
-- Name: portal_group_memberships portal_group_memberships_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_memberships"
    ADD CONSTRAINT "portal_group_memberships_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE RESTRICT;


--
-- Name: portal_group_memberships portal_group_memberships_property_id_properties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_group_memberships"
    ADD CONSTRAINT "portal_group_memberships_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE RESTRICT;


--
-- Name: portal_groups portal_groups_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_groups"
    ADD CONSTRAINT "portal_groups_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_health_intervals portal_health_intervals_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_health_intervals"
    ADD CONSTRAINT "portal_health_intervals_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_last_prints portal_last_prints_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_last_prints"
    ADD CONSTRAINT "portal_last_prints_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: portal_link_categories portal_link_categories_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_link_categories"
    ADD CONSTRAINT "portal_link_categories_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE CASCADE;


--
-- Name: portal_link_categories portal_link_categories_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_link_categories"
    ADD CONSTRAINT "portal_link_categories_portal_tenant_fk" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "public"."portals"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: portal_link_texts portal_link_texts_link_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_link_texts"
    ADD CONSTRAINT "portal_link_texts_link_tenant_fk" FOREIGN KEY ("organization_id", "portal_id", "link_id") REFERENCES "public"."portal_links"("organization_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: portal_link_texts portal_link_texts_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_link_texts"
    ADD CONSTRAINT "portal_link_texts_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: portal_links portal_links_category_id_portal_link_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_links"
    ADD CONSTRAINT "portal_links_category_id_portal_link_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."portal_link_categories"("id") ON DELETE CASCADE;


--
-- Name: portal_links portal_links_category_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_links"
    ADD CONSTRAINT "portal_links_category_tenant_fk" FOREIGN KEY ("organization_id", "portal_id", "category_id") REFERENCES "public"."portal_link_categories"("organization_id", "portal_id", "id") ON DELETE CASCADE;


--
-- Name: portal_links portal_links_destination_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_links"
    ADD CONSTRAINT "portal_links_destination_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "destination_id") REFERENCES "public"."portal_approved_destinations"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_links portal_links_image_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_links"
    ADD CONSTRAINT "portal_links_image_asset_fk" FOREIGN KEY ("organization_id", "property_id", "image_asset_id") REFERENCES "public"."portal_media_assets"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_links portal_links_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_links"
    ADD CONSTRAINT "portal_links_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE CASCADE;


--
-- Name: portal_links portal_links_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_links"
    ADD CONSTRAINT "portal_links_portal_tenant_fk" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "public"."portals"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: portal_links portal_links_property_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_links"
    ADD CONSTRAINT "portal_links_property_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: portal_localized_overrides portal_localized_overrides_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_localized_overrides"
    ADD CONSTRAINT "portal_localized_overrides_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_look_overrides portal_look_overrides_hero_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_look_overrides"
    ADD CONSTRAINT "portal_look_overrides_hero_asset_fk" FOREIGN KEY ("organization_id", "property_id", "hero_asset_id") REFERENCES "public"."portal_media_assets"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_look_overrides portal_look_overrides_logo_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_look_overrides"
    ADD CONSTRAINT "portal_look_overrides_logo_asset_fk" FOREIGN KEY ("organization_id", "property_id", "logo_asset_id") REFERENCES "public"."portal_media_assets"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_look_overrides portal_look_overrides_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_look_overrides"
    ADD CONSTRAINT "portal_look_overrides_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_media_assets portal_media_assets_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_media_assets"
    ADD CONSTRAINT "portal_media_assets_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_metric_lifetime_aggregates portal_metric_lifetime_portal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_metric_lifetime_aggregates"
    ADD CONSTRAINT "portal_metric_lifetime_portal_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: portal_page_edits portal_page_edits_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_page_edits"
    ADD CONSTRAINT "portal_page_edits_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_page_edits portal_page_edits_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_page_edits"
    ADD CONSTRAINT "portal_page_edits_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_pending_content_changes portal_pending_content_changes_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_pending_content_changes"
    ADD CONSTRAINT "portal_pending_content_changes_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_pending_content_changes portal_pending_content_changes_snapshot_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_pending_content_changes"
    ADD CONSTRAINT "portal_pending_content_changes_snapshot_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "resolved_snapshot_id") REFERENCES "public"."portal_publication_snapshots"("organization_id", "property_id", "portal_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_print_wordings portal_print_wordings_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_print_wordings"
    ADD CONSTRAINT "portal_print_wordings_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: portal_publication_activations portal_publication_activations_snapshot_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_publication_activations"
    ADD CONSTRAINT "portal_publication_activations_snapshot_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id", "snapshot_id") REFERENCES "public"."portal_publication_snapshots"("organization_id", "property_id", "portal_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_publication_snapshots portal_publication_snapshots_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_publication_snapshots"
    ADD CONSTRAINT "portal_publication_snapshots_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_responsibilities portal_responsibilities_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsibilities"
    ADD CONSTRAINT "portal_responsibilities_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE RESTRICT;


--
-- Name: portal_responsibilities portal_responsibilities_property_id_properties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsibilities"
    ADD CONSTRAINT "portal_responsibilities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE RESTRICT;


--
-- Name: portal_responsibilities portal_responsibilities_staff_participation_id_staff_participat; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsibilities"
    ADD CONSTRAINT "portal_responsibilities_staff_participation_id_staff_participat" FOREIGN KEY ("staff_participation_id") REFERENCES "public"."staff_participations"("id") ON DELETE RESTRICT;


--
-- Name: portal_tokens portal_tokens_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_tokens"
    ADD CONSTRAINT "portal_tokens_portal_tenant_fk" FOREIGN KEY ("organization_id", "portal_id") REFERENCES "public"."portals"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: portal_tokens portal_tokens_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_tokens"
    ADD CONSTRAINT "portal_tokens_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: portals portals_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portals"
    ADD CONSTRAINT "portals_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_responsibilities pr_participation_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsibilities"
    ADD CONSTRAINT "pr_participation_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "staff_participation_id") REFERENCES "public"."staff_participations"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_responsibilities pr_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsibilities"
    ADD CONSTRAINT "pr_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: portal_responsible_managers prm_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."portal_responsible_managers"
    ADD CONSTRAINT "prm_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: product_update_receipts product_update_receipts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_update_receipts"
    ADD CONSTRAINT "product_update_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE;


--
-- Name: product_update_receipts product_update_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_update_receipts"
    ADD CONSTRAINT "product_update_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE;


--
-- Name: product_update_settings product_update_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_update_settings"
    ADD CONSTRAINT "product_update_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE;


--
-- Name: product_update_settings product_update_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."product_update_settings"
    ADD CONSTRAINT "product_update_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE;


--
-- Name: properties properties_google_connection_id_google_connections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."properties"
    ADD CONSTRAINT "properties_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE SET NULL;


--
-- Name: property_access_grant property_access_grant_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_access_grant"
    ADD CONSTRAINT "property_access_grant_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: property_access_grant property_access_grant_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_access_grant"
    ADD CONSTRAINT "property_access_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE;


--
-- Name: property_access_grants property_access_grants_property_id_properties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_access_grants"
    ADD CONSTRAINT "property_access_grants_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE RESTRICT;


--
-- Name: property_portal_brand_contents property_portal_brand_contents_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_portal_brand_contents"
    ADD CONSTRAINT "property_portal_brand_contents_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: property_portal_brand_profiles property_portal_brand_profiles_hero_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_portal_brand_profiles"
    ADD CONSTRAINT "property_portal_brand_profiles_hero_asset_fk" FOREIGN KEY ("organization_id", "property_id", "hero_asset_id") REFERENCES "public"."portal_media_assets"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: property_portal_brand_profiles property_portal_brand_profiles_logo_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_portal_brand_profiles"
    ADD CONSTRAINT "property_portal_brand_profiles_logo_asset_fk" FOREIGN KEY ("organization_id", "property_id", "logo_asset_id") REFERENCES "public"."portal_media_assets"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: property_portal_brand_profiles property_portal_brand_profiles_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_portal_brand_profiles"
    ADD CONSTRAINT "property_portal_brand_profiles_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: property_rating_goal_changes property_rating_goal_changes_goal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_rating_goal_changes"
    ADD CONSTRAINT "property_rating_goal_changes_goal_fk" FOREIGN KEY ("organization_id", "property_id", "goal_id") REFERENCES "public"."property_rating_goals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: property_rating_goal_deferrals property_rating_goal_deferrals_property_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_rating_goal_deferrals"
    ADD CONSTRAINT "property_rating_goal_deferrals_property_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: property_rating_goals property_rating_goals_property_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_rating_goals"
    ADD CONSTRAINT "property_rating_goals_property_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: property_reply_voices property_reply_voices_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_reply_voices"
    ADD CONSTRAINT "property_reply_voices_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: property_responsible_managers property_rm_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."property_responsible_managers"
    ADD CONSTRAINT "property_rm_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: ratings ratings_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE RESTRICT;


--
-- Name: replies replies_review_id_reviews_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."replies"
    ADD CONSTRAINT "replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE RESTRICT;


--
-- Name: replies replies_review_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."replies"
    ADD CONSTRAINT "replies_review_tenant_fk" FOREIGN KEY ("organization_id", "review_id") REFERENCES "public"."reviews"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: reply_ai_frame_reservations reply_ai_frame_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_ai_frame_reservations"
    ADD CONSTRAINT "reply_ai_frame_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: reply_publication_attempts reply_publication_attempts_authorization_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_attempts"
    ADD CONSTRAINT "reply_publication_attempts_authorization_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "reply_id", "publication_cycle", "source_epoch", "material_review_revision", "reply_state_revision", "normalization_version", "expected_reply_digest") REFERENCES "public"."reply_publication_authorizations"("organization_id", "property_id", "review_id", "reply_id", "publication_cycle", "source_epoch", "material_review_revision", "reply_state_revision", "normalization_version", "expected_reply_digest") ON DELETE RESTRICT;


--
-- Name: reply_publication_attempts reply_publication_attempts_exact_confirmation_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_attempts"
    ADD CONSTRAINT "reply_publication_attempts_exact_confirmation_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "confirmed_observation_revision", "reply_id", "publication_cycle", "attempt_number", "source_epoch", "material_review_revision") REFERENCES "public"."google_reply_observations"("organization_id", "property_id", "review_id", "observation_revision", "matched_reply_id", "matched_publication_cycle", "matched_attempt_number", "source_epoch", "material_review_revision") ON DELETE RESTRICT;


--
-- Name: reply_publication_attempts reply_publication_attempts_material_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_attempts"
    ADD CONSTRAINT "reply_publication_attempts_material_revision_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id", "property_id", "review_id", "source_epoch", "revision") ON DELETE RESTRICT;


--
-- Name: reply_publication_attempts reply_publication_attempts_reply_binding_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_attempts"
    ADD CONSTRAINT "reply_publication_attempts_reply_binding_fk" FOREIGN KEY ("organization_id", "review_id", "reply_id") REFERENCES "public"."replies"("organization_id", "review_id", "id") ON DELETE RESTRICT;


--
-- Name: reply_publication_attempts reply_publication_attempts_review_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_attempts"
    ADD CONSTRAINT "reply_publication_attempts_review_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "review_id") REFERENCES "public"."reviews"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: reply_publication_authorizations reply_publication_authorizations_material_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_authorizations"
    ADD CONSTRAINT "reply_publication_authorizations_material_revision_fk" FOREIGN KEY ("organization_id", "property_id", "review_id", "source_epoch", "material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id", "property_id", "review_id", "source_epoch", "revision") ON DELETE RESTRICT;


--
-- Name: reply_publication_authorizations reply_publication_authorizations_reply_binding_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_authorizations"
    ADD CONSTRAINT "reply_publication_authorizations_reply_binding_fk" FOREIGN KEY ("organization_id", "review_id", "reply_id") REFERENCES "public"."replies"("organization_id", "review_id", "id") ON DELETE RESTRICT;


--
-- Name: reply_publication_authorizations reply_publication_authorizations_review_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_publication_authorizations"
    ADD CONSTRAINT "reply_publication_authorizations_review_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "review_id") REFERENCES "public"."reviews"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: reply_template_revisions reply_template_revisions_template_id_reply_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_template_revisions"
    ADD CONSTRAINT "reply_template_revisions_template_id_reply_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."reply_templates"("id") ON DELETE RESTRICT;


--
-- Name: reply_template_visibility reply_template_visibility_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_template_visibility"
    ADD CONSTRAINT "reply_template_visibility_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: reply_template_visibility reply_template_visibility_template_id_reply_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_template_visibility"
    ADD CONSTRAINT "reply_template_visibility_template_id_reply_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."reply_templates"("id") ON DELETE RESTRICT;


--
-- Name: reply_template_wordings reply_template_wordings_revision_id_reply_template_revisions_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_template_wordings"
    ADD CONSTRAINT "reply_template_wordings_revision_id_reply_template_revisions_id" FOREIGN KEY ("revision_id") REFERENCES "public"."reply_template_revisions"("id") ON DELETE RESTRICT;


--
-- Name: reply_templates reply_templates_based_on_template_id_reply_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_templates"
    ADD CONSTRAINT "reply_templates_based_on_template_id_reply_templates_id_fk" FOREIGN KEY ("based_on_template_id") REFERENCES "public"."reply_templates"("id") ON DELETE RESTRICT;


--
-- Name: reply_templates reply_templates_current_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_templates"
    ADD CONSTRAINT "reply_templates_current_revision_fk" FOREIGN KEY ("id", "current_revision_id") REFERENCES "public"."reply_template_revisions"("template_id", "id") ON DELETE RESTRICT;


--
-- Name: reply_templates reply_templates_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reply_templates"
    ADD CONSTRAINT "reply_templates_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: review_ai_analysis_heads review_ai_analysis_heads_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_ai_analysis_heads"
    ADD CONSTRAINT "review_ai_analysis_heads_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: review_ai_analysis_released_sequences review_ai_analysis_released_sequences_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_ai_analysis_released_sequences"
    ADD CONSTRAINT "review_ai_analysis_released_sequences_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: review_first_sightings review_first_sightings_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_first_sightings"
    ADD CONSTRAINT "review_first_sightings_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: review_google_reputation_snapshot_facts review_google_reputation_snapshot_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_google_reputation_snapshot_facts"
    ADD CONSTRAINT "review_google_reputation_snapshot_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: review_provider_deletion_candidates review_provider_deletion_candidates_run_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_deletion_candidates"
    ADD CONSTRAINT "review_provider_deletion_candidates_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."review_provider_snapshot_runs"("id") ON DELETE CASCADE;


--
-- Name: review_provider_history_cutoffs review_provider_history_cutoffs_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_history_cutoffs"
    ADD CONSTRAINT "review_provider_history_cutoffs_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: review_provider_snapshot_members review_provider_snapshot_members_run_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_snapshot_members"
    ADD CONSTRAINT "review_provider_snapshot_members_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."review_provider_snapshot_runs"("id") ON DELETE CASCADE;


--
-- Name: review_provider_snapshot_runs review_provider_snapshot_runs_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_snapshot_runs"
    ADD CONSTRAINT "review_provider_snapshot_runs_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: review_provider_subjects review_provider_subjects_key_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_subjects"
    ADD CONSTRAINT "review_provider_subjects_key_version_fk" FOREIGN KEY ("key_version") REFERENCES "public"."review_provider_subject_hmac_key_versions"("key_version") ON DELETE RESTRICT;


--
-- Name: review_provider_subjects review_provider_subjects_last_seen_run_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_subjects"
    ADD CONSTRAINT "review_provider_subjects_last_seen_run_fk" FOREIGN KEY ("last_seen_snapshot_run_id") REFERENCES "public"."review_provider_snapshot_runs"("id") ON DELETE SET NULL;


--
-- Name: review_provider_subjects review_provider_subjects_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_provider_subjects"
    ADD CONSTRAINT "review_provider_subjects_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: review_source_contents review_source_contents_google_connection_id_google_connections_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_source_contents"
    ADD CONSTRAINT "review_source_contents_google_connection_id_google_connections_" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE SET NULL;


--
-- Name: review_source_contents review_source_contents_review_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_source_contents"
    ADD CONSTRAINT "review_source_contents_review_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "review_id") REFERENCES "public"."reviews"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: review_source_observations review_source_observations_material_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_source_observations"
    ADD CONSTRAINT "review_source_observations_material_revision_fk" FOREIGN KEY ("review_id", "material_revision") REFERENCES "public"."material_review_revisions"("review_id", "revision") ON DELETE RESTRICT;


--
-- Name: review_source_observations review_source_observations_review_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."review_source_observations"
    ADD CONSTRAINT "review_source_observations_review_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "review_id") REFERENCES "public"."reviews"("organization_id", "property_id", "id") ON DELETE CASCADE;


--
-- Name: reviews reviews_google_connection_id_google_connections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE SET NULL;


--
-- Name: reviews reviews_property_id_properties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE CASCADE;


--
-- Name: reviews reviews_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE CASCADE;


--
-- Name: scan_events scan_events_portal_id_portals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_events"
    ADD CONSTRAINT "scan_events_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE RESTRICT;


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."session"
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE;


--
-- Name: staff_participations sp_participant_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_participations"
    ADD CONSTRAINT "sp_participant_tenant_fk" FOREIGN KEY ("organization_id", "staff_participant_id") REFERENCES "public"."staff_participants"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: staff_participations sp_personal_portal_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_participations"
    ADD CONSTRAINT "sp_personal_portal_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "personal_portal_id") REFERENCES "public"."portals"("organization_id", "property_id", "id") ON DELETE RESTRICT;


--
-- Name: staff_participations sp_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_participations"
    ADD CONSTRAINT "sp_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: staff_onboardings staff_onboardings_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_onboardings"
    ADD CONSTRAINT "staff_onboardings_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: staff_participations staff_participations_property_id_properties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_participations"
    ADD CONSTRAINT "staff_participations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE RESTRICT;


--
-- Name: staff_property_settings staff_property_settings_property_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_property_settings"
    ADD CONSTRAINT "staff_property_settings_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "public"."properties"("organization_id", "id") ON DELETE RESTRICT;


--
-- Name: staff_user_links staff_user_links_participant_tenant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."staff_user_links"
    ADD CONSTRAINT "staff_user_links_participant_tenant_fk" FOREIGN KEY ("organization_id", "staff_participant_id") REFERENCES "public"."staff_participants"("organization_id", "id") ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--
