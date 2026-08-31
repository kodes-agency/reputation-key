import { sql } from 'drizzle-orm'

const managerOutcome = sql`
  CASE
    WHEN assignment."current" = false THEN 'exact'
    WHEN assignment.parent_missing OR assignment.user_missing THEN 'orphan'
    WHEN assignment.scope_conflict THEN 'conflict'
    WHEN COALESCE(members.member_count, 0) > 1 THEN 'conflict'
    WHEN COALESCE(members.member_count, 0) = 0 THEN 'unsafe'
    WHEN members.role = 'owner' THEN 'exact'
    WHEN members.role <> 'admin' THEN 'unsafe'
    WHEN COALESCE(grants.match_count, 0) = 0 THEN 'unsafe'
    WHEN COALESCE(participations.match_count, 0) = 0 THEN 'unsafe'
    ELSE 'exact'
  END::text
`

const managerReason = sql`
  CASE
    WHEN assignment."current" = false THEN 'historical_manager_interval_retained'
    WHEN assignment.parent_missing THEN 'manager_parent_missing'
    WHEN assignment.user_missing THEN 'manager_user_missing'
    WHEN assignment.scope_conflict THEN 'manager_assignment_scope_conflict'
    WHEN COALESCE(members.member_count, 0) > 1 THEN 'multiple_organization_memberships'
    WHEN COALESCE(members.member_count, 0) = 0 THEN 'manager_membership_missing'
    WHEN members.role = 'owner' THEN 'account_admin_manager_assignment_valid'
    WHEN members.role <> 'admin' THEN 'manager_role_is_not_beta_eligible'
    WHEN COALESCE(grants.match_count, 0) = 0 THEN 'property_manager_missing_active_access_grant'
    WHEN COALESCE(participations.match_count, 0) = 0
      THEN 'property_manager_missing_active_participation'
    ELSE 'property_manager_assignment_valid'
  END::text
`

const eligibilityJoins = (asOf: Date) => sql`
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS member_count, min(m.role)::text AS role,
           array_agg(m.id::text ORDER BY m.id::text) AS ids
    FROM member m
    WHERE m."organizationId" = assignment.organization_id
      AND m."userId" = assignment.user_id
  ) members ON TRUE
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS match_count,
           array_agg(g.id::text ORDER BY g.id::text) AS ids
    FROM property_access_grant g
    WHERE g.organization_id = assignment.organization_id
      AND g.property_id = assignment.property_id
      AND g.user_id = assignment.user_id
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > ${asOf})
  ) grants ON TRUE
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT sp.id)::integer AS match_count,
           array_agg(DISTINCT sp.id::text ORDER BY sp.id::text) AS ids
    FROM staff_user_links sul
    JOIN staff_participants participant
      ON participant.organization_id = sul.organization_id
     AND participant.id = sul.staff_participant_id
     AND participant.status = 'active'
    JOIN staff_participations sp
      ON sp.organization_id = sul.organization_id
     AND sp.staff_participant_id = sul.staff_participant_id
     AND sp.property_id = assignment.property_id
     AND sp.status = 'active'
     AND sp.started_at <= ${asOf}
     AND (sp.ended_at IS NULL OR sp.ended_at > ${asOf})
    WHERE sul.organization_id = assignment.organization_id
      AND sul.user_id = assignment.user_id
      AND sul.effective_from <= ${asOf}
      AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
      AND NOT EXISTS (
        SELECT 1
        FROM staff_user_links other_link
        WHERE other_link.organization_id = sul.organization_id
          AND other_link.id <> sul.id
          AND other_link.effective_from <= ${asOf}
          AND (other_link.effective_to IS NULL OR other_link.effective_to > ${asOf})
          AND (
            other_link.staff_participant_id = sul.staff_participant_id
            OR other_link.user_id = sul.user_id
          )
      )
  ) participations ON TRUE
`

export const managerPeopleAuthorityRowsSql = (asOf: Date) => sql`
  SELECT
    'portal_responsible_manager'::text AS "source",
    assignment.id::text AS "sourceId",
    CASE WHEN assignment."current" THEN 'manager_eligibility'
      ELSE 'retained_history' END::text AS "dimension",
    ${managerOutcome} AS "outcome",
    assignment.organization_id::text AS "organizationId",
    assignment.property_id::text AS "propertyId",
    assignment.portal_id::text AS "portalId",
    assignment.user_id::text AS "userId",
    ${managerReason} AS "reasonCode",
    COALESCE(members.ids, ARRAY[]::text[])
      || COALESCE(grants.ids, ARRAY[]::text[])
      || COALESCE(participations.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM (
    SELECT prm.*,
      (prm.effective_from <= ${asOf}
        AND (prm.effective_to IS NULL OR prm.effective_to > ${asOf})) AS "current",
      (po.id IS NULL OR po.deleted_at IS NOT NULL
        OR p.id IS NULL OR p.deleted_at IS NOT NULL) AS parent_missing,
      (u.id IS NULL) AS user_missing,
      (po.organization_id <> prm.organization_id
        OR po.property_id <> prm.property_id
        OR p.organization_id <> prm.organization_id) AS scope_conflict
    FROM portal_responsible_managers prm
    LEFT JOIN portals po ON po.id = prm.portal_id
    LEFT JOIN properties p ON p.id = prm.property_id
    LEFT JOIN "user" u ON u.id = prm.user_id
  ) assignment
  ${eligibilityJoins(asOf)}

  UNION ALL

  SELECT
    'property_responsible_manager'::text AS "source",
    assignment.id::text AS "sourceId",
    CASE WHEN assignment."current" THEN 'manager_eligibility'
      ELSE 'retained_history' END::text AS "dimension",
    ${managerOutcome} AS "outcome",
    assignment.organization_id::text AS "organizationId",
    assignment.property_id::text AS "propertyId",
    NULL::text AS "portalId",
    assignment.user_id::text AS "userId",
    ${managerReason} AS "reasonCode",
    COALESCE(members.ids, ARRAY[]::text[])
      || COALESCE(grants.ids, ARRAY[]::text[])
      || COALESCE(participations.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM (
    SELECT prm.*,
      NULL::uuid AS portal_id,
      (prm.effective_from <= ${asOf}
        AND (prm.effective_to IS NULL OR prm.effective_to > ${asOf})) AS "current",
      (p.id IS NULL OR p.deleted_at IS NOT NULL) AS parent_missing,
      (u.id IS NULL) AS user_missing,
      (p.organization_id <> prm.organization_id) AS scope_conflict
    FROM property_responsible_managers prm
    LEFT JOIN properties p ON p.id = prm.property_id
    LEFT JOIN "user" u ON u.id = prm.user_id
  ) assignment
  ${eligibilityJoins(asOf)}
`
