import { sql } from 'drizzle-orm'

export const canonicalPeopleAuthorityRowsSql = (asOf: Date) => sql`
  SELECT
    'staff_participation'::text AS "source",
    sp.id::text AS "sourceId",
    'participation_integrity'::text AS "dimension",
    CASE
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL OR participant.id IS NULL
        THEN 'orphan'
      WHEN p.organization_id <> sp.organization_id
        OR participant.organization_id <> sp.organization_id THEN 'conflict'
      WHEN sp.status = 'active' AND participant.status <> 'active' THEN 'conflict'
      ELSE 'exact'
    END::text AS "outcome",
    sp.organization_id::text AS "organizationId",
    sp.property_id::text AS "propertyId",
    NULL::text AS "portalId",
    sp.user_id::text AS "userId",
    CASE
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL
        THEN 'participation_property_missing_or_inactive'
      WHEN participant.id IS NULL THEN 'staff_participant_missing'
      WHEN p.organization_id <> sp.organization_id
        OR participant.organization_id <> sp.organization_id THEN 'participation_scope_conflict'
      WHEN sp.status = 'active' AND participant.status <> 'active'
        THEN 'active_participation_has_archived_participant'
      ELSE 'canonical_participation_valid'
    END::text AS "reasonCode",
    CASE WHEN participant.id IS NULL THEN ARRAY[]::text[]
      ELSE ARRAY[participant.id::text] END AS "relatedIds"
  FROM staff_participations sp
  LEFT JOIN properties p ON p.id = sp.property_id
  LEFT JOIN staff_participants participant ON participant.id = sp.staff_participant_id

  UNION ALL

  SELECT
    'staff_participation'::text AS "source",
    sp.id::text AS "sourceId",
    'compatibility_user_shadow'::text AS "dimension",
    CASE
      WHEN u.id IS NULL THEN 'orphan'
      WHEN COALESCE(links.other_count, 0) > 0 THEN 'conflict'
      WHEN COALESCE(links.match_count, 0) = 1 THEN 'exact'
      WHEN COALESCE(links.match_count, 0) > 1 THEN 'conflict'
      ELSE 'mappable'
    END::text AS "outcome",
    sp.organization_id::text AS "organizationId",
    sp.property_id::text AS "propertyId",
    NULL::text AS "portalId",
    sp.user_id::text AS "userId",
    CASE
      WHEN u.id IS NULL THEN 'compatibility_user_missing'
      WHEN COALESCE(links.other_count, 0) > 0 THEN 'compatibility_shadow_disagrees_with_link'
      WHEN COALESCE(links.match_count, 0) = 1 THEN 'compatibility_shadow_matches_link'
      WHEN COALESCE(links.match_count, 0) > 1 THEN 'multiple_compatibility_links_match'
      ELSE 'compatibility_link_can_be_recorded'
    END::text AS "reasonCode",
    COALESCE(links.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM staff_participations sp
  LEFT JOIN "user" u ON u.id = sp.user_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE sul.user_id = sp.user_id)::integer AS match_count,
      count(*) FILTER (WHERE sul.user_id <> sp.user_id)::integer AS other_count,
      array_agg(sul.id::text ORDER BY sul.id::text) AS ids
    FROM staff_user_links sul
    WHERE sul.organization_id = sp.organization_id
      AND sul.staff_participant_id = sp.staff_participant_id
      AND sul.effective_from <= ${asOf}
      AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
  ) links ON TRUE
  WHERE sp.user_id IS NOT NULL

  UNION ALL

  SELECT
    'staff_user_link'::text AS "source",
    sul.id::text AS "sourceId",
    CASE WHEN sul.effective_from <= ${asOf}
      AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
      THEN 'login_link_integrity' ELSE 'retained_history' END::text AS "dimension",
    CASE
      WHEN participant.id IS NULL OR u.id IS NULL THEN 'orphan'
      WHEN participant.organization_id <> sul.organization_id THEN 'conflict'
      WHEN sul.effective_from <= ${asOf}
        AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
        AND participant.status <> 'active' THEN 'conflict'
      WHEN COALESCE(bindings.other_org_count, 0) > 0 THEN 'conflict'
      WHEN sul.effective_from <= ${asOf}
        AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
        AND COALESCE(current_links.participant_count, 0) > 1 THEN 'conflict'
      WHEN sul.effective_from <= ${asOf}
        AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
        AND COALESCE(current_links.user_count, 0) > 1 THEN 'conflict'
      ELSE 'exact'
    END::text AS "outcome",
    sul.organization_id::text AS "organizationId",
    NULL::text AS "propertyId",
    NULL::text AS "portalId",
    sul.user_id::text AS "userId",
    CASE
      WHEN participant.id IS NULL THEN 'linked_participant_missing'
      WHEN u.id IS NULL THEN 'linked_user_missing'
      WHEN participant.organization_id <> sul.organization_id THEN 'login_link_scope_conflict'
      WHEN sul.effective_from <= ${asOf}
        AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
        AND participant.status <> 'active'
        THEN 'current_link_has_archived_participant'
      WHEN COALESCE(bindings.other_org_count, 0) > 0 THEN 'login_binding_points_to_other_organization'
      WHEN sul.effective_from <= ${asOf}
        AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
        AND COALESCE(current_links.participant_count, 0) > 1
        THEN 'multiple_current_links_for_participant'
      WHEN sul.effective_from <= ${asOf}
        AND (sul.effective_to IS NULL OR sul.effective_to > ${asOf})
        AND COALESCE(current_links.user_count, 0) > 1
        THEN 'multiple_current_links_for_user'
      WHEN sul.effective_from > ${asOf} OR sul.effective_to <= ${asOf}
        THEN 'historical_login_link_retained'
      ELSE 'retained_login_link_does_not_activate_staff_user'
    END::text AS "reasonCode",
    COALESCE(bindings.ids, ARRAY[]::text[])
      || COALESCE(current_links.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM staff_user_links sul
  LEFT JOIN staff_participants participant ON participant.id = sul.staff_participant_id
  LEFT JOIN "user" u ON u.id = sul.user_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE binding.organization_id IS NOT NULL
          AND binding.organization_id <> sul.organization_id
      )::integer AS other_org_count,
      array_agg(binding.user_id::text ORDER BY binding.user_id::text) AS ids
    FROM user_organization_bindings binding
    WHERE binding.user_id = sul.user_id AND binding.state = 'active'
  ) bindings ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE other.staff_participant_id = sul.staff_participant_id
      )::integer AS participant_count,
      count(*) FILTER (WHERE other.user_id = sul.user_id)::integer AS user_count,
      array_agg(other.id::text ORDER BY other.id::text) AS ids
    FROM staff_user_links other
    WHERE other.organization_id = sul.organization_id
      AND other.effective_from <= ${asOf}
      AND (other.effective_to IS NULL OR other.effective_to > ${asOf})
      AND (
        other.staff_participant_id = sul.staff_participant_id
        OR other.user_id = sul.user_id
      )
  ) current_links ON TRUE

  UNION ALL

  SELECT
    'portal_responsibility'::text AS "source",
    pr.id::text AS "sourceId",
    CASE WHEN pr.effective_from <= ${asOf}
      AND (pr.effective_to IS NULL OR pr.effective_to > ${asOf})
      THEN 'staff_attribution_integrity' ELSE 'retained_history' END::text AS "dimension",
    CASE
      WHEN sp.id IS NULL OR po.id IS NULL THEN 'orphan'
      WHEN sp.organization_id <> pr.organization_id
        OR sp.property_id <> pr.property_id
        OR po.organization_id <> pr.organization_id
        OR po.property_id <> pr.property_id THEN 'conflict'
      WHEN pr.effective_from <= ${asOf}
        AND (pr.effective_to IS NULL OR pr.effective_to > ${asOf})
        AND sp.status <> 'active' THEN 'conflict'
      ELSE 'exact'
    END::text AS "outcome",
    pr.organization_id::text AS "organizationId",
    pr.property_id::text AS "propertyId",
    pr.portal_id::text AS "portalId",
    NULL::text AS "userId",
    CASE
      WHEN sp.id IS NULL THEN 'attribution_participation_missing'
      WHEN po.id IS NULL THEN 'attribution_portal_missing'
      WHEN sp.organization_id <> pr.organization_id
        OR sp.property_id <> pr.property_id
        OR po.organization_id <> pr.organization_id
        OR po.property_id <> pr.property_id THEN 'attribution_scope_conflict'
      WHEN pr.effective_from <= ${asOf}
        AND (pr.effective_to IS NULL OR pr.effective_to > ${asOf})
        AND sp.status <> 'active' THEN 'active_attribution_has_inactive_participation'
      WHEN pr.effective_from > ${asOf} OR pr.effective_to <= ${asOf}
        THEN 'historical_attribution_retained'
      ELSE 'canonical_staff_attribution_valid'
    END::text AS "reasonCode",
    CASE WHEN sp.id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[sp.id::text] END AS "relatedIds"
  FROM portal_responsibilities pr
  LEFT JOIN staff_participations sp ON sp.id = pr.staff_participation_id
  LEFT JOIN portals po ON po.id = pr.portal_id

  UNION ALL

  SELECT
    'property_access_grant'::text AS "source",
    grant_row.id::text AS "sourceId",
    CASE WHEN grant_row.revoked_at IS NULL
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > ${asOf})
      THEN 'access_mapping' ELSE 'retained_history' END::text AS "dimension",
    CASE
      WHEN grant_row.revoked_at IS NOT NULL
        OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= ${asOf})
        THEN 'exact'
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL OR u.id IS NULL THEN 'orphan'
      WHEN p.organization_id <> grant_row.organization_id THEN 'conflict'
      WHEN COALESCE(members.member_count, 0) = 0 THEN 'orphan'
      WHEN COALESCE(members.member_count, 0) > 1 THEN 'conflict'
      WHEN members.role IN ('owner', 'admin') THEN 'exact'
      ELSE 'unsafe'
    END::text AS "outcome",
    grant_row.organization_id::text AS "organizationId",
    grant_row.property_id::text AS "propertyId",
    NULL::text AS "portalId",
    grant_row.user_id::text AS "userId",
    CASE
      WHEN grant_row.revoked_at IS NOT NULL
        OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= ${asOf})
        THEN 'historical_canonical_access_retained'
      WHEN p.id IS NULL OR p.deleted_at IS NOT NULL
        THEN 'canonical_access_property_missing_or_inactive'
      WHEN u.id IS NULL THEN 'canonical_access_user_missing'
      WHEN p.organization_id <> grant_row.organization_id THEN 'canonical_access_scope_conflict'
      WHEN COALESCE(members.member_count, 0) = 0 THEN 'organization_membership_missing'
      WHEN COALESCE(members.member_count, 0) > 1 THEN 'multiple_organization_memberships'
      WHEN members.role IN ('owner', 'admin') THEN 'canonical_access_grant_valid'
      WHEN members.role = 'member' THEN 'staff_user_access_is_deferred'
      ELSE 'unsupported_membership_role'
    END::text AS "reasonCode",
    COALESCE(members.ids, ARRAY[]::text[]) AS "relatedIds"
  FROM property_access_grant grant_row
  LEFT JOIN properties p ON p.id = grant_row.property_id
  LEFT JOIN "user" u ON u.id = grant_row.user_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS member_count, min(m.role)::text AS role,
           array_agg(m.id::text ORDER BY m.id::text) AS ids
    FROM member m
    WHERE m."organizationId" = grant_row.organization_id
      AND m."userId" = grant_row.user_id
  ) members ON TRUE

  UNION ALL

  SELECT
    'team_membership'::text AS "source",
    tm.id::text AS "sourceId",
    CASE WHEN tm.effective_from <= ${asOf}
      AND (tm.effective_to IS NULL OR tm.effective_to > ${asOf})
      THEN 'team_quarantine' ELSE 'retained_history' END::text AS "dimension",
    CASE
      WHEN t.id IS NULL OR sp.id IS NULL THEN 'orphan'
      WHEN t.organization_id <> tm.organization_id
        OR t.property_id <> tm.property_id
        OR sp.organization_id <> tm.organization_id
        OR sp.property_id <> tm.property_id THEN 'conflict'
      WHEN tm.effective_from <= ${asOf}
        AND (tm.effective_to IS NULL OR tm.effective_to > ${asOf}) THEN 'unsafe'
      ELSE 'exact'
    END::text AS "outcome",
    tm.organization_id::text AS "organizationId",
    tm.property_id::text AS "propertyId",
    NULL::text AS "portalId",
    NULL::text AS "userId",
    CASE
      WHEN t.id IS NULL THEN 'team_parent_missing'
      WHEN sp.id IS NULL THEN 'team_participation_missing'
      WHEN t.organization_id <> tm.organization_id
        OR t.property_id <> tm.property_id
        OR sp.organization_id <> tm.organization_id
        OR sp.property_id <> tm.property_id THEN 'team_membership_scope_conflict'
      WHEN tm.effective_from <= ${asOf}
        AND (tm.effective_to IS NULL OR tm.effective_to > ${asOf})
        THEN 'active_team_relation_quarantined'
      ELSE 'historical_team_relation_retained'
    END::text AS "reasonCode",
    array_remove(ARRAY[t.id::text, sp.id::text], NULL) AS "relatedIds"
  FROM team_memberships tm
  LEFT JOIN teams t ON t.id = tm.team_id
  LEFT JOIN staff_participations sp ON sp.id = tm.staff_participation_id
`
