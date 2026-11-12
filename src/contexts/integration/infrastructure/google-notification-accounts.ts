import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { withReservedPoolClients } from '#/shared/db/pool-client-reservation'
import { googleNotificationAccounts } from '#/shared/db/schema/google-notification-account.schema'
import type { GoogleNotificationAccounts } from '../application/ports/google-notification-accounts.port'
import { createGoogleCallError } from '../domain/google-call-error'

const key = (accountId: string) => createHash('sha256').update(accountId).digest('hex')

export function createGoogleNotificationAccounts(
  db: Database,
  clock: Clock,
): GoogleNotificationAccounts {
  const save = async (
    accountId: string,
    values: Partial<typeof googleNotificationAccounts.$inferInsert>,
  ) => {
    await db
      .insert(googleNotificationAccounts)
      .values({ accountKey: key(accountId), ...values })
      .onConflictDoUpdate({ target: googleNotificationAccounts.accountKey, set: values })
  }
  return {
    withAccount: async (accountId, run) =>
      withReservedPoolClients(db, 2, async () => {
        const client = await db.$client.connect()
        const lockKey = `google-notification-account:${key(accountId)}`
        let acquired = false
        let destroy = false
        try {
          const result = await client.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
            [lockKey],
          )
          acquired = result.rows[0]?.acquired === true
          if (!acquired)
            throw createGoogleCallError('subscribe', 'upstream_error', {
              executionAdmissionCode: 'coordination_unavailable',
              dispatch: 'not_sent',
            })
          return await run()
        } finally {
          if (acquired) {
            try {
              const result = await client.query<{ released: boolean }>(
                'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released',
                [lockKey],
              )
              destroy = result.rows[0]?.released !== true
            } catch {
              destroy = true
            }
          }
          client.release(destroy)
        }
      }),
    read: async (accountId) => {
      const [row] = await db
        .select()
        .from(googleNotificationAccounts)
        .where(eq(googleNotificationAccounts.accountKey, key(accountId)))
      return row
        ? {
            attemptedAt: row.attemptedAt?.getTime() ?? null,
            verifiedAt: row.verifiedAt?.getTime() ?? null,
            configuration: row.configuration,
          }
        : null
    },
    attempted: (accountId) => save(accountId, { attemptedAt: clock() }),
    verified: (accountId, configuration) =>
      save(accountId, { verifiedAt: clock(), configuration }),
    invalidate: (accountId) => save(accountId, { verifiedAt: null, configuration: null }),
  }
}
