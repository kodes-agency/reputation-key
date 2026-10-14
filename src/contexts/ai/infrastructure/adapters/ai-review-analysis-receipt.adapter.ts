import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema'
import { AI_REVIEW_ANALYSIS_CONSUMER } from '../outbox-consumers'

/**
 * Records the analysis consumer's receipt for one outbox event, for the
 * operation reaper, which reaches an event long after the consumer saw it.
 *
 * A receipt cannot outlive its event: the retention sweep deletes a published
 * event 30 days after publication and the receipt's foreign key takes it
 * along. An event that is already gone has nothing left to receipt, so this
 * writes nothing for it instead of failing the recovery that called it. The
 * insert selects from the event row, so it never names an event that is not
 * there. It keeps the first receipt of an event, as `insertReceipt` does.
 */
export const createAiReviewAnalysisReceiptWriter =
  (db: Database) =>
  async (eventId: string, status: 'applied' | 'obsolete'): Promise<void> => {
    await db
      .insert(eventConsumerReceipts)
      .select(
        db
          .select({
            eventId: outboxEvents.id,
            consumerName: sql<string>`${AI_REVIEW_ANALYSIS_CONSUMER}::text`.as(
              'consumer_name',
            ),
            status: sql<string>`${status}::text`.as('status'),
            createdAt: sql<Date>`now()`.as('created_at'),
          })
          .from(outboxEvents)
          .where(eq(outboxEvents.id, eventId)),
      )
      .onConflictDoNothing()
  }
