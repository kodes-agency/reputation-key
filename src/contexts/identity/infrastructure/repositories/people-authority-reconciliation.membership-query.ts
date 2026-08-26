import { sql } from 'drizzle-orm'

export const membershipPeopleAuthorityRowsSql = () => sql`
  SELECT
    'staff_participant'::text AS "source",
    participant.id::text AS "sourceId",
    'participant_integrity'::text AS "dimension",
    CASE
      WHEN org.id IS NULL THEN 'orphan'
      WHEN participant.status = 'active'
        AND (participant.archived_at IS NOT NULL OR participant.archive_reason IS NOT NULL)
        THEN 'conflict'
      WHEN participant.status = 'archived'
        AND (participant.archived_at IS NULL OR participant.archive_reason IS NULL)
        THEN 'conflict'
      ELSE 'exact'
    END::text AS "outcome",
    participant.organization_id::text AS "organizationId",
    NULL::text AS "propertyId",
    NULL::text AS "portalId",
    NULL::text AS "userId",
    CASE
      WHEN org.id IS NULL THEN 'participant_organization_missing'
      WHEN participant.status = 'active'
        AND (participant.archived_at IS NOT NULL OR participant.archive_reason IS NOT NULL)
        THEN 'active_participant_lifecycle_conflict'
      WHEN participant.status = 'archived'
        AND (participant.archived_at IS NULL OR participant.archive_reason IS NULL)
        THEN 'archived_participant_lifecycle_conflict'
      ELSE 'participant_profile_valid_without_login'
    END::text AS "reasonCode",
    ARRAY[]::text[] AS "relatedIds"
  FROM staff_participants participant
  LEFT JOIN organization org ON org.id = participant.organization_id

  UNION ALL

  SELECT
    'organization_membership'::text AS "source",
    membership.id::text AS "sourceId",
    'membership_eligibility'::text AS "dimension",
    CASE
      WHEN org.id IS NULL OR u.id IS NULL THEN 'orphan'
      WHEN COALESCE(siblings.match_count, 0) > 1 THEN 'conflict'
      WHEN membership.role IN ('owner', 'admin') THEN 'exact'
      ELSE 'unsafe'
    END::text AS "outcome",
    membership."organizationId"::text AS "organizationId",
    NULL::text AS "propertyId",
    NULL::text AS "portalId",
    membership."userId"::text AS "userId",
    CASE
      WHEN org.id IS NULL THEN 'membership_organization_missing'
      WHEN u.id IS NULL THEN 'membership_user_missing'
      WHEN COALESCE(siblings.match_count, 0) > 1 THEN 'multiple_organization_memberships'
      WHEN membership.role IN ('owner', 'admin') THEN 'beta_manager_membership_valid'
      WHEN membership.role = 'member' THEN 'staff_user_login_is_deferred'
      ELSE 'custom_role_is_not_beta_interactive'
    END::text AS "reasonCode",
    COALESCE(siblings.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM member membership
  LEFT JOIN organization org ON org.id = membership."organizationId"
  LEFT JOIN "user" u ON u.id = membership."userId"
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS match_count,
           array_agg(other.id::text ORDER BY other.id::text) AS ids
    FROM member other
    WHERE other."organizationId" = membership."organizationId"
      AND other."userId" = membership."userId"
  ) siblings ON TRUE
`
