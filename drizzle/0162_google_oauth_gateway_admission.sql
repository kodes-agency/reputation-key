-- SAFE-04: admit credential-bearing OAuth exchange only through the same
-- one-use, approval-bound Google gateway permit as every other provider route.
-- A first exchange is bound to a prospective connection UUID and to the
-- canonical Organization credential-home row reserved before provider egress.
CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v2(
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
  -- Preserve the established authority for every non-exchange route. The new
  -- branch is intentionally exact rather than a broader relaxation of v1.
  IF p_route_key <> 'oauth.token.exchange' THEN
    RETURN QUERY
    SELECT legacy.outcome
    FROM public.start_google_execution_permit_v1(
      p_permit_id,
      p_permit_generation,
      p_policy_version,
      p_emergency_kill_version,
      p_route_key,
      p_route_catalog_version,
      p_quota_policy_id,
      p_authorization_vector,
      p_release_sha
    ) AS legacy;
    RETURN;
  END IF;

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
            FROM public.policy_version AS policy
            INNER JOIN public.capability_execution_control AS control
              ON control.capability = permit.capability
            INNER JOIN public.capability_compliance_approvals AS approval
              ON approval.id = permit.approval_binding_id
             AND approval.capability = permit.capability
            INNER JOIN public.member AS member
              ON member."organizationId" = permit.organization_id
             AND member."userId" = permit.initiator_user_id
            INNER JOIN public.permission_version AS permission
              ON permission.organization_id = permit.organization_id
            INNER JOIN public.google_organization_credential_homes AS home
              ON home.organization_id = permit.organization_id
             AND home.superseded_at IS NULL
            LEFT JOIN public.google_connections AS connection
              ON connection.organization_id = permit.organization_id
             AND connection.id = permit.connection_id
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
              AND permit.authorization_vector->>'googleContentPolicyVersion' ~
                '^(0|[1-9][0-9]*)$'
              AND policy.version::text =
                permit.authorization_vector->>'googleContentPolicyVersion'
              AND permit.authorization_vector->>'emergencyKillVersion' ~
                '^(0|[1-9][0-9]*)$'
              AND policy.emergency_kill_version::text =
                permit.authorization_vector->>'emergencyKillVersion'
              AND home.home_cell_id =
                permit.authorization_vector->>'credentialHomeCellId'
              AND home.catalogue_policy_version::text =
                permit.authorization_vector->>'credentialHomePolicyVersion'
              AND home.authority_generation::text =
                permit.authorization_vector->>'credentialHomeAuthorityGeneration'
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
                  AND (
                    (
                      connection.credential_home_cell_id = home.home_cell_id
                      AND connection.credential_home_policy_version =
                        home.catalogue_policy_version
                      AND connection.credential_home_authority_generation =
                        home.authority_generation
                    )
                    OR (
                      connection.status = 'disconnected'
                      AND connection.credential_use_state = 'none'
                      AND connection.credential_home_cell_id IS NULL
                      AND connection.credential_home_policy_version IS NULL
                      AND connection.credential_home_authority_generation IS NULL
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
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.start_google_execution_permit_v2(
  uuid, bigint, bigint, bigint, text, text, text, jsonb, text
) FROM PUBLIC;
