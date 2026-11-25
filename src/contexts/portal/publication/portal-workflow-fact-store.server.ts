import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portals } from '#/shared/db/schema/portal.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRowIfNew, type Tx } from '#/shared/outbox/commit'
import { portalContentReviewCompleted } from '../domain/events'
import { portalError } from '../domain/errors'
import type {
  PortalWorkflowFactCommand,
  PortalWorkflowFactResult,
  PortalWorkflowFactStore,
} from './complete-content-review.server'
import { nextLockedPortalRevision } from './portal-command-revision.server'

/** Lock the Portal and refuse anything but published content. */
async function lockPublishedPortal(
  tx: Tx,
  command: PortalWorkflowFactCommand,
): Promise<void> {
  const [locked] = await tx
    .select({ publicationState: portals.publicationState })
    .from(portals)
    .where(
      and(
        eq(portals.organizationId, command.organizationId),
        eq(portals.propertyId, command.propertyId),
        eq(portals.id, command.portalId),
        isNull(portals.deletedAt),
      ),
    )
    .for('update')
  if (!locked) {
    throw portalError(
      'portal_not_found',
      'portal not found in the requested tenant scope',
    )
  }
  if (locked.publicationState !== 'published') {
    throw portalError(
      'invalid_publication_transition',
      'content review can only be completed for published Portal content',
    )
  }
}

export const createPortalWorkflowFactStore = (db: Database): PortalWorkflowFactStore => {
  return {
    recordCompletedReview: async (
      command: PortalWorkflowFactCommand,
    ): Promise<PortalWorkflowFactResult> => {
      return db.transaction(async (tx) => {
        await lockPublishedPortal(tx, command)
        const existing = await tx
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.organizationId, command.organizationId),
              eq(outboxEvents.propertyId, command.propertyId),
              eq(outboxEvents.sourceContext, 'portal'),
              eq(outboxEvents.sourceAggregateId, command.reviewId),
              eq(outboxEvents.eventType, 'portal.content_review.completed'),
              sql`${outboxEvents.payload}->>'portalId' = ${command.portalId}`,
              sql`${outboxEvents.payload}->>'revision' = ${String(command.revision)}`,
            ),
          )
          .limit(1)
        if (existing.length > 0) {
          return { status: 'duplicate' as const, events: [] }
        }
        const [updated] = await tx
          .update(portals)
          .set({ updatedAt: nextLockedPortalRevision(command.occurredAt) })
          .where(
            and(
              eq(portals.organizationId, command.organizationId),
              eq(portals.propertyId, command.propertyId),
              eq(portals.id, command.portalId),
            ),
          )
          .returning({ updatedAt: portals.updatedAt })
        if (!updated) {
          throw portalError(
            'revision_conflict',
            'Portal changed while the content review was being committed',
          )
        }
        const fact = portalContentReviewCompleted({
          reviewId: command.reviewId,
          revision: command.revision,
          organizationId: command.organizationId,
          propertyId: command.propertyId,
          portalId: command.portalId,
          portalGroupId: command.portalGroupId,
          sourceAggregateVersion: updated.updatedAt.toISOString(),
          occurredAt: command.occurredAt,
          supersedesSourceEventId: command.supersedes?.contentReviewSourceEventId ?? null,
        })
        if (!(await insertOutboxRowIfNew(tx, fact))) {
          throw new Error('Portal content review fact was not recorded')
        }
        return { status: 'recorded' as const, events: [fact] }
      })
    },
  }
}
