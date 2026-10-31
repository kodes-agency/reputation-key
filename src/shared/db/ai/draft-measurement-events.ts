import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { DraftMeasurementEvent } from '#/shared/domain/draft-measurement'

/** One flag per event kind, never a client supplied counter or arbitrary payload. */
export async function recordDraftMeasurementEvent(
  db: Database,
  scope: Readonly<{
    organizationId: string
    propertyId: string
    reviewId: string
    actorUserId: string
  }>,
  event: DraftMeasurementEvent,
): Promise<void> {
  const columns = {
    shown: 'shown_at',
    dismissed: 'dismissed_at',
    superseded: 'superseded_at',
    draft: 'draft_pressed',
    try_again: 'try_again_pressed',
    shorter: 'shorter_pressed',
    tone: 'tone_pressed',
  } as const
  const column = sql.identifier(columns[event.event])
  const value = ['shown', 'dismissed', 'superseded'].includes(event.event)
    ? sql`coalesce(${column}, transaction_timestamp())`
    : sql`true`
  await db.execute(sql`
    UPDATE ai_draft_measurements SET ${column} = ${value}
    WHERE id = ${event.generationId}::uuid AND organization_id = ${scope.organizationId}
      AND property_id = ${scope.propertyId}::uuid AND review_id = ${scope.reviewId}::uuid
      AND actor_user_id = ${scope.actorUserId} AND base_reply_revision = ${event.baseReplyRevision}
      AND (${event.event !== 'superseded'} OR adopted_at IS NULL)
  `)
}
