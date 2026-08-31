import type { Database } from '#/shared/db'
import { inboundWebhookReceipts } from '#/shared/db/schema/review-sync.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { GbpReviewPushReceiptStore } from '../application/ports/gbp-review-push-receipt.port'

/**
 * Pub/Sub's 2xx is backed by this transaction: the receipt wins dedupe and
 * its identifier-only handoff fact is inserted together, or neither is.
 */
export const createGbpReviewPushReceiptStore = (
  db: Database,
): GbpReviewPushReceiptStore => {
  return Object.freeze({
    record: async (input) =>
      db.transaction(async (tx) => {
        const inserted = await tx
          .insert(inboundWebhookReceipts)
          .values({
            provider: 'google',
            topic: input.topic,
            messageId: input.messageId,
            receivedAt: input.receivedAt,
            acceptedAt: input.acceptedAt,
            notificationKind: input.notificationKind,
            resolvedPropertyId: input.resolvedPropertyId,
            outcome: input.outcome,
          })
          .onConflictDoNothing()
          .returning({ messageId: inboundWebhookReceipts.messageId })
        if (inserted.length === 0) return { status: 'duplicate' } as const
        if (input.event) await insertOutboxRow(tx, input.event)
        return { status: 'recorded' } as const
      }),
  })
}
