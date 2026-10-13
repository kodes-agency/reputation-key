import type { Database } from '#/shared/db'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type {
  GbpReviewPushDelivery,
  GbpReviewPushReceiptStore,
} from '../application/ports/gbp-review-push-receipt.port'

/**
 * Pub/Sub's 2xx is backed by this transaction: the receipt wins dedupe and
 * its identifier-only handoff facts are inserted together, or none is.
 *
 * The message's own row is keyed by provider, topic and message id, and decides
 * a redelivery. It names the first delivery's Property. Each further delivery
 * (the same location held by another Organization) gets a row of its own under
 * the same key extended by its Property, so every row names exactly one
 * Property: an Organization purge deletes these rows by the Property they name,
 * and must remove its own without touching, or leaving, another's.
 */
export const createGbpReviewPushReceiptStore = (
  db: Database,
): GbpReviewPushReceiptStore => {
  return Object.freeze({
    record: async (input) =>
      db.transaction(async (tx) => {
        const messageKey = ['google', input.topic, input.messageId]
        const receiptRow = (
          key: readonly unknown[],
          delivery: GbpReviewPushDelivery,
        ) => ({
          scope: 'gbp_webhook',
          key: JSON.stringify(key),
          payload: {
            provider: 'google',
            topic: input.topic,
            messageId: input.messageId,
            acceptedAt: input.acceptedAt?.toISOString() ?? null,
            notificationKind: input.notificationKind,
            resolvedPropertyId: delivery.resolvedPropertyId,
            outcome: delivery.outcome,
          },
          recordedAt: input.receivedAt,
        })
        const [first, ...further] = input.deliveries
        const inserted = await tx
          .insert(idempotencyReceipts)
          .values(receiptRow(messageKey, first))
          .onConflictDoNothing()
          .returning({ key: idempotencyReceipts.key })
        if (inserted.length === 0) return { status: 'duplicate' } as const
        if (further.length > 0) {
          await tx
            .insert(idempotencyReceipts)
            .values(
              further.map((delivery) =>
                receiptRow([...messageKey, delivery.resolvedPropertyId], delivery),
              ),
            )
        }
        for (const delivery of input.deliveries) {
          if (delivery.event) await insertOutboxRow(tx, delivery.event)
        }
        return { status: 'recorded' } as const
      }),
  })
}
