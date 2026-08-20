import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalResponsibilities,
  staffParticipations,
  teamMemberships,
} from '#/shared/db/schema/people-access.schema'
import { portals } from '#/shared/db/schema/portal.schema'
import { staffError } from '../../domain/errors'
import type { StaffParticipation } from '../../domain/staff-participation'
import type { PortalResponsibility } from '../../domain/portal-responsibility'
import type { StaffParticipationRepository } from '../../application/ports/staff-participation.repository'

function participationFromRow(
  row: typeof staffParticipations.$inferSelect,
): StaffParticipation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    userId: row.userId,
    displayName: row.displayName,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  }
}

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
    const [row] = await db
      .select()
      .from(staffParticipations)
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
    const [row] = await db
      .select()
      .from(staffParticipations)
      .where(
        and(
          eq(staffParticipations.organizationId, organizationId),
          eq(staffParticipations.propertyId, propertyId),
          eq(staffParticipations.userId, userId),
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
    if (filters.userId) conditions.push(eq(staffParticipations.userId, filters.userId))
    if (filters.activeOnly) conditions.push(eq(staffParticipations.status, 'active'))
    const rows = await db
      .select()
      .from(staffParticipations)
      .where(and(...conditions))
      .orderBy(asc(staffParticipations.displayName), asc(staffParticipations.id))
    return rows.map(participationFromRow)
  },

  create: async (participation) => {
    const [row] = await db
      .insert(staffParticipations)
      .values({
        id: participation.id,
        organizationId: participation.organizationId,
        propertyId: participation.propertyId,
        userId: participation.userId,
        displayName: participation.displayName,
        status: participation.status,
        startedAt: participation.startedAt,
        endedAt: participation.endedAt,
        createdBy: participation.createdBy,
        updatedAt: participation.updatedAt,
      })
      .onConflictDoNothing()
      .returning()
    if (row) return participationFromRow(row)
    const [existing] = await db
      .select()
      .from(staffParticipations)
      .where(
        and(
          eq(staffParticipations.organizationId, participation.organizationId),
          eq(staffParticipations.propertyId, participation.propertyId),
          eq(staffParticipations.userId, participation.userId),
          eq(staffParticipations.status, 'active'),
        ),
      )
      .limit(1)
    if (!existing) throw staffError('responsibility_conflict', 'participation conflict')
    return participationFromRow(existing)
  },

  archive: async (organizationId, staffParticipationId, at, reason) =>
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
      if (current.status === 'archived') return participationFromRow(current)

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
        .set({ status: 'archived', endedAt: current.endedAt ?? at, updatedAt: at })
        .where(
          and(
            eq(staffParticipations.organizationId, organizationId),
            eq(staffParticipations.id, staffParticipationId),
          ),
        )
        .returning()
      void reason
      return archived ? participationFromRow(archived) : null
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
        .select({ id: staffParticipations.id })
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
        .orderBy(asc(portalResponsibilities.portalId), asc(portalResponsibilities.kind))
      const currentKey = currentRows.map((row) => `${row.portalId}:${row.kind}`).sort()
      const desiredKey = input.selections
        .map((selection) => `${selection.portalId}:${selection.kind}`)
        .sort()
      if (
        currentKey.length === desiredKey.length &&
        currentKey.every((value, index) => value === desiredKey[index])
      ) {
        return currentRows.map(responsibilityFromRow)
      }

      await tx
        .update(portalResponsibilities)
        .set({ effectiveTo: input.at, endReason: 'responsibility_reassigned' })
        .where(
          and(
            eq(portalResponsibilities.organizationId, input.organizationId),
            eq(portalResponsibilities.staffParticipationId, input.staffParticipationId),
            isNull(portalResponsibilities.effectiveTo),
          ),
        )
      if (input.selections.length === 0) return []

      const inserted = await tx
        .insert(portalResponsibilities)
        .values(
          input.selections.map((selection) => ({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            portalId: selection.portalId,
            staffParticipationId: input.staffParticipationId,
            kind: selection.kind,
            effectiveFrom: input.at,
            createdBy: input.actorId,
          })),
        )
        .returning()
      return inserted.map(responsibilityFromRow)
    }),
})
