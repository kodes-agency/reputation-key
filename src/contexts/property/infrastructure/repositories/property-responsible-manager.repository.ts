import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  properties,
  propertyResponsibleManagers,
} from '#/shared/db/schema/property.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { propertyError } from '../../domain/errors'
import { propertyResponsibilityNeeded } from '../../domain/events'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { PropertyResponsibleManager } from '../../domain/property-responsible-manager'
import type { PropertyResponsibleManagerRepository } from '../../application/ports/property-responsible-manager.repository'

const fromRow = (
  row: typeof propertyResponsibleManagers.$inferSelect,
): PropertyResponsibleManager => row

export const createPropertyResponsibleManagerRepository = (
  db: Database,
): PropertyResponsibleManagerRepository => ({
  listActive: async (organizationId, propertyId) => {
    const rows = await db
      .select()
      .from(propertyResponsibleManagers)
      .where(
        and(
          eq(propertyResponsibleManagers.organizationId, organizationId),
          eq(propertyResponsibleManagers.propertyId, propertyId),
          isNull(propertyResponsibleManagers.effectiveTo),
        ),
      )
      .orderBy(asc(propertyResponsibleManagers.userId))
    return rows.map(fromRow)
  },

  listActiveForUser: async (organizationId, userId) => {
    const rows = await db
      .select()
      .from(propertyResponsibleManagers)
      .where(
        and(
          eq(propertyResponsibleManagers.organizationId, organizationId),
          eq(propertyResponsibleManagers.userId, userId),
          isNull(propertyResponsibleManagers.effectiveTo),
        ),
      )
      .orderBy(asc(propertyResponsibleManagers.propertyId))
    return rows.map(fromRow)
  },

  replace: async (input) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM properties
        WHERE organization_id = ${input.organizationId}
          AND id = ${input.propertyId}
          AND deleted_at IS NULL
        FOR UPDATE
      `)
      const [property] = await tx
        .select({
          id: properties.id,
          revision: properties.responsibleManagerRevision,
          responsibilityNeededSince: properties.responsibilityNeededSince,
        })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, input.organizationId),
            eq(properties.id, input.propertyId),
            isNull(properties.deletedAt),
          ),
        )
        .limit(1)
      if (!property) throw propertyError('property_not_found', 'property not found')
      if (property.revision !== input.expectedRevision) {
        throw propertyError(
          'revision_conflict',
          'responsible managers changed; reload them',
        )
      }

      const currentRows = await tx
        .select()
        .from(propertyResponsibleManagers)
        .where(
          and(
            eq(propertyResponsibleManagers.organizationId, input.organizationId),
            eq(propertyResponsibleManagers.propertyId, input.propertyId),
            isNull(propertyResponsibleManagers.effectiveTo),
          ),
        )
        .orderBy(asc(propertyResponsibleManagers.userId))
      const desired = new Set(input.managerUserIds)
      const current = new Set(currentRows.map((row) => row.userId))
      const rowsToEnd = currentRows.filter((row) => !desired.has(row.userId))
      const usersToInsert = input.managerUserIds.filter((userId) => !current.has(userId))

      if (rowsToEnd.length === 0 && usersToInsert.length === 0) {
        return {
          assignments: currentRows.map(fromRow),
          revision: property.revision,
          becameResponsibilityNeeded: false,
        }
      }

      if (rowsToEnd.length > 0) {
        await tx
          .update(propertyResponsibleManagers)
          .set({
            effectiveTo: input.at,
            endReason: 'responsibility_reassigned',
          })
          .where(
            and(
              eq(propertyResponsibleManagers.organizationId, input.organizationId),
              inArray(
                propertyResponsibleManagers.id,
                rowsToEnd.map((row) => row.id),
              ),
              isNull(propertyResponsibleManagers.effectiveTo),
            ),
          )
      }
      if (usersToInsert.length > 0) {
        await tx.insert(propertyResponsibleManagers).values(
          usersToInsert.map((userId) => ({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            userId,
            effectiveFrom: input.at,
            createdBy: input.actorId,
          })),
        )
      }

      const nextRevision = property.revision + 1
      const responsibilityNeededSince =
        input.managerUserIds.length === 0
          ? (property.responsibilityNeededSince ?? input.at)
          : null
      const becameResponsibilityNeeded =
        currentRows.length > 0 && input.managerUserIds.length === 0
      if (becameResponsibilityNeeded) {
        const event = input.responsibilityNeededEvent
        if (
          event.organizationId !== input.organizationId ||
          event.propertyId !== input.propertyId
        ) {
          throw propertyError(
            'forbidden',
            'Tenant or resource mismatch on Property recovery event',
          )
        }
        await insertOutboxRow(tx, event, { recordedAt: input.at })
      }
      const [revised] = await tx
        .update(properties)
        .set({
          responsibleManagerRevision: nextRevision,
          responsibilityNeededSince,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(properties.organizationId, input.organizationId),
            eq(properties.id, input.propertyId),
            eq(properties.responsibleManagerRevision, input.expectedRevision),
          ),
        )
        .returning({ revision: properties.responsibleManagerRevision })
      if (!revised) {
        throw propertyError(
          'revision_conflict',
          'responsible managers changed; reload them',
        )
      }

      const activeRows = await tx
        .select()
        .from(propertyResponsibleManagers)
        .where(
          and(
            eq(propertyResponsibleManagers.organizationId, input.organizationId),
            eq(propertyResponsibleManagers.propertyId, input.propertyId),
            isNull(propertyResponsibleManagers.effectiveTo),
          ),
        )
        .orderBy(asc(propertyResponsibleManagers.userId))
      return {
        assignments: activeRows.map(fromRow),
        revision: revised.revision,
        becameResponsibilityNeeded,
      }
    }),

  releaseForUser: async (input) =>
    db.transaction(async (tx) => {
      if (input.propertyIds?.length === 0) {
        return { released: 0 }
      }
      const activeRows = await tx
        .select()
        .from(propertyResponsibleManagers)
        .where(
          and(
            eq(propertyResponsibleManagers.organizationId, input.organizationId),
            eq(propertyResponsibleManagers.userId, input.userId),
            input.propertyIds
              ? inArray(propertyResponsibleManagers.propertyId, input.propertyIds)
              : undefined,
            isNull(propertyResponsibleManagers.effectiveTo),
          ),
        )
      if (activeRows.length === 0) {
        return { released: 0 }
      }
      const candidatePropertyIds = [...new Set(activeRows.map((row) => row.propertyId))]
      await tx
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, input.organizationId),
            inArray(properties.id, candidatePropertyIds),
          ),
        )
        .for('update')
      const releasedRows = await tx
        .update(propertyResponsibleManagers)
        .set({ effectiveTo: input.at, endReason: input.endReason })
        .where(
          and(
            eq(propertyResponsibleManagers.organizationId, input.organizationId),
            inArray(
              propertyResponsibleManagers.id,
              activeRows.map((row) => row.id),
            ),
            isNull(propertyResponsibleManagers.effectiveTo),
          ),
        )
        .returning()
      if (releasedRows.length === 0) {
        return { released: 0 }
      }
      const propertyIds = [...new Set(releasedRows.map((row) => row.propertyId))]

      for (const rawPropertyId of propertyIds) {
        const remaining = await tx
          .select({ id: propertyResponsibleManagers.id })
          .from(propertyResponsibleManagers)
          .where(
            and(
              eq(propertyResponsibleManagers.organizationId, input.organizationId),
              eq(propertyResponsibleManagers.propertyId, rawPropertyId),
              isNull(propertyResponsibleManagers.effectiveTo),
            ),
          )
          .limit(1)
        const [updated] = await tx
          .update(properties)
          .set({
            responsibleManagerRevision: sql`${properties.responsibleManagerRevision} + 1`,
            responsibilityNeededSince:
              remaining.length === 0
                ? sql`COALESCE(${properties.responsibilityNeededSince}, ${input.at})`
                : null,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(properties.organizationId, input.organizationId),
              eq(properties.id, rawPropertyId),
              isNull(properties.deletedAt),
            ),
          )
          .returning({ responsibilityNeededSince: properties.responsibilityNeededSince })
        if (updated && remaining.length === 0) {
          const event = propertyResponsibilityNeeded({
            organizationId: organizationId(input.organizationId),
            propertyId: propertyId(rawPropertyId),
            occurredAt: input.at,
          })
          await insertOutboxRow(tx, event, { recordedAt: input.at })
        }
      }
      return { released: releasedRows.length }
    }),
})
