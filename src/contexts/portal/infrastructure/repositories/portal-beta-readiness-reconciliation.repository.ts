import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  PORTAL_BETA_READINESS_REASON_CODES,
  buildPortalBetaReadinessReport,
  type PortalBetaReadinessGap,
  type PortalBetaReadinessReasonCode,
} from '../../application/portal-beta-readiness-reconciliation'

type RawGap = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  sourceId: string
  reasonCode: string
  relatedIds: string[] | null
}>

const REASON_CODES = new Set<string>(PORTAL_BETA_READINESS_REASON_CODES)

function checkedGap(row: RawGap): PortalBetaReadinessGap {
  if (!REASON_CODES.has(row.reasonCode)) {
    throw new Error(`unknown Portal beta-readiness reason: ${row.reasonCode}`)
  }
  return {
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    sourceId: row.sourceId,
    reasonCode: row.reasonCode as PortalBetaReadinessReasonCode,
    relatedIds: row.relatedIds ?? [],
  }
}

export async function buildPortalBetaReadinessReportFromDatabase(
  db: Database,
  input: Readonly<{ asOf: Date; organizationIds?: readonly string[] }>,
) {
  const organizationIds = [...new Set(input.organizationIds ?? [])].sort()
  const scopePredicate = organizationIds.length
    ? sql`p.organization_id IN (${sql.join(
        organizationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql`TRUE`
  const result = await db.execute(sql`
    WITH scoped_portals AS (
      SELECT p.id,
             p.organization_id,
             p.property_id,
             p.entity_type,
             p.entity_id,
             p.created_by,
             p.hero_image_url,
             p.theme,
             p.primary_guest_locale,
             p.additional_guest_locales
      FROM portals p
      WHERE ${scopePredicate}
        AND p.created_at <= ${input.asOf}
        AND (p.deleted_at IS NULL OR p.deleted_at > ${input.asOf})
    ),
    active_memberships AS (
      SELECT membership.id,
             membership.organization_id,
             membership.property_id,
             membership.portal_id,
             membership.portal_group_id,
             portal.organization_id AS portal_organization_id,
             portal.property_id AS portal_property_id
      FROM portal_group_memberships membership
      INNER JOIN scoped_portals portal
        ON portal.id = membership.portal_id
      WHERE membership.effective_from <= ${input.asOf}
        AND (membership.effective_to IS NULL OR membership.effective_to > ${input.asOf})
    ),
    resolvable_tokens AS (
      SELECT token.id,
             token.organization_id,
             token.property_id,
             token.portal_id,
             token.status,
             token.print_batch
      FROM portal_tokens token
      INNER JOIN scoped_portals portal
        ON portal.id = token.portal_id
       AND portal.organization_id = token.organization_id
       AND portal.property_id = token.property_id
      WHERE token.issued_at <= ${input.asOf}
        AND (
          token.status = 'active'
          OR (
            token.status = 'rotating'
            AND token.grace_period_ends IS NOT NULL
            AND token.grace_period_ends >= ${input.asOf}
          )
        )
    ),
    portal_locales AS (
      SELECT portal.id AS portal_id,
             portal.organization_id,
             portal.property_id,
             portal.primary_guest_locale AS locale,
             TRUE AS is_primary
      FROM scoped_portals portal
      UNION ALL
      SELECT DISTINCT portal.id,
                      portal.organization_id,
                      portal.property_id,
                      additional.locale,
                      FALSE
      FROM scoped_portals portal
      CROSS JOIN LATERAL jsonb_array_elements_text(
        portal.additional_guest_locales
      ) AS additional(locale)
      WHERE additional.locale <> portal.primary_guest_locale
    ),
    observations AS (
      SELECT portal.organization_id AS "organizationId",
             portal.property_id::text AS "propertyId",
             portal.id::text AS "portalId",
             portal.id::text AS "sourceId",
             'creator_provenance_unknown'::text AS "reasonCode",
             ARRAY[]::text[] AS "relatedIds"
      FROM scoped_portals portal
      WHERE portal.created_by IS NULL OR btrim(portal.created_by) = ''

      UNION ALL

      SELECT portal.organization_id,
             portal.property_id::text,
             portal.id::text,
             portal.id::text,
             'legacy_polymorphic_owner_unreconciled'::text,
             ARRAY[]::text[]
      FROM scoped_portals portal
      WHERE portal.entity_type <> 'property'
         OR portal.entity_id <> portal.property_id::text

      UNION ALL

      SELECT membership.portal_organization_id,
             membership.portal_property_id::text,
             membership.portal_id::text,
             membership.portal_id::text,
             'multiple_active_group_memberships'::text,
             array_agg(membership.id::text ORDER BY membership.id)::text[]
      FROM active_memberships membership
      GROUP BY membership.portal_organization_id,
               membership.portal_property_id,
               membership.portal_id
      HAVING count(*) > 1

      UNION ALL

      SELECT portal.organization_id,
             portal.property_id::text,
             portal.id::text,
             legacy.id::text,
             'legacy_group_scope_invalid'::text,
             ARRAY[legacy.portal_group_id::text]
      FROM portal_group_members legacy
      INNER JOIN scoped_portals portal ON portal.id = legacy.portal_id
      LEFT JOIN portal_groups legacy_group ON legacy_group.id = legacy.portal_group_id
      WHERE legacy.created_at <= ${input.asOf}
        AND (
          legacy.organization_id <> portal.organization_id
          OR legacy_group.id IS NULL
          OR legacy_group.organization_id <> portal.organization_id
          OR legacy_group.property_id <> portal.property_id
          OR (
            legacy_group.deleted_at IS NOT NULL
            AND legacy_group.deleted_at <= ${input.asOf}
          )
        )

      UNION ALL

      SELECT portal.organization_id,
             portal.property_id::text,
             portal.id::text,
             legacy.id::text,
             CASE
               WHEN EXISTS (
                 SELECT 1
                 FROM active_memberships current
                 WHERE current.portal_id = portal.id
               ) THEN 'legacy_and_effective_group_disagree'
               ELSE 'legacy_group_membership_unreconciled'
             END::text,
             (
               ARRAY[legacy.portal_group_id::text]
               || ARRAY(
                 SELECT DISTINCT current.portal_group_id::text
                 FROM active_memberships current
                 WHERE current.portal_id = portal.id
                 ORDER BY current.portal_group_id::text
               )
             )::text[]
      FROM portal_group_members legacy
      INNER JOIN scoped_portals portal ON portal.id = legacy.portal_id
      WHERE legacy.created_at <= ${input.asOf}
        AND NOT EXISTS (
          SELECT 1
          FROM active_memberships current
          WHERE current.portal_id = portal.id
            AND current.portal_group_id = legacy.portal_group_id
        )

      UNION ALL

      SELECT membership.portal_organization_id,
             membership.portal_property_id::text,
             membership.portal_id::text,
             membership.id::text,
             'active_group_scope_invalid'::text,
             ARRAY[membership.portal_group_id::text]
      FROM active_memberships membership
      INNER JOIN scoped_portals portal
        ON portal.id = membership.portal_id
      LEFT JOIN portal_groups portal_group ON portal_group.id = membership.portal_group_id
      WHERE membership.organization_id <> portal.organization_id
         OR membership.property_id <> portal.property_id
         OR portal_group.id IS NULL
         OR portal_group.organization_id <> portal.organization_id
         OR portal_group.property_id <> portal.property_id
         OR (
           portal_group.deleted_at IS NOT NULL
           AND portal_group.deleted_at <= ${input.asOf}
         )

      UNION ALL

      SELECT token.organization_id,
             token.property_id::text,
             token.portal_id::text,
             token.id::text,
             'resolvable_token_missing_access_artifact'::text,
             ARRAY[]::text[]
      FROM resolvable_tokens token
      WHERE NOT EXISTS (
        SELECT 1
        FROM portal_access_artifacts artifact
        WHERE artifact.organization_id = token.organization_id
          AND artifact.property_id = token.property_id
          AND artifact.portal_id = token.portal_id
          AND artifact.portal_token_id = token.id
          AND artifact.status = 'published'
          AND artifact.published_at <= ${input.asOf}
          AND (artifact.retired_at IS NULL OR artifact.retired_at > ${input.asOf})
      )

      UNION ALL

      SELECT token.organization_id,
             token.property_id::text,
             token.portal_id::text,
             token.id::text,
             'print_batch_token_requires_replacement'::text,
             ARRAY(
               SELECT artifact.id::text
               FROM portal_access_artifacts artifact
               WHERE artifact.organization_id = token.organization_id
                 AND artifact.property_id = token.property_id
                 AND artifact.portal_id = token.portal_id
                 AND artifact.portal_token_id = token.id
                 AND artifact.status = 'published'
                 AND artifact.published_at <= ${input.asOf}
                 AND (artifact.retired_at IS NULL OR artifact.retired_at > ${input.asOf})
               ORDER BY artifact.id
             )::text[]
      FROM resolvable_tokens token
      WHERE token.print_batch IS NOT NULL AND btrim(token.print_batch) <> ''

      UNION ALL

      SELECT token.organization_id,
             token.property_id::text,
             token.portal_id::text,
             token.portal_id::text,
             'multiple_active_portal_tokens'::text,
             array_agg(token.id::text ORDER BY token.id)::text[]
      FROM resolvable_tokens token
      WHERE token.status = 'active'
      GROUP BY token.organization_id, token.property_id, token.portal_id
      HAVING count(*) > 1

      UNION ALL

      SELECT portal.organization_id,
             portal.property_id::text,
             portal.id::text,
             portal.id::text,
             'property_brand_profile_missing'::text,
             ARRAY[]::text[]
      FROM scoped_portals portal
      WHERE NOT EXISTS (
        SELECT 1
        FROM property_portal_brand_profiles profile
        WHERE profile.organization_id = portal.organization_id
          AND profile.property_id = portal.property_id
          AND profile.created_at <= ${input.asOf}
      )

      UNION ALL

      SELECT portal.organization_id,
             portal.property_id::text,
             portal.id::text,
             portal.id::text,
             'legacy_theme_requires_brand_classification'::text,
             ARRAY[]::text[]
      FROM scoped_portals portal
      WHERE portal.theme IS NOT NULL AND portal.theme <> '{}'::jsonb

      UNION ALL

      SELECT portal.organization_id,
             portal.property_id::text,
             portal.id::text,
             portal.id::text,
             'legacy_hero_requires_localized_classification'::text,
             ARRAY[]::text[]
      FROM scoped_portals portal
      WHERE portal.hero_image_url IS NOT NULL AND btrim(portal.hero_image_url) <> ''

      UNION ALL

      SELECT locale.organization_id,
             locale.property_id::text,
             locale.portal_id::text,
             locale.portal_id::text,
             CASE
               WHEN locale.is_primary THEN 'primary_locale_content_incomplete'
               ELSE 'additional_locale_content_incomplete'
             END::text,
             array_remove(
               ARRAY[content.id::text, override.id::text],
               NULL
             )::text[]
      FROM portal_locales locale
      LEFT JOIN property_portal_brand_contents content
        ON content.organization_id = locale.organization_id
       AND content.property_id = locale.property_id
       AND content.locale = locale.locale
       AND content.created_at <= ${input.asOf}
      LEFT JOIN portal_localized_overrides override
        ON override.organization_id = locale.organization_id
       AND override.property_id = locale.property_id
       AND override.portal_id = locale.portal_id
       AND override.locale = locale.locale
       AND override.created_at <= ${input.asOf}
      WHERE coalesce(
              nullif(btrim(override.title), ''),
              nullif(btrim(content.title), '')
            ) IS NULL
         OR coalesce(
              nullif(btrim(override.short_description), ''),
              nullif(btrim(content.short_description), '')
            ) IS NULL

      UNION ALL

      SELECT portal.organization_id,
             portal.property_id::text,
             portal.id::text,
             link.id::text,
             CASE
               WHEN link.legacy_destination_state = 'quarantined'
                 THEN 'raw_secondary_link_quarantined'
               ELSE 'raw_secondary_link_unclassified'
             END::text,
             ARRAY[link.category_id::text]
      FROM portal_links link
      INNER JOIN scoped_portals portal
        ON portal.organization_id = link.organization_id
       AND portal.property_id = link.property_id
       AND portal.id = link.portal_id
      WHERE link.created_at <= ${input.asOf}
        AND link.destination_id IS NULL
        AND link.url IS NOT NULL
        AND link.legacy_destination_state IN ('unclassified', 'quarantined')
    )
    SELECT "organizationId", "propertyId", "portalId", "sourceId",
           "reasonCode", "relatedIds"
    FROM observations
    ORDER BY "organizationId", "portalId", "sourceId", "reasonCode"
  `)
  return buildPortalBetaReadinessReport({
    asOf: input.asOf,
    organizationIds,
    gaps: (result.rows as unknown as readonly RawGap[]).map(checkedGap),
  })
}
