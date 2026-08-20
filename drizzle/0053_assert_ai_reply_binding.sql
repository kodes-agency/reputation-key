CREATE FUNCTION "assert_current_ai_draft_binding_v1"(
  organization_id_value text,
  reply_id_value uuid
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  property_id_value uuid;
  review_id_value uuid;
  operation_id_value uuid;
  provider_profile_value text;
  reply_row record;
  review_row record;
  property_row record;
  profile_row record;
  authorization_row record;
  operation_row record;
  binding_is_current boolean;
BEGIN
  SELECT
    reply."review_id",
    review."property_id",
    reply."origin_operation_id",
    operation."provider_deployment_profile_version"
  INTO
    review_id_value,
    property_id_value,
    operation_id_value,
    provider_profile_value
  FROM "replies" AS reply
  JOIN "reviews" AS review
    ON review."id" = reply."review_id"
   AND review."organization_id" = reply."organization_id"
  LEFT JOIN "ai_operations" AS operation
    ON operation."id" = reply."origin_operation_id"
  WHERE reply."id" = reply_id_value
    AND reply."organization_id" = organization_id_value;

  IF NOT FOUND THEN RETURN 'not_ai'; END IF;

  PERFORM 1
  FROM "ai_execution_control_heads"
  WHERE "scope_key" IN (
    'global',
    'provider:' || COALESCE(provider_profile_value, ''),
    'capability:reply_drafting'
  )
  ORDER BY "scope_key"
  FOR UPDATE;

  SELECT
    property."organization_id",
    property."profile_version",
    property."source_epoch",
    property."lifecycle_state",
    property."deleted_at"
  INTO property_row
  FROM "properties" AS property
  WHERE property."id" = property_id_value
    AND property."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT profile.*
  INTO profile_row
  FROM "ai_property_processing_profiles" AS profile
  WHERE profile."property_id" = property_id_value
    AND profile."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT enablement.*
  INTO authorization_row
  FROM "merchant_ai_enablement" AS enablement
  WHERE enablement."property_id" = property_id_value
    AND enablement."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT
    review."property_id",
    review."source_epoch",
    review."source_revision",
    review."content_expires_at"
  INTO review_row
  FROM "reviews" AS review
  WHERE review."id" = review_id_value
    AND review."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT reply.*
  INTO reply_row
  FROM "replies" AS reply
  WHERE reply."id" = reply_id_value
    AND reply."organization_id" = organization_id_value
  FOR UPDATE;

  IF NOT FOUND OR reply_row."authorship" IS DISTINCT FROM 'ai_assisted' THEN
    RETURN 'not_ai';
  END IF;

  SELECT operation.*
  INTO operation_row
  FROM "ai_operations" AS operation
  WHERE operation."id" = reply_row."origin_operation_id"
  FOR UPDATE;

  binding_is_current :=
    property_row."organization_id" = organization_id_value
    AND property_row."deleted_at" IS NULL
    AND property_row."lifecycle_state" = 'active'
    AND property_row."source_epoch" = reply_row."origin_source_epoch"
    AND profile_row."organization_id" = organization_id_value
    AND profile_row."property_id" = property_id_value
    AND profile_row."lifecycle_state" = 'active'
    AND profile_row."source_epoch" = reply_row."origin_source_epoch"
    AND profile_row."profile_version" = reply_row."origin_property_profile_version"
    AND review_row."property_id" = property_id_value
    AND review_row."source_epoch" = reply_row."origin_source_epoch"
    AND review_row."source_revision" = reply_row."origin_source_revision"
    AND review_row."content_expires_at" > transaction_timestamp()
    AND reply_row."ai_draft_expires_at" > transaction_timestamp()
    AND authorization_row."organization_id" = organization_id_value
    AND authorization_row."property_id" = property_id_value
    AND authorization_row."state" = 'enabled'
    AND authorization_row."authorized_source_epoch" = reply_row."origin_source_epoch"
    AND authorization_row."reply_drafting_epoch" = reply_row."origin_reply_drafting_epoch"
    AND authorization_row."capabilities" @> ARRAY['reply_drafting']::text[]
    AND authorization_row."capability_runtime_profile_versions"->>'reply_drafting' = 'reply-drafting-runtime-v1'
    AND operation_row."id" = reply_row."origin_operation_id"
    AND operation_row."command" = 'reply'
    AND operation_row."capability" = 'reply_drafting'
    AND operation_row."organization_id" = organization_id_value
    AND operation_row."property_id" = property_id_value
    AND operation_row."review_id" = review_id_value
    AND operation_row."source_epoch" = reply_row."origin_source_epoch"
    AND operation_row."source_revision" = reply_row."origin_source_revision"
    AND operation_row."property_profile_version" = reply_row."origin_property_profile_version"
    AND operation_row."operation_profile_version" = reply_row."origin_ai_profile_version"
    AND operation_row."operation_profile_version" = 'reply-suggestion-v1'
    AND operation_row."capability_runtime_profile_version" = 'reply-drafting-runtime-v1'
    AND operation_row."provider_deployment_profile_version" = profile_row."provider_deployment_profile_version"
    AND operation_row."provider_deployment_profile_version" = authorization_row."provider_deployment_profile_version"
    AND operation_row."authorization_lineage_id" = authorization_row."authorization_lineage_id"
    AND operation_row."reply_adoption_disposition" = 'adopted'
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'global'
        AND head."control_id" = operation_row."global_control_id"
        AND head."generation" = operation_row."global_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    )
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'provider:' || operation_row."provider_deployment_profile_version"
        AND head."control_id" = operation_row."provider_control_id"
        AND head."generation" = operation_row."provider_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    )
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'capability:reply_drafting'
        AND head."control_id" = operation_row."capability_control_id"
        AND head."generation" = operation_row."capability_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    );

  IF binding_is_current THEN RETURN 'current'; END IF;

  DELETE FROM "replies"
  WHERE "id" = reply_id_value
    AND "organization_id" = organization_id_value
    AND "authorship" = 'ai_assisted'
    AND ("publication_state" IS NULL OR "publication_state" = 'authorized');

  IF FOUND THEN RETURN 'stale'; END IF;
  RETURN 'current';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "purge_ai_reply_drafts_for_review_change_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source_epoch" IS DISTINCT FROM OLD."source_epoch"
    OR NEW."source_revision" IS DISTINCT FROM OLD."source_revision"
    OR NEW."content_expires_at" IS DISTINCT FROM OLD."content_expires_at"
  THEN
    DELETE FROM "replies"
    WHERE "review_id" = NEW."id"
      AND "organization_id" = NEW."organization_id"
      AND "authorship" = 'ai_assisted'
      AND ("publication_state" IS NULL OR "publication_state" = 'authorized');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "reviews_purge_ai_reply_drafts"
AFTER UPDATE ON "reviews"
FOR EACH ROW
EXECUTE FUNCTION "purge_ai_reply_drafts_for_review_change_v1"();--> statement-breakpoint
CREATE FUNCTION "purge_ai_reply_drafts_for_property_change_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source_epoch" IS DISTINCT FROM OLD."source_epoch"
    OR NEW."lifecycle_state" IS DISTINCT FROM OLD."lifecycle_state"
    OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
  THEN
    DELETE FROM "replies" AS reply
    USING "reviews" AS review
    WHERE reply."review_id" = review."id"
      AND reply."organization_id" = review."organization_id"
      AND review."property_id" = NEW."id"
      AND review."organization_id" = NEW."organization_id"
      AND reply."authorship" = 'ai_assisted'
      AND (reply."publication_state" IS NULL OR reply."publication_state" = 'authorized');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "properties_purge_ai_reply_drafts"
AFTER UPDATE ON "properties"
FOR EACH ROW
EXECUTE FUNCTION "purge_ai_reply_drafts_for_property_change_v1"();--> statement-breakpoint
CREATE FUNCTION "purge_ai_reply_drafts_for_profile_change_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source_epoch" IS DISTINCT FROM OLD."source_epoch"
    OR NEW."profile_version" IS DISTINCT FROM OLD."profile_version"
    OR NEW."lifecycle_state" IS DISTINCT FROM OLD."lifecycle_state"
    OR NEW."provider_deployment_profile_version" IS DISTINCT FROM OLD."provider_deployment_profile_version"
  THEN
    DELETE FROM "replies" AS reply
    USING "reviews" AS review
    WHERE reply."review_id" = review."id"
      AND reply."organization_id" = review."organization_id"
      AND review."property_id" = NEW."property_id"
      AND review."organization_id" = NEW."organization_id"
      AND reply."authorship" = 'ai_assisted'
      AND (reply."publication_state" IS NULL OR reply."publication_state" = 'authorized');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_property_profiles_purge_ai_reply_drafts"
AFTER UPDATE ON "ai_property_processing_profiles"
FOR EACH ROW
EXECUTE FUNCTION "purge_ai_reply_drafts_for_profile_change_v1"();--> statement-breakpoint
CREATE FUNCTION "purge_ai_reply_drafts_for_authorization_change_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."state" IS DISTINCT FROM OLD."state"
    OR NEW."capabilities" IS DISTINCT FROM OLD."capabilities"
    OR NEW."capability_runtime_profile_versions" IS DISTINCT FROM OLD."capability_runtime_profile_versions"
    OR NEW."reply_drafting_epoch" IS DISTINCT FROM OLD."reply_drafting_epoch"
    OR NEW."authorized_source_epoch" IS DISTINCT FROM OLD."authorized_source_epoch"
    OR NEW."authorization_lineage_id" IS DISTINCT FROM OLD."authorization_lineage_id"
    OR NEW."provider_deployment_profile_version" IS DISTINCT FROM OLD."provider_deployment_profile_version"
  THEN
    DELETE FROM "replies" AS reply
    USING "reviews" AS review
    WHERE reply."review_id" = review."id"
      AND reply."organization_id" = review."organization_id"
      AND review."property_id" = NEW."property_id"
      AND review."organization_id" = NEW."organization_id"
      AND reply."authorship" = 'ai_assisted'
      AND (reply."publication_state" IS NULL OR reply."publication_state" = 'authorized');
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "merchant_ai_enablement_purge_ai_reply_drafts"
AFTER UPDATE ON "merchant_ai_enablement"
FOR EACH ROW
EXECUTE FUNCTION "purge_ai_reply_drafts_for_authorization_change_v1"();--> statement-breakpoint
CREATE FUNCTION "purge_ai_reply_drafts_for_control_change_v1"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."control_id" IS DISTINCT FROM OLD."control_id"
    OR NEW."generation" IS DISTINCT FROM OLD."generation"
    OR NEW."execution_state" IS DISTINCT FROM OLD."execution_state"
    OR NEW."admission_state" IS DISTINCT FROM OLD."admission_state"
  THEN
    DELETE FROM "replies" AS reply
    USING "ai_operations" AS operation
    WHERE reply."origin_operation_id" = operation."id"
      AND reply."authorship" = 'ai_assisted'
      AND (reply."publication_state" IS NULL OR reply."publication_state" = 'authorized')
      AND (
        (NEW."scope_kind" = 'global')
        OR (
          NEW."scope_kind" = 'provider_deployment_profile'
          AND operation."provider_deployment_profile_version" = NEW."scope_value"
        )
        OR (
          NEW."scope_kind" = 'capability'
          AND NEW."scope_value" = 'reply_drafting'
          AND operation."capability" = 'reply_drafting'
        )
      );
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_execution_controls_purge_ai_reply_drafts"
AFTER UPDATE ON "ai_execution_control_heads"
FOR EACH ROW
EXECUTE FUNCTION "purge_ai_reply_drafts_for_control_change_v1"();