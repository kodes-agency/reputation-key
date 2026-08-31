-- Google execution admission is a separate trust boundary. Its login receives
-- EXECUTE on the four operations below and no table/sequence privileges. The
-- functions own all permit reads and transitions so a compromised sidecar
-- cannot browse or mutate unrelated application data.
CREATE OR REPLACE FUNCTION public.google_execution_permit_revision_v1(
  p_permit public.authorization_execution_permits
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    p_permit.id,
    p_permit.permit_generation,
    p_permit.policy_version,
    p_permit.emergency_kill_version,
    p_permit.route_key,
    p_permit.capability,
    p_permit.scope_schema_version,
    p_permit.organization_id,
    p_permit.property_id,
    p_permit.connection_id,
    p_permit.initiator_user_id,
    p_permit.operation_key,
    p_permit.approval_binding_id,
    p_permit.route_catalog_version,
    p_permit.quota_policy_id,
    p_permit.start_vector_mode,
    p_permit.commit_vector_mode,
    p_permit.authorization_vector,
    p_permit.admitted_at,
    p_permit.start_deadline_at
  )::text, 'UTF8')), 'hex')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.google_execution_permit_revision_v1(
  public.authorization_execution_permits
) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.load_google_execution_permit_v1(
  p_permit_id uuid
) RETURNS TABLE (
  id uuid,
  capability text,
  route_key text,
  route_catalog_version text,
  quota_policy_id text,
  permit_generation bigint,
  policy_version bigint,
  emergency_kill_version bigint,
  approval_binding_id uuid,
  authorization_vector jsonb,
  state text,
  start_deadline_at timestamptz,
  organization_id text,
  property_id uuid,
  connection_id uuid,
  initiator_user_id text,
  authority_revision text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    permit.id,
    permit.capability::text,
    permit.route_key::text,
    permit.route_catalog_version::text,
    permit.quota_policy_id::text,
    permit.permit_generation,
    permit.policy_version,
    permit.emergency_kill_version,
    permit.approval_binding_id,
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.load_google_execution_permit_v1(uuid) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v1(
  p_permit_id uuid,
  p_permit_generation bigint,
  p_policy_version bigint,
  p_emergency_kill_version bigint,
  p_route_key text,
  p_route_catalog_version text,
  p_quota_policy_id text,
  p_authorization_vector jsonb,
  p_release_sha text
) RETURNS TABLE (outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation_deadline_at timestamptz := v_now + interval '30 seconds';
BEGIN
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
          FROM public.policy_version AS policy
          INNER JOIN public.capability_execution_control AS control
            ON control.capability = permit.capability
          INNER JOIN public.capability_compliance_approvals AS approval
            ON approval.id = permit.approval_binding_id
           AND approval.capability = permit.capability
          INNER JOIN public.member AS member
            ON member."organizationId" = permit.organization_id
           AND member."userId" = permit.initiator_user_id
          INNER JOIN public.google_connections AS connection
            ON connection.id = permit.connection_id
           AND connection.organization_id = permit.organization_id
          WHERE policy.scope = 'global'
            AND policy.version = permit.policy_version
            AND policy.emergency_kill_version = permit.emergency_kill_version
            AND control.denied = false
            AND control.emergency_kill_version = policy.emergency_kill_version
            AND approval.status = 'approved'
            AND approval.release_sha = p_release_sha
            AND approval.route_catalog_version = permit.route_catalog_version
            AND approval.execution_policy_version =
              permit.authorization_vector->>'executionPolicyVersion'
            AND approval.google_project_attestation_sha256 =
              permit.authorization_vector->>'projectFingerprint'
            AND approval.approved_at <= v_now
            AND approval.expires_at > v_now
            AND (
              approval.target_phase <> 'railway_closed_beta'
              OR approval.railway_closed_beta_cohort @>
                to_jsonb(ARRAY[permit.organization_id]::text[])
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.capability_compliance_approvals AS newer
              WHERE newer.capability = approval.capability
                AND newer.target_phase = approval.target_phase
                AND newer.environment_profile = approval.environment_profile
                AND newer.binding_version > approval.binding_version
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.organization_policy AS organization_policy
              WHERE organization_policy.organization_id = permit.organization_id
                AND organization_policy.suspended_at IS NOT NULL
            )
            AND EXISTS (
              SELECT 1
              FROM public.organization_capability AS organization_capability
              WHERE organization_capability.organization_id = permit.organization_id
                AND organization_capability.capability = permit.capability::text
            )
            AND (
              (member.role = 'owner'
                AND permit.authorization_vector->>'role' = 'AccountAdmin')
              OR (member.role = 'admin'
                AND permit.authorization_vector->>'role' = 'PropertyManager')
              OR (member.role = 'member'
                AND permit.authorization_vector->>'role' = 'Staff'
                AND permit.capability = 'property.read_gbp_performance')
            )
            AND permit.authorization_vector->>'permissionDigest' ~ '^[a-f0-9]{64}$'
            AND connection.status = 'active'
            AND connection.credential_use_state = 'active'
            AND (
              connection.visibility = 'organization'
              OR connection.connected_by = permit.initiator_user_id
            )
            AND connection.lifecycle_version =
              (permit.authorization_vector->>'connectionLifecycleVersion')::bigint
            AND connection.access_version =
              (permit.authorization_vector->>'connectionAccessVersion')::bigint
            AND connection.credential_generation =
              (permit.authorization_vector->>'credentialGeneration')::bigint
            AND (permit.authorization_vector->>'googleContentPolicyVersion')::bigint =
              policy.version
            AND (permit.authorization_vector->>'emergencyKillVersion')::bigint =
              policy.emergency_kill_version
            AND (
              permit.property_id IS NULL
              OR (
                NOT EXISTS (
                  SELECT 1
                  FROM public.property_policy AS property_policy
                  WHERE property_policy.property_id = permit.property_id
                    AND property_policy.suspended_at IS NOT NULL
                )
                AND EXISTS (
                  SELECT 1
                  FROM public.property_capability AS property_capability
                  WHERE property_capability.property_id = permit.property_id
                    AND property_capability.capability = permit.capability::text
                )
                AND (
                  member.role = 'owner'
                  OR EXISTS (
                    SELECT 1
                    FROM public.property_access_grant AS access_grant
                    WHERE access_grant.organization_id = permit.organization_id
                      AND access_grant.property_id = permit.property_id
                      AND access_grant.user_id = permit.initiator_user_id
                      AND access_grant.revoked_at IS NULL
                      AND (access_grant.expires_at IS NULL OR access_grant.expires_at > v_now)
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
                    AND property.source_epoch =
                      (permit.authorization_vector->>'propertySourceEpoch')::bigint
                    AND property.profile_version =
                      (permit.authorization_vector->>'propertyProfileVersion')::bigint
                    AND property.google_binding_state =
                      permit.authorization_vector->>'propertyBindingState'
                    AND property.lifecycle_state =
                      permit.authorization_vector->>'propertyLifecycleState'
                    AND property.profile_source =
                      permit.authorization_vector->>'propertyProfileSource'
                    AND (property.profile_confirmed_at IS NOT NULL) =
                      (permit.authorization_vector->>'propertyTimezoneConfirmed')::boolean
                    AND (
                      permit.capability <> 'property.read_gbp_performance'
                      OR (
                        property.profile_source = 'tenant_confirmed'
                        AND property.profile_confirmed_at IS NOT NULL
                      )
                    )
                )
              )
            )
          )
        ) OR (
          -- Cleanup is an already-authorized drain, not ordinary capability
          -- work. It must remain executable after a kill, membership removal,
          -- or a connection entering cleanup_only; its authority instead comes
          -- from the one-use revoke permit and serialized subject guard.
          permit.route_key = 'oauth.revoke'
          AND permit.property_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM public.capability_compliance_approvals AS approval
            INNER JOIN public.credential_revoke_permits AS revoke
              ON revoke.cleanup_work_permit_id = permit.id
            INNER JOIN public.google_credential_source_operations AS source
              ON source.id = revoke.source_operation_id
             AND source.guard_id = revoke.guard_id
            INNER JOIN public.google_subject_authority_guards AS guard
              ON guard.id = revoke.guard_id
            WHERE approval.id = permit.approval_binding_id
              AND approval.capability = permit.capability
              AND approval.release_sha = p_release_sha
              AND approval.route_catalog_version = permit.route_catalog_version
              AND approval.execution_policy_version =
                permit.authorization_vector->>'executionPolicyVersion'
              AND approval.google_project_attestation_sha256 =
                permit.authorization_vector->>'projectFingerprint'
              -- The binding was valid when ordinary authority admitted this
              -- cleanup permit. Later kill/revocation may stop new source work,
              -- but cannot strand an exact-token revocation already dispatching.
              AND approval.status = 'approved'
              AND approval.approved_at <= permit.admitted_at
              AND approval.expires_at > permit.admitted_at
              AND (
                approval.target_phase <> 'railway_closed_beta'
                OR approval.railway_closed_beta_cohort @>
                  to_jsonb(ARRAY[permit.organization_id]::text[])
              )
              AND revoke.state = 'dispatching'
              AND revoke.cleanup_deadline_at > v_now
              AND revoke.activated_at IS NOT NULL
              AND revoke.dispatching_at IS NOT NULL
              AND revoke.terminal_at IS NULL
              AND revoke.token_hmac IS NULL
              AND revoke.token_hmac_key_version IS NULL
              AND revoke.send_authorization_expires_at IS NULL
              AND permit.admitted_at <= revoke.dispatching_at
              AND source.organization_id = permit.organization_id
              AND source.connection_id IS NOT DISTINCT FROM permit.connection_id
              AND source.source_work_permit_id <> permit.id
              AND source.state = 'terminal'
              AND source.provider_started_at IS NOT NULL
              AND source.terminal_at IS NOT NULL
              AND source.terminal_at <= revoke.dispatching_at
              AND guard.state = 'cleanup_pending'
              AND guard.active_source_operation_id IS NULL
              AND guard.source_cutoff_sequence = source.sequence
              AND guard.cleanup_deadline_at = revoke.cleanup_deadline_at
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
      AND candidate.permit_generation = p_permit_generation
      AND candidate.policy_version = p_policy_version
      AND candidate.emergency_kill_version = p_emergency_kill_version
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.start_google_execution_permit_v1(
  uuid, bigint, bigint, bigint, text, text, text, jsonb, text
) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.fail_google_execution_permit_v1(
  p_permit_id uuid,
  p_permit_generation bigint,
  p_policy_version bigint,
  p_emergency_kill_version bigint,
  p_route_key text,
  p_route_catalog_version text,
  p_quota_policy_id text,
  p_code text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
    AND permit.permit_generation = p_permit_generation
    AND permit.policy_version = p_policy_version
    AND permit.emergency_kill_version = p_emergency_kill_version
    AND permit.route_key = p_route_key
    AND permit.route_catalog_version = p_route_catalog_version
    AND permit.quota_policy_id = p_quota_policy_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fail_google_execution_permit_v1(
  uuid, bigint, bigint, bigint, text, text, text, text
) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.complete_google_execution_permit_v1(
  p_permit_id uuid,
  p_authority_revision text,
  p_outcome text,
  p_retry_after_ms integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_google_execution_permit_v1(
  uuid, text, text, integer
) FROM PUBLIC;
