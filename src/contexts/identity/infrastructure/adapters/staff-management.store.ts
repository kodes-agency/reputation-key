import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  StaffManagementStore,
  StaffRemovalTarget,
} from '../../application/ports/staff-management-store.port'
import type { StaffOnboarding } from '../../domain/staff-account'
import { staffAccountError } from '../../domain/staff-account'

export const createStaffManagementStore = (
  db: Database,
  clock: () => Date,
): StaffManagementStore => ({
  target: async (org, participationId) => {
    const result =
      await db.execute(sql`SELECT p.id AS "participationId", p.property_id AS "propertyId", p.staff_participant_id AS "participantId", COALESCE(p.personal_portal_id, CASE WHEN EXISTS (SELECT 1 FROM portals portal WHERE portal.organization_id = p.organization_id AND portal.id = o.portal_id) THEN o.portal_id ELSE NULL END) AS "portalId", u.id AS "userId", m.id AS "memberId", m.role AS "memberRole", COALESCE(CASE WHEN o.status IN ('running', 'failed') THEN o.email ELSE NULL END, u.email, pending.email, o.email) AS email,
      (p.status = 'active' AND p.ended_at IS NULL) AS active,
      (p.archive_reason = 'staff_removed_complete' OR (p.status = 'archived' AND EXISTS (SELECT 1 FROM portals portal WHERE portal.organization_id = p.organization_id AND portal.id = COALESCE(p.personal_portal_id, o.portal_id) AND portal.publication_state = 'archived') AND NOT EXISTS (SELECT 1 FROM staff_onboardings unfinished WHERE unfinished.organization_id = p.organization_id AND unfinished.staff_participation_id = p.id AND unfinished.status IN ('running', 'failed')))) IS TRUE AS "removalComplete",
      EXISTS (SELECT 1 FROM staff_user_links current_link JOIN staff_participations other ON other.organization_id = current_link.organization_id AND other.staff_participant_id = current_link.staff_participant_id WHERE current_link.user_id = u.id AND current_link.effective_from <= ${clock()} AND current_link.effective_to IS NULL AND other.status = 'active' AND other.ended_at IS NULL) AS "otherParticipations"
      FROM staff_participations p LEFT JOIN staff_onboardings o ON o.organization_id = p.organization_id AND o.staff_participation_id = p.id LEFT JOIN LATERAL (SELECT * FROM staff_user_links l WHERE l.organization_id = p.organization_id AND l.staff_participant_id = p.staff_participant_id AND (l.effective_to IS NULL OR l.end_reason = 'staff_removed') ORDER BY l.effective_from DESC LIMIT 1) l ON true
      LEFT JOIN LATERAL (SELECT email FROM invitation WHERE "organizationId" = p.organization_id AND "staffParticipationId" = p.id::text ORDER BY "createdAt" DESC LIMIT 1) pending ON true
      LEFT JOIN "user" u ON u.id = l.user_id OR (l.user_id IS NULL AND lower(u.email) = lower(COALESCE(o.email, pending.email)))
      LEFT JOIN member m ON m."organizationId" = p.organization_id AND m."userId" = u.id WHERE p.organization_id = ${org} AND p.id = ${participationId}::uuid`)
    if (result.rows[0]) return result.rows[0] as StaffRemovalTarget
    const unfinished = await db.execute(
      sql`SELECT staff_participation_id AS "participationId", property_id AS "propertyId", staff_participant_id AS "participantId", CASE WHEN EXISTS (SELECT 1 FROM portals p WHERE p.organization_id = staff_onboardings.organization_id AND p.id = staff_onboardings.portal_id) THEN portal_id ELSE NULL END AS "portalId", email, (status = 'cancelled' AND NOT EXISTS (SELECT 1 FROM portals p WHERE p.organization_id = staff_onboardings.organization_id AND p.id = staff_onboardings.portal_id AND p.publication_state <> 'archived')) AS "removalComplete" FROM staff_onboardings WHERE organization_id = ${org} AND staff_participation_id = ${participationId}::uuid AND status IN ('running', 'failed', 'cancelled')`,
    )
    return unfinished.rows[0]
      ? ({
          ...unfinished.rows[0],
          userId: null,
          memberId: null,
          memberRole: null,
          otherParticipations: false,
          active: false,
        } as StaffRemovalTarget)
      : null
  },
  denyAccess: async (org, target) => {
    await db.transaction(async (tx) => {
      // Acceptance locks this row too: it either precedes removal or sees the ended participation.
      await tx.execute(
        sql`SELECT id FROM staff_participations WHERE organization_id = ${org} AND id = ${target.participationId}::uuid FOR UPDATE`,
      )
      await tx.execute(
        sql`UPDATE invitation SET status = 'canceled' WHERE "organizationId" = ${org} AND "staffParticipationId" = ${target.participationId} AND status IN ('pending', 'expired')`,
      )
      await tx.execute(
        sql`UPDATE portal_responsibilities SET effective_to = greatest(${clock()}, effective_from + interval '1 millisecond'), end_reason = 'staff_removed' WHERE organization_id = ${org} AND staff_participation_id = ${target.participationId}::uuid AND effective_to IS NULL`,
      )
      await tx.execute(
        sql`UPDATE staff_participations SET status = 'archived', ended_at = COALESCE(ended_at, ${clock()}), archive_reason = 'staff_removed', revision = revision + 1, updated_at = ${clock()} WHERE organization_id = ${org} AND id = ${target.participationId}::uuid AND status <> 'archived'`,
      )
      await tx.execute(
        sql`UPDATE staff_user_links l SET effective_to = greatest(${clock()}, effective_from + interval '1 millisecond'), end_reason = 'staff_removed' WHERE organization_id = ${org} AND staff_participant_id = ${target.participantId}::uuid AND effective_to IS NULL AND NOT EXISTS (SELECT 1 FROM staff_participations p WHERE p.organization_id = l.organization_id AND p.staff_participant_id = l.staff_participant_id AND p.status = 'active')`,
      )
    })
  },
  cancelOnboardings: async (org, target) => {
    await db.execute(
      sql`UPDATE staff_onboardings SET status = 'cancelled', email = NULL, display_name = NULL, updated_at = ${clock()} WHERE organization_id = ${org} AND property_id = ${target.propertyId}::uuid AND status IN ('running', 'failed') AND staff_participation_id = ${target.participationId}::uuid`,
    )
  },
  completeRemoval: async (org, target) => {
    await db.execute(
      sql`UPDATE staff_participations SET archive_reason = 'staff_removed_complete', revision = revision + 1, updated_at = ${clock()} WHERE organization_id = ${org} AND id = ${target.participationId}::uuid AND status = 'archived' AND archive_reason = 'staff_removed'`,
    )
  },
  propertiesForParticipant: async (org, participantId) => {
    const rows = await db.execute(
      sql`SELECT DISTINCT property_id AS id FROM staff_participations WHERE organization_id = ${org} AND staff_participant_id = ${participantId}::uuid`,
    )
    return rows.rows.map((row) => String(row.id))
  },
  rename: async (org, target, displayName, writePortalNames, authorizedPropertyIds) => {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM staff_participants WHERE organization_id = ${org} AND id = ${target.participantId}::uuid FOR UPDATE`,
      )
      const properties = await tx.execute(
        sql`SELECT DISTINCT property_id AS id FROM staff_participations WHERE organization_id = ${org} AND staff_participant_id = ${target.participantId}::uuid`,
      )
      if (properties.rows.some((row) => !authorizedPropertyIds.includes(String(row.id))))
        throw staffAccountError(
          'operation_conflict',
          'This person works at another Property now. Refresh Staff before renaming them',
        )

      const participation = await tx.execute(
        sql`SELECT id, status, ended_at FROM staff_participations WHERE organization_id = ${org} AND id = ${target.participationId}::uuid FOR UPDATE`,
      )
      if (participation.rows[0]?.status !== 'active' || participation.rows[0].ended_at)
        throw staffAccountError(
          'participation_not_found',
          'This staff participation has ended. Refresh Staff before trying again',
        )
      await tx.execute(
        sql`UPDATE staff_participants SET display_name = ${displayName}, revision = revision + 1, updated_at = ${clock()} WHERE organization_id = ${org} AND id = ${target.participantId}::uuid`,
      )
      await tx.execute(
        sql`UPDATE staff_participations SET display_name = ${displayName}, revision = revision + 1, updated_at = ${clock()} WHERE organization_id = ${org} AND staff_participant_id = ${target.participantId}::uuid`,
      )
      const portals = await tx.execute(
        sql`SELECT personal_portal_id AS id FROM staff_participations WHERE organization_id = ${org} AND staff_participant_id = ${target.participantId}::uuid AND personal_portal_id IS NOT NULL`,
      )
      await writePortalNames(
        tx,
        portals.rows.map((row) => String(row.id)),
      )
    })
  },
  list: async (org, property) => {
    const result =
      await db.execute(sql`WITH roster AS (SELECT p.id AS "participationId", person.display_name AS "displayName", p.personal_portal_id AS "portalId", COALESCE(u.email, i.email, o.email) AS email,
      CASE WHEN p.status = 'archived' THEN 'failed' WHEN o.status IN ('running', 'failed') THEN 'failed' WHEN l.id IS NOT NULL AND m.id IS NOT NULL THEN 'active' WHEN i."expiresAt" <= ${clock()} THEN 'invite_expired' ELSE 'invited' END AS access,
      CASE WHEN p.status = 'archived' THEN 'removal' WHEN o.status IN ('running', 'failed') THEN o.step ELSE NULL END AS step, CASE WHEN p.status = 'archived' THEN 'removal_incomplete' WHEN o.status IN ('running', 'failed') THEN o.failure_code ELSE NULL END AS code, o.id AS "operationId"
      FROM staff_participations p JOIN staff_participants person ON person.organization_id = p.organization_id AND person.id = p.staff_participant_id
      LEFT JOIN portals portal ON portal.organization_id = p.organization_id AND portal.property_id = p.property_id AND portal.id = p.personal_portal_id
      LEFT JOIN staff_user_links l ON l.organization_id = p.organization_id AND l.staff_participant_id = p.staff_participant_id AND l.effective_to IS NULL
      LEFT JOIN member m ON m."organizationId" = l.organization_id AND m."userId" = l.user_id LEFT JOIN "user" u ON u.id = l.user_id
      LEFT JOIN LATERAL (SELECT * FROM invitation i WHERE i."organizationId" = p.organization_id AND i."staffParticipationId" = p.id::text ORDER BY i."createdAt" DESC LIMIT 1) i ON true
      LEFT JOIN staff_onboardings o ON o.organization_id = p.organization_id AND o.staff_participation_id = p.id
      WHERE p.organization_id = ${org} AND p.property_id = ${property}::uuid AND (p.status = 'active' OR (p.archive_reason = 'staff_removed' AND portal.publication_state <> 'archived')))
      SELECT * FROM roster UNION ALL
      SELECT o.staff_participation_id AS "participationId", o.display_name AS "displayName", o.portal_id AS "portalId", o.email, 'failed' AS access, o.step, o.failure_code AS code, o.id AS "operationId"
      FROM staff_onboardings o WHERE o.organization_id = ${org} AND o.property_id = ${property}::uuid AND o.status IN ('running', 'failed') AND NOT EXISTS (SELECT 1 FROM roster r WHERE r."participationId" = o.staff_participation_id)
      ORDER BY "displayName", "participationId"`)
    return result.rows as unknown as Awaited<ReturnType<StaffManagementStore['list']>>
  },
  setColleagues: async (org, property, enabled, actor) => {
    await db.execute(
      sql`INSERT INTO staff_property_settings (organization_id, property_id, colleague_list_enabled, updated_by, updated_at) VALUES (${org}, ${property}::uuid, ${enabled}, ${actor}, ${clock()}) ON CONFLICT (organization_id, property_id) DO UPDATE SET colleague_list_enabled = EXCLUDED.colleague_list_enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    )
  },
  renewInvitation: async (org, participation) => {
    const result = await db.execute(
      sql`UPDATE invitation i SET status = 'pending', "expiresAt" = ${new Date(clock().getTime() + 7 * 86400000)} FROM staff_participations p WHERE i."organizationId" = ${org} AND i."staffParticipationId" = ${participation} AND p.id::text = i."staffParticipationId" AND p.organization_id = i."organizationId" AND p.status = 'active' AND p.ended_at IS NULL AND i.status IN ('pending', 'expired') RETURNING i.id, i.email, i."staffParticipationId" AS "staffParticipationId", p.property_id AS "propertyId", p.personal_portal_id AS "portalId", p.display_name AS "displayName", i."inviterId" AS "requestedBy"`,
    )
    if (!result.rows[0])
      throw staffAccountError(
        'participation_not_found',
        'This staff invitation has ended',
      )
    return {
      ...result.rows[0],
      organizationId: org,
      invitationId: result.rows[0].id,
    } as StaffOnboarding
  },
})
