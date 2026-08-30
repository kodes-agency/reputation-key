-- Google core capabilities can start an execution permit.
--
-- start_google_execution_permit_v1 is the FINAL start authority: the admission
-- service calls v3, which delegates to v2, which delegates to this body for
-- every route other than oauth.revoke and oauth.token.exchange. Its predicate
-- required an organization_capability AND a property_capability row for the
-- permit's capability.
--
-- `property.connect_gbp` and `property.publish_reply` are CORE capabilities
-- (src/shared/auth/beta-capabilities.ts). Those two tables are the NON-CORE
-- cohort allowlists, and nothing in the product ever writes a row in them for a
-- core capability -- setOrgCapability and setPropertyCapability throw on one by
-- design. The rows could therefore never exist, in any environment, so the CASE
-- always fell through to 'changed' and every start was fenced: review sync and
-- reply publication had never completed a single provider call. In this
-- database, property.connect_gbp had 1618 permits fenced with
-- correlation_id = 'authorization_changed' and zero ever started, while the two
-- NON-core Google capabilities, which do have allowlist rows, completed
-- normally.
--
-- checkScopedCapability and policyAuthorizes both exempt core capabilities from
-- these two allowlists already. This makes the database agree with them.
--
-- ONLY the two allowlist EXISTS clauses change. Every other conjunct is
-- untouched, including all of the replay protection: the single-use
-- state = 'admitted' transition, permit_generation equality, the policy,
-- emergency-kill, route_key, route_catalog_version and quota_policy_id
-- equalities, the request-scoped shape checks, and
-- authorization_vector @> p_authorization_vector. Organization and property
-- suspension, connection ownership and approval currency are also unchanged --
-- a core capability is still refused when the tenant is suspended or the kill
-- switch is thrown.
--
-- The two capabilities are named literally rather than derived, because the
-- database has no view of CORE_CAPABILITIES. If a third core Google content
-- capability is ever added, this predicate must be extended with it; the
-- google-content capability set is small and closed, and an explicit list is
-- auditable in a SECURITY DEFINER function in a way a join would not be.

CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v1(p_permit_id uuid, p_permit_generation bigint, p_policy_version bigint, p_emergency_kill_version bigint, p_route_key text, p_route_catalog_version text, p_quota_policy_id text, p_authorization_vector jsonb, p_release_sha text)
 RETURNS TABLE(outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
          INNER JOIN public.google_connections AS connection
            ON connection.id = permit.connection_id
           AND connection.organization_id = permit.organization_id
          LEFT JOIN public.member AS member
            ON member."organizationId" = permit.organization_id
           AND member."userId" = permit.initiator_user_id
          LEFT JOIN public.permission_version AS permission
            ON permission.organization_id = permit.organization_id
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
            AND (
              permit.capability::text IN ('property.connect_gbp', 'property.publish_reply')
              OR EXISTS (
                SELECT 1
                FROM public.organization_capability AS organization_capability
                WHERE organization_capability.organization_id = permit.organization_id
                  AND organization_capability.capability = permit.capability::text
              )
            )
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
            AND permit.authorization_vector->>'googleContentPolicyVersion' ~
              '^(0|[1-9][0-9]*)$'
            AND policy.version::text =
              permit.authorization_vector->>'googleContentPolicyVersion'
            AND permit.authorization_vector->>'emergencyKillVersion' ~
              '^(0|[1-9][0-9]*)$'
            AND policy.emergency_kill_version::text =
              permit.authorization_vector->>'emergencyKillVersion'
            AND (
              permit.property_id IS NULL
              OR (
                NOT EXISTS (
                  SELECT 1
                  FROM public.property_policy AS property_policy
                  WHERE property_policy.property_id = permit.property_id
                    AND property_policy.suspended_at IS NOT NULL
                )
                AND (
                  permit.capability::text IN ('property.connect_gbp', 'property.publish_reply')
                  OR EXISTS (
                    SELECT 1
                    FROM public.property_capability AS property_capability
                    WHERE property_capability.property_id = permit.property_id
                      AND property_capability.capability = permit.capability::text
                  )
                )
                AND (
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
        ) OR (
          -- Cleanup remains an already-authorized drain after ordinary work is
          -- killed, membership changes, or a credential enters cleanup_only.
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
$function$

;
