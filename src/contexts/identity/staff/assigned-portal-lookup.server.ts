import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalResponsibilities,
  staffParticipants,
  staffParticipations,
  staffUserLinks,
} from '#/shared/db/schema/people-access.schema'
import {
  portalId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'

/**
 * The Portals a user is the primary responsible for, through their personal Portal.
 * A login link counts only while its interval contains now and no other current
 * link claims the same participant or user.
 */
export const createAssignedPortalLookup =
  (db: Database) =>
  async (organizationId: OrganizationId, userId: UserId, propertyId: PropertyId) => {
    const rows = await db
      .select({ portalId: portalResponsibilities.portalId })
      .from(staffParticipations)
      .innerJoin(
        staffParticipants,
        and(
          eq(staffParticipants.organizationId, staffParticipations.organizationId),
          eq(staffParticipants.id, staffParticipations.staffParticipantId),
        ),
      )
      .innerJoin(
        staffUserLinks,
        and(
          eq(staffUserLinks.organizationId, staffParticipants.organizationId),
          eq(staffUserLinks.staffParticipantId, staffParticipants.id),
          sql`${staffUserLinks.effectiveFrom} <= CURRENT_TIMESTAMP`,
          sql`(${staffUserLinks.effectiveTo} IS NULL OR ${staffUserLinks.effectiveTo} > CURRENT_TIMESTAMP)`,
          sql`NOT EXISTS (
            SELECT 1
            FROM staff_user_links AS other_link
            WHERE other_link.organization_id = ${staffUserLinks.organizationId}
              AND other_link.id <> ${staffUserLinks.id}
              AND other_link.effective_from <= CURRENT_TIMESTAMP
              AND (other_link.effective_to IS NULL OR other_link.effective_to > CURRENT_TIMESTAMP)
              AND (
                other_link.staff_participant_id = ${staffUserLinks.staffParticipantId}
                OR other_link.user_id = ${staffUserLinks.userId}
              )
          )`,
        ),
      )
      .innerJoin(
        portalResponsibilities,
        and(
          eq(portalResponsibilities.organizationId, staffParticipations.organizationId),
          eq(portalResponsibilities.staffParticipationId, staffParticipations.id),
          eq(portalResponsibilities.portalId, staffParticipations.personalPortalId),
          eq(portalResponsibilities.kind, 'primary'),
          isNull(portalResponsibilities.effectiveTo),
        ),
      )
      .where(
        and(
          eq(staffParticipations.organizationId, organizationId),
          eq(staffParticipations.propertyId, propertyId),
          eq(staffUserLinks.userId, userId),
          eq(staffParticipants.status, 'active'),
          eq(staffParticipations.status, 'active'),
          sql`${staffParticipations.startedAt} <= CURRENT_TIMESTAMP`,
          sql`(${staffParticipations.endedAt} IS NULL OR ${staffParticipations.endedAt} > CURRENT_TIMESTAMP)`,
        ),
      )
    return rows.map((row) => portalId(row.portalId))
  }
