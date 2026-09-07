import type { Database } from '#/shared/db'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
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
        const key = JSON.stringify(['google', input.topic, input.messageId])
        const inserted = await tx
          .insert(idempotencyReceipts)
          .values({
            scope: 'gbp_webhook',
            key,
            payload: {
              provider: 'google',
              topic: input.topic,
              messageId: input.messageId,
              acceptedAt: input.acceptedAt?.toISOString() ?? null,
              notificationKind: input.notificationKind,
              resolvedPropertyId: input.resolvedPropertyId,
              outcome: input.outcome,
            },
            recordedAt: input.receivedAt,
          })
          .onConflictDoNothing()
          .returning({ key: idempotencyReceipts.key })
        if (inserted.length === 0) return { status: 'duplicate' } as const
        if (input.event) await insertOutboxRow(tx, input.event)
        return { status: 'recorded' } as const
      }),
  })
}
