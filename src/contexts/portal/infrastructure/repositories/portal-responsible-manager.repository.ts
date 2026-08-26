import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalResponsibleManagers, portals } from '#/shared/db/schema/portal.schema'
import { portalError } from '../../domain/errors'
import type { PortalResponsibleManager } from '../../domain/portal-responsible-manager'
import type { PortalResponsibleManagerRepository } from '../../application/ports/portal-responsible-manager.repository'
import { insertOutboxRow } from '#/shared/outbox/commit'
import {
  portalResponsibilityNeeded,
  portalResponsibleManagersUpdated,
} from '../../domain/events'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { nextLockedPortalRevision } from '../portal-command-revision'

const fromRow = (
  row: typeof portalResponsibleManagers.$inferSelect,
): PortalResponsibleManager => row

export const createPortalResponsibleManagerRepository = (
  db: Database,
): PortalResponsibleManagerRepository => ({
  listActive: async (organizationId, portalId) => {
    const rows = await db
      .select()
      .from(portalResponsibleManagers)
      .where(
        and(
          eq(portalResponsibleManagers.organizationId, organizationId),
          eq(portalResponsibleManagers.portalId, portalId),
          isNull(portalResponsibleManagers.effectiveTo),
        ),
      )
      .orderBy(asc(portalResponsibleManagers.userId))
    return rows.map(fromRow)
  },

  listActiveForUser: async (organizationId, userId) => {
    const rows = await db
      .select()
      .from(portalResponsibleManagers)
      .where(
        and(
          eq(portalResponsibleManagers.organizationId, organizationId),
          eq(portalResponsibleManagers.userId, userId),
          isNull(portalResponsibleManagers.effectiveTo),
        ),
      )
      .orderBy(asc(portalResponsibleManagers.portalId))
    return rows.map(fromRow)
  },

  replace: async (input) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM portals
        WHERE organization_id = ${input.organizationId}
          AND property_id = ${input.propertyId}
          AND id = ${input.portalId}
          AND deleted_at IS NULL
        FOR UPDATE
      `)
      const [portal] = await tx
        .select({
          id: portals.id,
          revision: portals.responsibleManagerRevision,
          responsibilityNeededSince: portals.responsibilityNeededSince,
        })
        .from(portals)
        .where(
          and(
            eq(portals.organizationId, input.organizationId),
            eq(portals.propertyId, input.propertyId),
            eq(portals.id, input.portalId),
            isNull(portals.deletedAt),
          ),
        )
        .limit(1)
      if (!portal) throw portalError('portal_not_found', 'portal not found')
      if (portal.revision !== input.expectedRevision) {
        throw portalError(
          'revision_conflict',
          'responsible managers changed; reload them',
        )
      }

      const currentRows = await tx
        .select()
        .from(portalResponsibleManagers)
        .where(
          and(
            eq(portalResponsibleManagers.organizationId, input.organizationId),
            eq(portalResponsibleManagers.portalId, input.portalId),
            isNull(portalResponsibleManagers.effectiveTo),
          ),
        )
        .orderBy(asc(portalResponsibleManagers.userId))
      const desired = new Set(input.managerUserIds)
      const current = new Set(currentRows.map((row) => row.userId))
      const rowsToEnd = currentRows.filter((row) => !desired.has(row.userId))
      const transientRowsToEnd = rowsToEnd.filter(
        (row) => row.effectiveFrom.getTime() >= input.at.getTime(),
      )
      const historicalRowsToEnd = rowsToEnd.filter(
        (row) => row.effectiveFrom.getTime() < input.at.getTime(),
      )
      const usersToInsert = input.managerUserIds.filter((userId) => !current.has(userId))

      if (rowsToEnd.length === 0 && usersToInsert.length === 0) {
        return {
          assignments: currentRows.map(fromRow),
          revision: portal.revision,
          becameResponsibilityNeeded: false,
          responsibilityNeededEvent: null,
          updatedEvent: null,
        }
      }

      if (transientRowsToEnd.length > 0) {
        await tx.delete(portalResponsibleManagers).where(
          and(
            eq(portalResponsibleManagers.organizationId, input.organizationId),
            inArray(
              portalResponsibleManagers.id,
              transientRowsToEnd.map((row) => row.id),
            ),
            isNull(portalResponsibleManagers.effectiveTo),
          ),
        )
      }
      if (historicalRowsToEnd.length > 0) {
        await tx
          .update(portalResponsibleManagers)
          .set({
            effectiveTo: input.at,
            endReason: 'responsibility_reassigned',
          })
          .where(
            and(
              eq(portalResponsibleManagers.organizationId, input.organizationId),
              inArray(
                portalResponsibleManagers.id,
                historicalRowsToEnd.map((row) => row.id),
              ),
              isNull(portalResponsibleManagers.effectiveTo),
            ),
          )
      }
      if (usersToInsert.length > 0) {
        await tx.insert(portalResponsibleManagers).values(
          usersToInsert.map((userId) => ({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            portalId: input.portalId,
            userId,
            effectiveFrom: input.at,
            createdBy: input.actorId,
          })),
        )
      }

      const nextRevision = portal.revision + 1
      const responsibilityNeededSince =
        input.managerUserIds.length === 0
          ? (portal.responsibilityNeededSince ?? input.at)
          : null
      const becameResponsibilityNeeded =
        currentRows.length > 0 && input.managerUserIds.length === 0
      const [revised] = await tx
        .update(portals)
        .set({
          responsibleManagerRevision: nextRevision,
          responsibilityNeededSince,
          updatedAt: nextLockedPortalRevision(input.at),
        })
        .where(
          and(
            eq(portals.organizationId, input.organizationId),
            eq(portals.id, input.portalId),
            eq(portals.responsibleManagerRevision, input.expectedRevision),
          ),
        )
        .returning({
          revision: portals.responsibleManagerRevision,
          updatedAt: portals.updatedAt,
        })
      if (!revised) {
        throw portalError(
          'revision_conflict',
          'responsible managers changed; reload them',
        )
      }
      const responsibilityNeededEvent = becameResponsibilityNeeded
        ? portalResponsibilityNeeded({
            organizationId: organizationId(input.organizationId),
            propertyId: propertyId(input.propertyId),
            portalId: portalId(input.portalId),
            sourceAggregateVersion: revised.updatedAt.toISOString(),
            occurredAt: input.at,
          })
        : null
      const updatedEvent = portalResponsibleManagersUpdated({
        organizationId: organizationId(input.organizationId),
        propertyId: propertyId(input.propertyId),
        portalId: portalId(input.portalId),
        assignmentCount: input.managerUserIds.length,
        sourceAggregateVersion: revised.updatedAt.toISOString(),
        occurredAt: input.at,
      })
      await insertOutboxRow(tx, updatedEvent, { recordedAt: input.at })
      if (responsibilityNeededEvent) {
        await insertOutboxRow(tx, responsibilityNeededEvent, {
          recordedAt: input.at,
        })
      }

      const activeRows = await tx
        .select()
        .from(portalResponsibleManagers)
        .where(
          and(
            eq(portalResponsibleManagers.organizationId, input.organizationId),
            eq(portalResponsibleManagers.portalId, input.portalId),
            isNull(portalResponsibleManagers.effectiveTo),
          ),
        )
        .orderBy(asc(portalResponsibleManagers.userId))
      return {
        assignments: activeRows.map(fromRow),
        revision: revised.revision,
        becameResponsibilityNeeded,
        responsibilityNeededEvent,
        updatedEvent,
      }
    }),

  releaseForUser: async (input) =>
    db.transaction(async (tx) => {
      if (input.portalIds?.length === 0) {
        return { released: 0, responsibilityNeededEvents: [] }
      }
      const activeRows = await tx
        .select()
        .from(portalResponsibleManagers)
        .where(
          and(
            eq(portalResponsibleManagers.organizationId, input.organizationId),
            eq(portalResponsibleManagers.userId, input.userId),
            input.portalIds
              ? inArray(portalResponsibleManagers.portalId, input.portalIds)
              : undefined,
            isNull(portalResponsibleManagers.effectiveTo),
          ),
        )
      if (activeRows.length === 0) {
        return { released: 0, responsibilityNeededEvents: [] }
      }
      const candidatePortalIds = [
        ...new Set(activeRows.map((row) => row.portalId)),
      ].sort()
      const lockedPortals = await tx
        .select({ id: portals.id })
        .from(portals)
        .where(
          and(
            eq(portals.organizationId, input.organizationId),
            inArray(portals.id, candidatePortalIds),
          ),
        )
        .orderBy(asc(portals.id))
        .for('update')
      if (lockedPortals.length !== candidatePortalIds.length) {
        throw portalError(
          'revision_conflict',
          'Portal responsibility scope changed during release',
        )
      }
      const transientRows = activeRows.filter(
        (row) => row.effectiveFrom.getTime() >= input.at.getTime(),
      )
      const historicalRows = activeRows.filter(
        (row) => row.effectiveFrom.getTime() < input.at.getTime(),
      )
      const deletedRows =
        transientRows.length === 0
          ? []
          : await tx
              .delete(portalResponsibleManagers)
              .where(
                and(
                  eq(portalResponsibleManagers.organizationId, input.organizationId),
                  inArray(
                    portalResponsibleManagers.id,
                    transientRows.map((row) => row.id),
                  ),
                  isNull(portalResponsibleManagers.effectiveTo),
                ),
              )
              .returning()
      const endedRows =
        historicalRows.length === 0
          ? []
          : await tx
              .update(portalResponsibleManagers)
              .set({ effectiveTo: input.at, endReason: input.endReason })
              .where(
                and(
                  eq(portalResponsibleManagers.organizationId, input.organizationId),
                  inArray(
                    portalResponsibleManagers.id,
                    historicalRows.map((row) => row.id),
                  ),
                  isNull(portalResponsibleManagers.effectiveTo),
                ),
              )
              .returning()
      const releasedRows = [...deletedRows, ...endedRows]
      if (releasedRows.length === 0) {
        return { released: 0, responsibilityNeededEvents: [] }
      }
      const portalIds = [...new Set(releasedRows.map((row) => row.portalId))].sort()

      const recoveryEvents = []
      for (const rawPortalId of portalIds) {
        const remaining = await tx
          .select({ id: portalResponsibleManagers.id })
          .from(portalResponsibleManagers)
          .where(
            and(
              eq(portalResponsibleManagers.organizationId, input.organizationId),
              eq(portalResponsibleManagers.portalId, rawPortalId),
              isNull(portalResponsibleManagers.effectiveTo),
            ),
          )
        const [row] = releasedRows.filter(
          (candidate) => candidate.portalId === rawPortalId,
        )
        const [updated] = await tx
          .update(portals)
          .set({
            responsibleManagerRevision: sql`${portals.responsibleManagerRevision} + 1`,
            responsibilityNeededSince:
              remaining.length === 0
                ? sql`COALESCE(${portals.responsibilityNeededSince}, ${input.at})`
                : null,
            updatedAt: nextLockedPortalRevision(input.at),
          })
          .where(
            and(
              eq(portals.organizationId, input.organizationId),
              eq(portals.id, rawPortalId),
            ),
          )
          .returning({ id: portals.id, updatedAt: portals.updatedAt })
        if (!updated || !row) {
          throw portalError(
            'revision_conflict',
            'Portal responsibility scope changed during release',
          )
        }
        const updatedEvent = portalResponsibleManagersUpdated({
          organizationId: organizationId(input.organizationId),
          propertyId: propertyId(row.propertyId),
          portalId: portalId(rawPortalId),
          assignmentCount: remaining.length,
          sourceAggregateVersion: updated.updatedAt.toISOString(),
          occurredAt: input.at,
        })
        await insertOutboxRow(tx, updatedEvent, { recordedAt: input.at })
        if (remaining.length === 0) {
          const event = portalResponsibilityNeeded({
            organizationId: organizationId(input.organizationId),
            propertyId: propertyId(row.propertyId),
            portalId: portalId(rawPortalId),
            sourceAggregateVersion: updated.updatedAt.toISOString(),
            occurredAt: input.at,
          })
          await insertOutboxRow(tx, event, { recordedAt: input.at })
          recoveryEvents.push(event)
        }
      }
      return {
        released: releasedRows.length,
        responsibilityNeededEvents: recoveryEvents,
      }
    }),
})
