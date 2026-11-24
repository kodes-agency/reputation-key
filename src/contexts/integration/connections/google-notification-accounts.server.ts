import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { withSessionAdvisoryLock } from '#/shared/db/session-advisory-lock'
import { withReservedPoolClients } from '#/shared/db/pool-client-reservation'
import { googleNotificationAccounts } from '#/shared/db/schema/google-notification-account.schema'
import type { GoogleNotificationAccounts } from './google-notification-accounts.port.server'
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
      withReservedPoolClients(db, 2, () =>
        withSessionAdvisoryLock(
          db,
          `google-notification-account:${key(accountId)}`,
          run,
          () => {
            throw createGoogleCallError('subscribe', 'upstream_error', {
              executionAdmissionCode: 'coordination_unavailable',
              dispatch: 'not_sent',
            })
          },
        ),
      ),
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
