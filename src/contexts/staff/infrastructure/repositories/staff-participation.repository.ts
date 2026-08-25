import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalResponsibilities,
  staffParticipants,
  staffParticipations,
  staffUserLinks,
  teamMemberships,
} from '#/shared/db/schema/people-access.schema'
import { portals } from '#/shared/db/schema/portal.schema'
import { staffError } from '../../domain/errors'
import type { StaffParticipation } from '../../domain/staff-participation'
import type { PortalResponsibility } from '../../domain/portal-responsibility'
import type { StaffParticipationRepository } from '../../application/ports/staff-participation.repository'

const participationSelection = {
  id: staffParticipations.id,
  organizationId: staffParticipations.organizationId,
  propertyId: staffParticipations.propertyId,
  staffParticipantId: staffParticipations.staffParticipantId,
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
        isNull(staffUserLinks.effectiveTo),
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
  findById: async (organizationId, staffParticipationId) => {
    const [row] = await selectParticipation(db)
      .where(
        and(
          eq(staffParticipations.organizationId, organizationId),
          eq(staffParticipations.id, staffParticipationId),
        ),
      )
      .limit(1)
    return row ? participationFromRow(row) : null
  },

  findActiveByUser: async (organizationId, propertyId, userId) => {
    const [row] = await selectParticipation(db)
      .where(
        and(
          eq(staffParticipations.organizationId, organizationId),
          eq(staffParticipations.propertyId, propertyId),
          eq(staffUserLinks.userId, userId),
          eq(staffParticipations.status, 'active'),
        ),
      )
      .limit(1)
    return row ? participationFromRow(row) : null
  },

  list: async (organizationId, filters) => {
    const conditions = [eq(staffParticipations.organizationId, organizationId)]
    if (filters.propertyId) {
      conditions.push(eq(staffParticipations.propertyId, filters.propertyId))
    }
    if (filters.userId) conditions.push(eq(staffUserLinks.userId, filters.userId))
    if (filters.activeOnly) conditions.push(eq(staffParticipations.status, 'active'))
    const rows = await selectParticipation(db)
      .where(and(...conditions))
      .orderBy(asc(staffParticipants.displayName), asc(staffParticipations.id))
    return rows.map(participationFromRow)
  },

  createParticipantWithParticipation: async ({ participant, participation }) =>
    db.transaction(async (tx) => {
      await tx.insert(staffParticipants).values({
        id: participant.id,
        organizationId: participant.organizationId,
        displayName: participant.displayName,
        status: participant.status,
        archivedAt: participant.archivedAt,
        archiveReason: participant.archiveReason,
        revision: participant.revision,
        createdBy: participant.createdBy,
        createdAt: participant.createdAt,
        updatedAt: participant.updatedAt,
      })
      await tx.insert(staffParticipations).values({
        id: participation.id,
        organizationId: participation.organizationId,
        propertyId: participation.propertyId,
        staffParticipantId: participation.staffParticipantId,
        userId: null,
        displayName: participant.displayName,
        status: participation.status,
        startedAt: participation.startedAt,
        endedAt: participation.endedAt,
        archiveReason: participation.archiveReason,
        revision: participation.revision,
        createdBy: participation.createdBy,
        updatedAt: participation.updatedAt,
      })
      return participation
    }),

  archive: async (organizationId, staffParticipationId, at, reason, expectedRevision) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM staff_participations
        WHERE organization_id = ${organizationId}
          AND id = ${staffParticipationId}
        FOR UPDATE
      `)
      const [current] = await tx
        .select()
        .from(staffParticipations)
        .where(
          and(
            eq(staffParticipations.organizationId, organizationId),
            eq(staffParticipations.id, staffParticipationId),
          ),
        )
        .limit(1)
      if (!current) return null
      const [participant] = current.staffParticipantId
        ? await tx
            .select({
              displayName: staffParticipants.displayName,
              linkedUserId: staffUserLinks.userId,
            })
            .from(staffParticipants)
            .leftJoin(
              staffUserLinks,
              and(
                eq(staffUserLinks.organizationId, staffParticipants.organizationId),
                eq(staffUserLinks.staffParticipantId, staffParticipants.id),
                isNull(staffUserLinks.effectiveTo),
              ),
            )
            .where(
              and(
                eq(staffParticipants.organizationId, organizationId),
                eq(staffParticipants.id, current.staffParticipantId),
              ),
            )
            .limit(1)
        : []
      if (!participant || !current.staffParticipantId) {
        throw new Error(`staff participation ${current.id} has no canonical participant`)
      }
      const currentView = participationFromRow({
        ...current,
        staffParticipantId: current.staffParticipantId,
        linkedUserId: participant.linkedUserId,
        displayName: participant.displayName,
      })
      if (current.status === 'archived') return currentView
      if (current.revision !== expectedRevision) {
        throw staffError('revision_conflict', 'staff participation changed; reload it')
      }

      await tx
        .update(portalResponsibilities)
        .set({ effectiveTo: at, endReason: 'participation_archived' })
        .where(
          and(
            eq(portalResponsibilities.organizationId, organizationId),
            eq(portalResponsibilities.staffParticipationId, staffParticipationId),
            isNull(portalResponsibilities.effectiveTo),
          ),
        )
      await tx
        .update(teamMemberships)
        .set({ effectiveTo: at, endReason: 'participation_archived' })
        .where(
          and(
            eq(teamMemberships.organizationId, organizationId),
            eq(teamMemberships.staffParticipationId, staffParticipationId),
            isNull(teamMemberships.effectiveTo),
          ),
        )
      const [archived] = await tx
        .update(staffParticipations)
        .set({
          status: 'archived',
          endedAt: current.endedAt ?? at,
          archiveReason: reason,
          revision: current.revision + 1,
          updatedAt: at,
        })
        .where(
          and(
            eq(staffParticipations.organizationId, organizationId),
            eq(staffParticipations.id, staffParticipationId),
          ),
        )
        .returning()
      return archived
        ? participationFromRow({
            ...archived,
            staffParticipantId: current.staffParticipantId,
            linkedUserId: participant.linkedUserId,
            displayName: participant.displayName,
          })
        : null
    }),

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

  replaceResponsibilities: async (input) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM staff_participations
        WHERE organization_id = ${input.organizationId}
          AND property_id = ${input.propertyId}
          AND id = ${input.staffParticipationId}
          AND status = 'active'
        FOR UPDATE
      `)
      const [participation] = await tx
        .select({
          id: staffParticipations.id,
          revision: staffParticipations.revision,
        })
        .from(staffParticipations)
        .where(
          and(
            eq(staffParticipations.organizationId, input.organizationId),
            eq(staffParticipations.propertyId, input.propertyId),
            eq(staffParticipations.id, input.staffParticipationId),
            eq(staffParticipations.status, 'active'),
          ),
        )
        .limit(1)
      if (!participation) {
        throw staffError('participation_not_found', 'active participation not found')
      }
      if (participation.revision !== input.expectedRevision) {
        throw staffError('revision_conflict', 'staff participation changed; reload it')
      }

      const portalIds = input.selections.map((selection) => selection.portalId)
      if (portalIds.length > 0) {
        const ownedPortals = await tx
          .select({ id: portals.id })
          .from(portals)
          .where(
            and(
              eq(portals.organizationId, input.organizationId),
              eq(portals.propertyId, input.propertyId),
              inArray(portals.id, portalIds),
              isNull(portals.deletedAt),
            ),
          )
        if (ownedPortals.length !== new Set(portalIds).size) {
          throw staffError(
            'invalid_input',
            'one or more portals are outside the property',
          )
        }
      }

      const currentRows = await tx
        .select()
        .from(portalResponsibilities)
        .where(
          and(
            eq(portalResponsibilities.organizationId, input.organizationId),
            eq(portalResponsibilities.staffParticipationId, input.staffParticipationId),
            isNull(portalResponsibilities.effectiveTo),
          ),
        )
        .orderBy(asc(portalResponsibilities.kind), asc(portalResponsibilities.portalId))
      const keyFor = (value: { portalId: string; kind: string }) =>
        `${value.portalId}:${value.kind}`
      const currentByKey = new Map(currentRows.map((row) => [keyFor(row), row]))
      const desiredByKey = new Map(
        input.selections.map((selection) => [keyFor(selection), selection]),
      )
      const idsToEnd = currentRows
        .filter((row) => !desiredByKey.has(keyFor(row)))
        .map((row) => row.id)
      const selectionsToInsert = [...desiredByKey.entries()]
        .filter(([key]) => !currentByKey.has(key))
        .map(([, selection]) => selection)

      if (idsToEnd.length === 0 && selectionsToInsert.length === 0) {
        return {
          responsibilities: currentRows.map(responsibilityFromRow),
          revision: participation.revision,
        }
      }

      if (idsToEnd.length > 0) {
        await tx
          .update(portalResponsibilities)
          .set({ effectiveTo: input.at, endReason: 'responsibility_reassigned' })
          .where(
            and(
              eq(portalResponsibilities.organizationId, input.organizationId),
              eq(portalResponsibilities.staffParticipationId, input.staffParticipationId),
              inArray(portalResponsibilities.id, idsToEnd),
              isNull(portalResponsibilities.effectiveTo),
            ),
          )
      }

      if (selectionsToInsert.length > 0) {
        await tx.insert(portalResponsibilities).values(
          selectionsToInsert.map((selection) => ({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            portalId: selection.portalId,
            staffParticipationId: input.staffParticipationId,
            kind: selection.kind,
            effectiveFrom: input.at,
            createdBy: input.actorId,
          })),
        )
      }

      const nextRevision = participation.revision + 1
      const [revised] = await tx
        .update(staffParticipations)
        .set({ revision: nextRevision, updatedAt: input.at })
        .where(
          and(
            eq(staffParticipations.organizationId, input.organizationId),
            eq(staffParticipations.id, input.staffParticipationId),
            eq(staffParticipations.revision, input.expectedRevision),
          ),
        )
        .returning({ revision: staffParticipations.revision })
      if (!revised) {
        throw staffError('revision_conflict', 'staff participation changed; reload it')
      }

      const activeRows = await tx
        .select()
        .from(portalResponsibilities)
        .where(
          and(
            eq(portalResponsibilities.organizationId, input.organizationId),
            eq(portalResponsibilities.staffParticipationId, input.staffParticipationId),
            isNull(portalResponsibilities.effectiveTo),
          ),
        )
        .orderBy(asc(portalResponsibilities.kind), asc(portalResponsibilities.portalId))
      return {
        responsibilities: activeRows.map(responsibilityFromRow),
        revision: revised.revision,
      }
    }),
})
