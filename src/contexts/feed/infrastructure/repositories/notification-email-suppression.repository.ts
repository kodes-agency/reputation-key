// Feed notification surface — durable, address-keyed email suppression
// (ADR 0046 r.6). Composed into the email repository; see
// `notificationEmailSuppressions` in the schema for why it stands apart from
// the queue.

import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notificationEmailSuppressions } from '#/shared/db/schema/notification.schema'
import type { EmailSuppressionReason } from '../../application/ports/notification-email-repository.port'

/**
 * The only form in which an address is stored. Mailbox providers treat the
 * address case-insensitively, so one mailbox must have one key however its
 * owner's record spells it.
 */
const addressHash = (address: string): string =>
  createHash('sha256').update(address.trim().toLowerCase(), 'utf8').digest('hex')

export const createNotificationEmailSuppressionStore = (db: Database) => ({
  isAddressSuppressed: async (address: string): Promise<boolean> => {
    const rows = await db
      .select({ addressHash: notificationEmailSuppressions.addressHash })
      .from(notificationEmailSuppressions)
      .where(eq(notificationEmailSuppressions.addressHash, addressHash(address)))
      .limit(1)
    return rows.length > 0
  },

  /** Idempotent: a repeated event only refreshes the reason and its time. */
  suppressAddress: async (
    address: string,
    reason: EmailSuppressionReason,
    at: Date,
  ): Promise<void> => {
    await db
      .insert(notificationEmailSuppressions)
      .values({ addressHash: addressHash(address), reason, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: notificationEmailSuppressions.addressHash,
        set: { reason: sql`excluded.reason`, updatedAt: sql`excluded.updated_at` },
      })
  },
})
