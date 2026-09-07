import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { OneClickUnsubscribeTarget } from '../../application/one-click-unsubscribe-token'

function targetScopes(target: OneClickUnsubscribeTarget): SQL {
  if (target.kind === 'email') {
    return sql`
      SELECT user_id, organization_id, property_id, category
      FROM notification_email_queue
      WHERE id = ${target.id}::uuid
    `
  }
  return sql`
    SELECT q.user_id, q.organization_id, q.property_id, q.category
    FROM notification_digest_batch_members AS member
    JOIN notification_email_queue AS q
      ON q.id = member.notification_email_id
     AND q.organization_id = member.organization_id
     AND q.user_id = member.user_id
    WHERE member.batch_id = ${target.id}::uuid
  `
}

/**
 * Apply the bearer capability to the exact optional scopes represented by the
 * delivered queue row or immutable digest batch. The INSERT/UPSERT is one SQL
 * statement: a multi-Property digest cannot be half-unsubscribed.
 */
export const createOneClickUnsubscribeRepository = (db: Database) => ({
  apply: async (target: OneClickUnsubscribeTarget, now: Date): Promise<number> => {
    const result = await db.execute(sql`
      WITH represented_scopes AS (${targetScopes(target)}),
      optional_scopes AS (
        SELECT DISTINCT user_id, organization_id, property_id, category
        FROM represented_scopes
        WHERE category <> 'mandatory'
      )
      INSERT INTO notification_preferences (
        id,
        user_id,
        organization_id,
        property_id,
        category,
        channel,
        enabled,
        cadence,
        urgent_bypass_enabled,
        quiet_hours_start,
        quiet_hours_end,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid(),
        user_id,
        organization_id,
        property_id,
        category,
        'email',
        FALSE,
        CASE WHEN category = 'urgent_operational' THEN 'immediate' ELSE 'daily' END,
        FALSE,
        NULL,
        NULL,
        ${now},
        ${now}
      FROM optional_scopes
      ON CONFLICT (user_id, organization_id, property_id, category, channel)
      DO UPDATE SET
        enabled = FALSE,
        updated_at = EXCLUDED.updated_at
      RETURNING id
    `)
    return result.rowCount ?? result.rows.length
  },
})
