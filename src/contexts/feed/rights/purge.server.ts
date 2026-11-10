import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { NotificationRightsScope } from './read.server'

type PurgeStep = Readonly<{
  table: string
  predicate: (scope: Required<NotificationRightsScope>) => SQL
}>

const org = (scope: NotificationRightsScope) =>
  sql`organization_id = ${scope.organizationId}`

/** Children first, so no row is left pointing at a deleted parent. */
const ORGANIZATION_STEPS: readonly PurgeStep[] = [
  { table: 'notification_digest_batch_members', predicate: org },
  { table: 'notification_digest_batches', predicate: org },
  { table: 'notification_email_queue', predicate: org },
  { table: 'notifications', predicate: org },
  { table: 'notification_preferences', predicate: org },
  { table: 'notification_category_defaults', predicate: org },
  { table: 'notification_property_delivery_windows', predicate: org },
  { table: 'notification_user_settings', predicate: org },
  { table: 'notification_unsubscribe_scopes', predicate: org },
]

const inProperty = (scope: Required<NotificationRightsScope>) =>
  sql`organization_id = ${scope.organizationId} AND property_id = ${scope.propertyId}`

/** A Property's rows only; digest batches and per-person settings span Properties. */
const PROPERTY_STEPS: readonly PurgeStep[] = [
  {
    table: 'notification_digest_batch_members',
    predicate: (scope) => sql`organization_id = ${scope.organizationId}
      AND notification_email_id IN (
        SELECT id FROM notification_email_queue
         WHERE organization_id = ${scope.organizationId}
           AND property_id = ${scope.propertyId})`,
  },
  { table: 'notification_email_queue', predicate: inProperty },
  { table: 'notifications', predicate: inProperty },
  { table: 'notification_preferences', predicate: inProperty },
  { table: 'notification_property_delivery_windows', predicate: inProperty },
  { table: 'notification_unsubscribe_scopes', predicate: inProperty },
]

export type NotificationPurgeCounts = Readonly<Record<string, number>>

/**
 * Delete the scope's rows in bounded batches, one statement per batch. Each
 * statement stands alone, so a stopped run resumes by running again: a
 * finished table matches zero rows. Every predicate names the Organization.
 */
export async function purgeNotificationRightsData(
  db: Pick<Database, 'execute'>,
  scope: NotificationRightsScope,
  batchSize: number,
): Promise<NotificationPurgeCounts> {
  const steps = scope.propertyId ? PROPERTY_STEPS : ORGANIZATION_STEPS
  const counts: Record<string, number> = {}
  for (const step of steps) {
    const table = sql.identifier(step.table)
    const where = step.predicate(scope as Required<NotificationRightsScope>)
    let deleted = batchSize
    let total = 0
    while (deleted === batchSize) {
      const result = await db.execute(sql`
        DELETE FROM ${table}
         WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${where} LIMIT ${batchSize})`)
      deleted = result.rowCount ?? 0
      total += deleted
    }
    counts[step.table] = total
  }
  return counts
}

/** Rows the purge would delete, per table, so a report sizes the whole purge. */
export async function countNotificationRightsData(
  db: Pick<Database, 'execute'>,
  scope: NotificationRightsScope,
): Promise<NotificationPurgeCounts> {
  const steps = scope.propertyId ? PROPERTY_STEPS : ORGANIZATION_STEPS
  const counts: Record<string, number> = {}
  for (const step of steps) {
    const result = await db.execute(sql`
      SELECT count(*)::int AS n FROM ${sql.identifier(step.table)}
       WHERE ${step.predicate(scope as Required<NotificationRightsScope>)}`)
    counts[step.table] = Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0)
  }
  return counts
}
