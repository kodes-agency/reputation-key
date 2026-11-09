// Feed notification surface — durable, address-keyed email suppression
// (ADR 0046 r.6). Composed into the email repository; see
// `notificationEmailSuppressions` in the schema for why it stands apart from
// the queue.

import { createHmac } from 'node:crypto'
import { and, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationEmailSuppressionRemovals,
  notificationEmailSuppressions,
  resendWebhookDeliveries,
} from '#/shared/db/schema/notification.schema'
import type { EmailSuppressionReason } from '../../application/ports/notification-email-repository.port'

/**
 * Domain separation: the composition passes a server secret shared with other
 * pseudonyms, and this label keeps these digests unlinkable to theirs.
 */
const ADDRESS_DIGEST_DOMAIN = 'repkey:notification:email-suppression:v1\0'

/**
 * Mailbox providers treat the address case-insensitively, so one mailbox must
 * have one key however a user record or a provider event spells it. This is
 * the only normalisation: nothing else, SQL included, derives a key.
 */
const normalizeAddress = (address: string): string => address.trim().toLowerCase()

/**
 * The only form in which an address is stored: a keyed HMAC-SHA-256. A bare
 * digest of an address can be reversed by hashing a list of candidate
 * addresses; this one cannot without the key. Changing the key would empty the
 * list in effect, so a key being replaced is kept as retired until the entries
 * stored under it have moved (see `isAddressSuppressed`).
 */
const addressDigest = (key: string, address: string): string =>
  createHmac('sha256', key)
    .update(ADDRESS_DIGEST_DOMAIN, 'utf8')
    .update(normalizeAddress(address), 'utf8')
    .digest('hex')

export const createNotificationEmailSuppressionStore = (
  db: Database,
  key: string | undefined,
  /** Keys entries may still be stored under; never written with. */
  retiredKeys: readonly string[] = [],
) => {
  // Fail closed: without its key the store cannot tell a refused address from
  // a live one, and guessing would either mail a complainer or mail no one.
  const digestOf = (address: string): string => {
    if (!key) throw new Error('Email address suppression requires its key')
    return addressDigest(key, address)
  }
  const everyDigestOf = (address: string): string[] => [
    digestOf(address),
    ...retiredKeys
      .filter((retired) => retired !== key)
      .map((retired) => addressDigest(retired, address)),
  ]

  return {
    /**
     * An entry found only under a retired key is copied under the current one
     * as it matches, so every address still being mailed moves before the
     * retired key stops being honoured (a rotated auth secret, say).
     */
    isAddressSuppressed: async (address: string): Promise<boolean> => {
      const current = digestOf(address)
      const rows = await db
        .select({
          addressHash: notificationEmailSuppressions.addressHash,
          reason: notificationEmailSuppressions.reason,
          createdAt: notificationEmailSuppressions.createdAt,
        })
        .from(notificationEmailSuppressions)
        .where(inArray(notificationEmailSuppressions.addressHash, everyDigestOf(address)))
      const [found] = rows
      if (found === undefined) return false
      if (!rows.some((row) => row.addressHash === current)) {
        await db
          .insert(notificationEmailSuppressions)
          .values({
            addressHash: current,
            reason: found.reason,
            createdAt: found.createdAt,
            updatedAt: found.createdAt,
          })
          .onConflictDoNothing()
      }
      return true
    },

    /**
     * Idempotent: a repeated event only refreshes the reason and its time. An
     * event is applied in the order it happened: one before the last
     * lifting of the address, or older than the refusal already held, changes
     * nothing and answers false.
     */
    suppressAddress: async (
      address: string,
      reason: EmailSuppressionReason,
      at: Date,
    ): Promise<boolean> => {
      const stamp = at.toISOString()
      const result = await db.execute(sql`
        INSERT INTO notification_email_suppressions (address_hash, reason, created_at, updated_at)
        SELECT ${digestOf(address)}, ${reason}, ${stamp}::timestamptz, ${stamp}::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM notification_email_suppression_removals
          WHERE address_hash IN (${sql.join(
            everyDigestOf(address).map((digest) => sql`${digest}`),
            sql`, `,
          )})
          AND removed_at > ${stamp}::timestamptz
        )
        ON CONFLICT (address_hash) DO UPDATE
          SET reason = excluded.reason, updated_at = excluded.updated_at
          WHERE notification_email_suppressions.updated_at <= excluded.updated_at
        RETURNING address_hash
      `)
      return result.rows.length > 0
    },

    /**
     * Idempotent: forgetting an address that is not refused is a no-op. Every
     * key it may be stored under, or a retired copy would refuse it again.
     * With `at`, only a refusal no newer than the lifting goes, and the
     * lifting is remembered so a late bounce from before it is not applied.
     */
    forgetAddress: async (address: string, at?: Date): Promise<void> => {
      const digests = everyDigestOf(address)
      if (at === undefined) {
        await db
          .delete(notificationEmailSuppressions)
          .where(inArray(notificationEmailSuppressions.addressHash, digests))
        await db
          .delete(notificationEmailSuppressionRemovals)
          .where(inArray(notificationEmailSuppressionRemovals.addressHash, digests))
        return
      }
      await db
        .delete(notificationEmailSuppressions)
        .where(
          and(
            inArray(notificationEmailSuppressions.addressHash, digests),
            lte(notificationEmailSuppressions.updatedAt, at),
          ),
        )
      await db
        .insert(notificationEmailSuppressionRemovals)
        .values({ addressHash: digestOf(address), removedAt: at })
        .onConflictDoUpdate({
          target: notificationEmailSuppressionRemovals.addressHash,
          set: {
            removedAt: sql`greatest(${notificationEmailSuppressionRemovals.removedAt}, excluded.removed_at)`,
          },
        })
    },

    hasAppliedProviderEvent: async (eventId: string): Promise<boolean> => {
      const [found] = await db
        .select({ eventId: resendWebhookDeliveries.eventId })
        .from(resendWebhookDeliveries)
        .where(inArray(resendWebhookDeliveries.eventId, [eventId]))
      return found !== undefined
    },

    markProviderEventApplied: async (eventId: string): Promise<void> => {
      await db.insert(resendWebhookDeliveries).values({ eventId }).onConflictDoNothing()
    },
  }
}
