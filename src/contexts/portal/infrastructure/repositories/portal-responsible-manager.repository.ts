import { and, asc, eq, inArray, isNotNull, isNull, notExists, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { portalResponsibleManagers, portals } from '#/shared/db/schema/portal.schema'
import { properties } from '#/shared/db/schema/property.schema'
import type { Tx } from '#/shared/outbox/commit'
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

/** A deleted or archived Portal is outside the workspace. */
const isLivePortal = (
  portal: Readonly<{ publicationState: string; deletedAt: Date | null }>,
): boolean => portal.deletedAt === null && portal.publicationState !== 'archived'

/**
 * Only a live Portal of an active Property asks for a replacement manager. A
 * deleted or archived Portal, or any Portal of a Property that is not active
 * (archived, or suspended while its Organization closes), is outside the
 * workspace: its gap is still recorded in `responsibility_needed_since`, but an
 * urgent notice would only ask admins to staff something they removed. A
 * Restore announces the gaps still open then (PortalResponsibilityRecoveryStore).
 */
async function announcesResponsibilityGap(
  tx: Tx,
  portal: Readonly<{
    organizationId: string
    propertyId: string
    publicationState: string
    deletedAt: Date | null
  }>,
): Promise<boolean> {
  if (!isLivePortal(portal)) return false
  const [property] = await tx
    .select({ lifecycleState: properties.lifecycleState })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, portal.organizationId),
        eq(properties.id, portal.propertyId),
        isNull(properties.deletedAt),
      ),
    )
    .limit(1)
  return property?.lifecycleState === 'active'
}

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
          publicationState: portals.publicationState,
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
      const announcesGap =
        becameResponsibilityNeeded &&
        (await announcesResponsibilityGap(tx, {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          publicationState: portal.publicationState,
          deletedAt: null,
        }))
      const responsibilityNeededEvent = announcesGap
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
      }
    }),

  releaseForUser: async (input) =>
    db.transaction(async (tx) => {
      if (input.portalIds?.length === 0) {
        return { released: 0 }
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
        return { released: 0 }
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
        return { released: 0 }
      }
      const portalIds = [...new Set(releasedRows.map((row) => row.portalId))].sort()

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
          .returning({
            id: portals.id,
            updatedAt: portals.updatedAt,
            publicationState: portals.publicationState,
            deletedAt: portals.deletedAt,
          })
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
        if (
          remaining.length === 0 &&
          (await announcesResponsibilityGap(tx, {
            organizationId: input.organizationId,
            propertyId: row.propertyId,
            publicationState: updated.publicationState,
            deletedAt: updated.deletedAt,
          }))
        ) {
          const event = portalResponsibilityNeeded({
            organizationId: organizationId(input.organizationId),
            propertyId: propertyId(row.propertyId),
            portalId: portalId(rawPortalId),
            sourceAggregateVersion: updated.updatedAt.toISOString(),
            occurredAt: input.at,
          })
          await insertOutboxRow(tx, event, { recordedAt: input.at })
        }
      }
      return { released: releasedRows.length }
    }),
})

export type PortalResponsibilityRecoveryStore = Readonly<{
  /**
   * Apply one `property.restored` delivery. While the Property is active,
   * every live Portal of it that still has no responsible manager raises
   * `portal.responsibility_became_needed` again: its gap was recorded
   * silently while the Property was archived, and Restore only requires a
   * manager for the Property itself. The receipt co-commits with the facts;
   * a Property archived again by delivery time makes the fact `obsolete`.
   */
  announceGapsAfterRestoreOnce: (
    input: Readonly<{
      eventId: string
      consumerName: string
      organizationId: string
      propertyId: string
      at: Date
    }>,
  ) => Promise<'applied' | 'duplicate' | 'obsolete'>
}>

export const createPortalResponsibilityRecoveryStore = (
  db: Database,
): PortalResponsibilityRecoveryStore => ({
  announceGapsAfterRestoreOnce: (input) =>
    db.transaction(async (tx) => {
      // FOR SHARE: an Archive in flight either commits first (obsolete) or
      // waits until these facts commit.
      const [property] = await tx
        .select({ lifecycleState: properties.lifecycleState })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, input.organizationId),
            eq(properties.id, input.propertyId),
            isNull(properties.deletedAt),
          ),
        )
        .for('share')
        .limit(1)
      const status = property?.lifecycleState === 'active' ? 'applied' : 'obsolete'
      const reserved = await tx
        .insert(eventConsumerReceipts)
        .values({ eventId: input.eventId, consumerName: input.consumerName, status })
        .onConflictDoNothing()
        .returning({ eventId: eventConsumerReceipts.eventId })
      if (reserved.length === 0) return 'duplicate'
      if (status === 'obsolete') return status

      // Locked like a manager replacement, so a concurrent assignment either
      // lands first (no gap left) or after this announcement.
      const unstaffed = await tx
        .select({
          id: portals.id,
          publicationState: portals.publicationState,
          deletedAt: portals.deletedAt,
          updatedAt: portals.updatedAt,
        })
        .from(portals)
        .where(
          and(
            eq(portals.organizationId, input.organizationId),
            eq(portals.propertyId, input.propertyId),
            isNull(portals.deletedAt),
            isNotNull(portals.responsibilityNeededSince),
            notExists(
              tx
                .select({ portalId: portalResponsibleManagers.portalId })
                .from(portalResponsibleManagers)
                .where(
                  and(
                    eq(portalResponsibleManagers.organizationId, portals.organizationId),
                    eq(portalResponsibleManagers.portalId, portals.id),
                    isNull(portalResponsibleManagers.effectiveTo),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(portals.id))
        .for('update', { of: portals })
      for (const portal of unstaffed.filter(isLivePortal)) {
        await insertOutboxRow(
          tx,
          portalResponsibilityNeeded({
            organizationId: organizationId(input.organizationId),
            propertyId: propertyId(input.propertyId),
            portalId: portalId(portal.id),
            sourceAggregateVersion: portal.updatedAt.toISOString(),
            occurredAt: input.at,
          }),
          { recordedAt: input.at },
        )
      }
      return status
    }),
})
