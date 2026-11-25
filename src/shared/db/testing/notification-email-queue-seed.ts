// A raw notification_email_queue row for suites that seed the table in SQL and
// delete it again. Clocks are SQL fragments, usually relative to NOW(), so a
// suite can assert ages without drifting by the time a row took to write.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type EmailQueueRowSeed = Readonly<{
  /** The row's idempotency key. */
  key: string
  status: string
  organizationId: string
  propertyId: string | null
  userId: string
  category?: string
  cadence?: string
  priority?: string
  lastErrorClass?: string
  retryCount?: number
  providerMessageId?: string
  providerState?: string
  suppressionReason?: string
  /** SQL fragments for the clocks; the column is NULL when omitted. */
  notBefore?: SQL
  nextAttemptAt?: SQL
  attemptedAt?: SQL
  acceptedAt?: SQL
  failedAt?: SQL
  deliveredAt?: SQL
  bouncedAt?: SQL
  /** Defaults to NOW(). */
  createdAt?: SQL
}>

const NULL_CLOCK = sql`NULL`

/** Inserts the row and returns its id. */
export async function insertEmailQueueRow(
  db: Database,
  seed: EmailQueueRowSeed,
): Promise<string> {
  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO notification_email_queue (
      notification_id, user_id, organization_id, property_id,
      category, cadence, status, priority, idempotency_key,
      provider_message_id, provider_state, last_error_class, retry_count,
      suppression_reason,
      not_before, next_attempt_at, attempted_at,
      accepted_at, failed_at, delivered_at, bounced_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${seed.userId}, ${seed.organizationId}, ${seed.propertyId},
      ${seed.category ?? 'review'}, ${seed.cadence ?? 'daily'}, ${seed.status},
      ${seed.priority ?? 'normal'}, ${seed.key},
      ${seed.providerMessageId ?? null}, ${seed.providerState ?? null},
      ${seed.lastErrorClass ?? null}, ${seed.retryCount ?? 0},
      ${seed.suppressionReason ?? null},
      ${seed.notBefore ?? NULL_CLOCK}, ${seed.nextAttemptAt ?? NULL_CLOCK},
      ${seed.attemptedAt ?? NULL_CLOCK},
      ${seed.acceptedAt ?? NULL_CLOCK}, ${seed.failedAt ?? NULL_CLOCK},
      ${seed.deliveredAt ?? NULL_CLOCK}, ${seed.bouncedAt ?? NULL_CLOCK},
      ${seed.createdAt ?? sql`NOW()`}, NOW()
    ) RETURNING id::text AS id
  `)
  return inserted.rows[0]!.id
}
