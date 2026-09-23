// Feed notification surface — what a delivered message's one-click
// unsubscribe link stands for, kept beyond queue retention. See
// `notificationUnsubscribeScopes` in the schema.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'

/**
 * The optional scopes of a frozen digest batch, written in the transaction
 * that prepares it: a batch the provider may accept always has them.
 */
export const digestUnsubscribeScopesInsert = (
  input: Readonly<{
    batchId: string
    organizationId: string
    userId: string
    memberIds: readonly string[]
    recordedAt: Date
  }>,
): SQL => sql`
  INSERT INTO notification_unsubscribe_scopes (
    target_kind, target_id, organization_id, user_id, property_id, category, created_at
  )
  SELECT DISTINCT 'digest', ${input.batchId}::uuid, organization_id, user_id, property_id,
    category, ${input.recordedAt}::timestamptz
  FROM notification_email_queue
  WHERE organization_id = ${input.organizationId}
    AND user_id = ${input.userId}
    AND id IN (${sql.join(
      input.memberIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    AND category <> 'mandatory'
    AND property_id IS NOT NULL
  ON CONFLICT DO NOTHING
`

export const createNotificationUnsubscribeScopeStore = (db: Database) => ({
  /** Idempotent: a retried send keeps the scope it already kept. */
  recordEmailUnsubscribeScope: async (
    id: string,
    orgId: string,
    recordedAt: Date,
  ): Promise<void> => {
    await db.execute(sql`
      INSERT INTO notification_unsubscribe_scopes (
        target_kind, target_id, organization_id, user_id, property_id, category, created_at
      )
      SELECT 'email', id, organization_id, user_id, property_id, category,
        ${recordedAt}::timestamptz
      FROM notification_email_queue
      WHERE id = ${id}::uuid
        AND organization_id = ${orgId}
        AND category <> 'mandatory'
        AND property_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `)
  },
})
