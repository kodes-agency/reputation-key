import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalResponsibilities,
  staffParticipants,
  staffParticipations,
  staffUserLinks,
} from '#/shared/db/schema/people-access.schema'
import type { StaffParticipation } from '../domain/staff-participation'
import type { PortalResponsibility } from '../domain/portal-responsibility'
import type { StaffParticipationRepository } from './staff-participation-repository.port.server'

const participationSelection = {
  id: staffParticipations.id,
  organizationId: staffParticipations.organizationId,
  propertyId: staffParticipations.propertyId,
  staffParticipantId: staffParticipations.staffParticipantId,
  personalPortalId: staffParticipations.personalPortalId,
  linkedUserId: staffUserLinks.userId,
  displayName: staffParticipants.displayName,
  status: staffParticipations.status,
  startedAt: staffParticipations.startedAt,
  endedAt: staffParticipations.endedAt,
  archiveReason: staffParticipations.archiveReason,
  revision: staffParticipations.revision,
  createdBy: staffParticipations.createdBy,
  updatedAt: staffParticipations.updatedAt,
} as const

type ParticipationRow = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  staffParticipantId: string | null
  personalPortalId: string | null
  linkedUserId: string | null
  displayName: string
  status: StaffParticipation['status']
  startedAt: Date
  endedAt: Date | null
  archiveReason: string | null
  revision: number
  createdBy: string
  updatedAt: Date
}>

function participationFromRow(row: ParticipationRow): StaffParticipation {
  if (!row.staffParticipantId) {
    throw new Error(`staff participation ${row.id} has no canonical participant`)
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    staffParticipantId: row.staffParticipantId,
    personalPortalId: row.personalPortalId,
    linkedUserId: row.linkedUserId,
    displayName: row.displayName,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    archiveReason: row.archiveReason,
    revision: row.revision,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  }
}

const selectParticipation = <T extends Database>(query: T) =>
  query
    .select(participationSelection)
    .from(staffParticipations)
    .innerJoin(
      staffParticipants,
      and(
        eq(staffParticipants.organizationId, staffParticipations.organizationId),
        eq(staffParticipants.id, staffParticipations.staffParticipantId),
      ),
    )
    .leftJoin(
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

function responsibilityFromRow(
  row: typeof portalResponsibilities.$inferSelect,
): PortalResponsibility {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    staffParticipationId: row.staffParticipationId,
    kind: row.kind,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    createdBy: row.createdBy,
    endReason: row.endReason,
  }
}

export const createStaffParticipationRepository = (
  db: Database,
): StaffParticipationRepository => ({
  findActiveByUser: async (organizationId, propertyId, userId) => {
    const [row] = await selectParticipation(db)
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
      .limit(1)
    return row ? participationFromRow(row) : null
  },

  listActiveResponsibilities: async (organizationId, staffParticipationId) => {
    const rows = await db
      .select()
      .from(portalResponsibilities)
      .where(
        and(
          eq(portalResponsibilities.organizationId, organizationId),
          eq(portalResponsibilities.staffParticipationId, staffParticipationId),
          isNull(portalResponsibilities.effectiveTo),
        ),
      )
      .orderBy(asc(portalResponsibilities.kind), asc(portalResponsibilities.portalId))
    return rows.map(responsibilityFromRow)
  },
})
