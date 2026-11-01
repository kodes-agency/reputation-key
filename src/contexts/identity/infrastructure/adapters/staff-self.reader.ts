import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  StaffSelfReader,
  StaffSelfParticipation,
} from '../../application/ports/staff-self-reader.port'

export const createStaffSelfReader = (
  db: Database,
  clock: () => Date,
): StaffSelfReader => ({
  find: async (organizationId, userId) => {
    const links =
      await db.execute(sql`SELECT l.id, l.staff_participant_id AS "participantId", CASE WHEN l.notice_acknowledged_at IS NOT NULL THEN l.notice_version ELSE NULL END AS "noticeVersion"
      FROM staff_user_links l JOIN staff_participants person ON person.organization_id = l.organization_id AND person.id = l.staff_participant_id
      WHERE l.organization_id = ${organizationId} AND l.user_id = ${userId} AND l.effective_from <= ${clock()} AND l.effective_to IS NULL AND person.status = 'active'`)
    if (links.rows.length !== 1) return null
    const link = links.rows[0] as {
      id: string
      participantId: string
      noticeVersion: string | null
    }
    const rows =
      await db.execute(sql`SELECT s.id AS "participationId", s.property_id AS "propertyId", p.id AS "portalId", COALESCE(brand.display_name, property.name) AS "propertyName",
      (property.lifecycle_state = 'active' AND property.deleted_at IS NULL) AS "propertyActive", CASE WHEN p.publication_state = 'published' AND (property.lifecycle_state = 'active' AND property.deleted_at IS NULL) THEN 'live' ELSE 'paused' END AS "portalState",
      COALESCE(settings.colleague_list_enabled, false) AS "colleagueListEnabled", property.timezone, property.country_code AS "countryCode", g.portal_group_id AS "groupId"
      FROM staff_participations s
      JOIN portals p ON p.organization_id = s.organization_id AND p.property_id = s.property_id AND p.id = s.personal_portal_id AND p.kind = 'personal' AND p.deleted_at IS NULL
      JOIN properties property ON property.organization_id = s.organization_id AND property.id = s.property_id
      LEFT JOIN property_portal_brand_profiles brand ON brand.organization_id = s.organization_id AND brand.property_id = s.property_id
      LEFT JOIN staff_property_settings settings ON settings.organization_id = s.organization_id AND settings.property_id = s.property_id
      LEFT JOIN portal_group_memberships g ON g.organization_id = s.organization_id AND g.portal_id = p.id AND g.effective_to IS NULL
      WHERE s.organization_id = ${organizationId} AND s.staff_participant_id = ${link.participantId}::uuid AND s.status = 'active' AND s.ended_at IS NULL
      ORDER BY COALESCE(brand.display_name, property.name), s.id`)
    return {
      linkId: link.id,
      participantId: link.participantId,
      noticeVersion: link.noticeVersion,
      participations: rows.rows as StaffSelfParticipation[],
    }
  },
  acknowledge: async (organizationId, userId, version) => {
    await db.execute(
      sql`UPDATE staff_user_links SET notice_version = ${version}, notice_acknowledged_at = ${clock()} WHERE organization_id = ${organizationId} AND user_id = ${userId} AND effective_from <= ${clock()} AND effective_to IS NULL`,
    )
  },
  colleagues: async (organizationId, propertyId) => {
    const rows =
      await db.execute(sql`SELECT s.staff_participant_id AS "participantId", person.display_name AS "displayName", s.personal_portal_id AS "portalId"
      FROM staff_participations s JOIN staff_participants person ON person.organization_id = s.organization_id AND person.id = s.staff_participant_id AND person.status = 'active'
      JOIN staff_user_links l ON l.organization_id = s.organization_id AND l.staff_participant_id = person.id AND l.effective_from <= ${clock()} AND l.effective_to IS NULL
      JOIN member m ON m."organizationId" = l.organization_id AND m."userId" = l.user_id
      WHERE s.organization_id = ${organizationId} AND s.property_id = ${propertyId}::uuid AND s.status = 'active' AND s.ended_at IS NULL AND s.personal_portal_id IS NOT NULL
      ORDER BY person.display_name, s.id`)
    return rows.rows as { participantId: string; displayName: string; portalId: string }[]
  },
})
