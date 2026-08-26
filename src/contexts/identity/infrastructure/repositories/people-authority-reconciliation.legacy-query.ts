import { sql } from 'drizzle-orm'

export const legacyPeopleAuthorityRowsSql = (asOf: Date) => sql`
  SELECT
    'legacy_staff_assignment'::text AS "source",
    sa.id::text AS "sourceId",
    CASE WHEN sa.deleted_at IS NULL
      THEN 'participant_mapping' ELSE 'retained_history' END::text AS "dimension",
    CASE
      WHEN sa.deleted_at IS NOT NULL THEN 'exact'
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL OR u.id IS NULL THEN 'orphan'
      WHEN p.organization_id <> sa.organization_id THEN 'conflict'
      WHEN COALESCE(mapped.match_count, 0) > 1 THEN 'conflict'
      WHEN COALESCE(mapped.match_count, 0) = 1 THEN 'exact'
      ELSE 'mappable'
    END::text AS "outcome",
    sa.organization_id::text AS "organizationId",
    sa.property_id::text AS "propertyId",
    sa.portal_id::text AS "portalId",
    sa.user_id::text AS "userId",
    CASE
      WHEN sa.deleted_at IS NOT NULL THEN 'historical_legacy_assignment_retained'
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL THEN 'assignment_property_missing_or_inactive'
      WHEN u.id IS NULL THEN 'assignment_user_missing'
      WHEN p.organization_id <> sa.organization_id THEN 'assignment_property_scope_conflict'
      WHEN COALESCE(mapped.match_count, 0) > 1 THEN 'multiple_canonical_participations_match'
      WHEN COALESCE(mapped.match_count, 0) = 1 THEN 'canonical_participation_matches'
      ELSE 'participant_and_participation_can_be_created'
    END::text AS "reasonCode",
    COALESCE(mapped.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM staff_assignments sa
  LEFT JOIN properties p ON p.id = sa.property_id
  LEFT JOIN "user" u ON u.id = sa.user_id
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
     AND sp.property_id = sa.property_id
     AND sp.status = 'active'
     AND sp.started_at <= ${asOf}
     AND (sp.ended_at IS NULL OR sp.ended_at > ${asOf})
    WHERE sul.organization_id = sa.organization_id
      AND sul.user_id = sa.user_id
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
  ) mapped ON TRUE

  UNION ALL

  SELECT
    'legacy_staff_assignment'::text AS "source",
    sa.id::text AS "sourceId",
    'staff_attribution_mapping'::text AS "dimension",
    CASE
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL OR po.id IS NULL
        OR po.deleted_at IS NOT NULL OR u.id IS NULL THEN 'orphan'
      WHEN p.organization_id <> sa.organization_id
        OR po.organization_id <> sa.organization_id
        OR po.property_id <> sa.property_id THEN 'conflict'
      WHEN COALESCE(mapped.primary_count, 0) > 0 THEN 'conflict'
      WHEN COALESCE(mapped.supporting_count, 0) > 1 THEN 'conflict'
      WHEN COALESCE(mapped.supporting_count, 0) = 1 THEN 'exact'
      ELSE 'mappable'
    END::text AS "outcome",
    sa.organization_id::text AS "organizationId",
    sa.property_id::text AS "propertyId",
    sa.portal_id::text AS "portalId",
    sa.user_id::text AS "userId",
    CASE
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL THEN 'assignment_property_missing_or_inactive'
      WHEN po.id IS NULL OR po.deleted_at IS NOT NULL THEN 'assignment_portal_missing_or_inactive'
      WHEN u.id IS NULL THEN 'assignment_user_missing'
      WHEN p.organization_id <> sa.organization_id
        OR po.organization_id <> sa.organization_id
        OR po.property_id <> sa.property_id THEN 'assignment_portal_scope_conflict'
      WHEN COALESCE(mapped.primary_count, 0) > 0 THEN 'legacy_attribution_is_primary'
      WHEN COALESCE(mapped.supporting_count, 0) > 1 THEN 'multiple_supporting_attributions_match'
      WHEN COALESCE(mapped.supporting_count, 0) = 1 THEN 'canonical_supporting_attribution_matches'
      ELSE 'supporting_attribution_can_be_created'
    END::text AS "reasonCode",
    COALESCE(mapped.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM staff_assignments sa
  LEFT JOIN properties p ON p.id = sa.property_id
  LEFT JOIN portals po ON po.id = sa.portal_id
  LEFT JOIN "user" u ON u.id = sa.user_id
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT pr.id) FILTER (WHERE pr.kind = 'primary')::integer AS primary_count,
      count(DISTINCT pr.id) FILTER (WHERE pr.kind = 'supporting')::integer AS supporting_count,
      array_agg(DISTINCT pr.id::text ORDER BY pr.id::text) AS ids
    FROM staff_user_links sul
    JOIN staff_participants participant
      ON participant.organization_id = sul.organization_id
     AND participant.id = sul.staff_participant_id
     AND participant.status = 'active'
    JOIN staff_participations sp
      ON sp.organization_id = sul.organization_id
     AND sp.staff_participant_id = sul.staff_participant_id
     AND sp.property_id = sa.property_id
     AND sp.status = 'active'
     AND sp.started_at <= ${asOf}
     AND (sp.ended_at IS NULL OR sp.ended_at > ${asOf})
    JOIN portal_responsibilities pr
      ON pr.organization_id = sp.organization_id
     AND pr.property_id = sp.property_id
     AND pr.staff_participation_id = sp.id
     AND pr.portal_id = sa.portal_id
     AND pr.effective_from <= ${asOf}
     AND (pr.effective_to IS NULL OR pr.effective_to > ${asOf})
    WHERE sul.organization_id = sa.organization_id
      AND sul.user_id = sa.user_id
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
  ) mapped ON TRUE
  WHERE sa.deleted_at IS NULL AND sa.portal_id IS NOT NULL

  UNION ALL

  SELECT
    'legacy_staff_assignment'::text AS "source",
    sa.id::text AS "sourceId",
    'team_quarantine'::text AS "dimension",
    CASE WHEN t.id IS NULL THEN 'orphan'
      WHEN t.organization_id <> sa.organization_id OR t.property_id <> sa.property_id
        THEN 'conflict'
      ELSE 'unsafe' END::text AS "outcome",
    sa.organization_id::text AS "organizationId",
    sa.property_id::text AS "propertyId",
    sa.portal_id::text AS "portalId",
    sa.user_id::text AS "userId",
    CASE WHEN t.id IS NULL THEN 'assignment_team_missing'
      WHEN t.organization_id <> sa.organization_id OR t.property_id <> sa.property_id
        THEN 'assignment_team_scope_conflict'
      ELSE 'team_relation_must_remain_quarantined' END::text AS "reasonCode",
    CASE WHEN t.id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[t.id::text] END AS "relatedIds"
  FROM staff_assignments sa
  LEFT JOIN teams t ON t.id = sa.team_id
  WHERE sa.deleted_at IS NULL AND sa.team_id IS NOT NULL

  UNION ALL

  SELECT
    'legacy_property_access_grant'::text AS "source",
    legacy.id::text AS "sourceId",
    CASE WHEN legacy.status = 'active'
      THEN 'access_mapping' ELSE 'retained_history' END::text AS "dimension",
    CASE
      WHEN legacy.status <> 'active' THEN 'exact'
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL OR u.id IS NULL THEN 'orphan'
      WHEN p.organization_id <> legacy.organization_id THEN 'conflict'
      WHEN COALESCE(members.member_count, 0) = 0 THEN 'orphan'
      WHEN COALESCE(members.member_count, 0) > 1
        OR COALESCE(current_grants.match_count, 0) > 1 THEN 'conflict'
      WHEN COALESCE(current_grants.match_count, 0) = 1 THEN 'exact'
      WHEN members.role = 'admin' THEN 'mappable'
      ELSE 'unsafe'
    END::text AS "outcome",
    legacy.organization_id::text AS "organizationId",
    legacy.property_id::text AS "propertyId",
    NULL::text AS "portalId",
    legacy.user_id::text AS "userId",
    CASE
      WHEN legacy.status <> 'active' THEN 'historical_legacy_access_retained'
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL THEN 'legacy_access_property_missing_or_inactive'
      WHEN u.id IS NULL THEN 'legacy_access_user_missing'
      WHEN p.organization_id <> legacy.organization_id THEN 'legacy_access_property_scope_conflict'
      WHEN COALESCE(members.member_count, 0) = 0 THEN 'organization_membership_missing'
      WHEN COALESCE(members.member_count, 0) > 1 THEN 'multiple_organization_memberships'
      WHEN COALESCE(current_grants.match_count, 0) > 1 THEN 'multiple_canonical_access_grants'
      WHEN COALESCE(current_grants.match_count, 0) = 1 THEN 'canonical_access_grant_matches'
      WHEN members.role = 'admin' THEN 'canonical_access_grant_can_be_created'
      WHEN members.role = 'member' THEN 'staff_user_access_is_deferred'
      WHEN members.role = 'owner' THEN 'account_admin_property_grant_is_redundant'
      ELSE 'unsupported_membership_role'
    END::text AS "reasonCode",
    COALESCE(members.ids, ARRAY[]::text[])
      || COALESCE(current_grants.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM property_access_grants legacy
  LEFT JOIN properties p ON p.id = legacy.property_id
  LEFT JOIN "user" u ON u.id = legacy.user_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS member_count, min(m.role)::text AS role,
           array_agg(m.id::text ORDER BY m.id::text) AS ids
    FROM member m
    WHERE m."organizationId" = legacy.organization_id
      AND m."userId" = legacy.user_id
  ) members ON TRUE
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS match_count,
           array_agg(g.id::text ORDER BY g.id::text) AS ids
    FROM property_access_grant g
    WHERE g.organization_id = legacy.organization_id
      AND g.property_id = legacy.property_id
      AND g.user_id = legacy.user_id
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > ${asOf})
  ) current_grants ON TRUE
`
