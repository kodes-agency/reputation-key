import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { readSyncPushHealth } from './sync-push-health'

async function reconciliationQuery() {
  const where = vi.fn(async (_predicate: SQL | undefined) => [
    { overdue: 1, oldestAgeMs: 36_000_000 },
  ])
  const query = {
    from: () => query,
    innerJoin: () => query,
    leftJoin: () => query,
    where,
  }
  const db = { select: () => query } as unknown as Database
  const health = await readSyncPushHealth(db, false)
  const predicate = where.mock.calls[0]?.[0]
  if (!predicate) throw new Error('Missing reconciliation predicate')
  return { health, ...new PgDialect().sqlToQuery(predicate) }
}

describe('reconciliation age selection', () => {
  it('does not exclude failed properties from the overdue count', async () => {
    const query = await reconciliationQuery()

    expect(query.sql).not.toContain('error_class')
    expect(query.health.reconciliation).toEqual({
      overdueCount: 1,
      oldestAgeMs: 36_000_000,
    })
  })

  it('still requires an active connection, which leaves out reauth_required and provider_revoked', async () => {
    const query = await reconciliationQuery()

    // Revocation is recorded as reauth_required with status_reason provider_revoked.
    expect(query.sql).toContain('"google_connections"."status" =')
    expect(query.sql).toContain('"google_connections"."credential_use_state" =')
  })
})

describe('push health listing evidence', () => {
  const firstSeenAt = new Date('2026-11-06T16:18:35Z')
  const hoursBefore = (hours: number) =>
    new Date(firstSeenAt.getTime() - hours * 3_600_000)

  function queryReturning(rows: readonly object[]) {
    return Object.assign(Promise.resolve(rows), {
      from() {
        return this
      },
      innerJoin() {
        return this
      },
      leftJoin() {
        return this
      },
      where() {
        return this
      },
      orderBy() {
        return this
      },
      limit() {
        return this
      },
    })
  }

  it.each([
    { previousListingAt: hoursBefore(6).toISOString(), missed: 0 },
    { previousListingAt: null, missed: 2 },
  ])(
    'classifies the polled batch with previous listing $previousListingAt',
    async ({ previousListingAt, missed }) => {
      const rows = [19, 23.6, 48, 72, 84, 96].map((hours) => ({
        organizationId: 'org',
        propertyId: 'property',
        connectionId: 'connection',
        accountId: 'account',
        firstSeenVia: 'snapshot',
        firstSeenAt,
        pushAcceptedAt: null,
        sourceCreatedAt: hoursBefore(hours),
        previousListingAt,
      }))
      const db = {
        select: vi
          .fn()
          .mockReturnValueOnce(
            queryReturning([
              {
                byPush: 0,
                byPoll: 6,
                locations: 1,
                nowMs: firstSeenAt.getTime() + 2 * 3_600_000,
              },
            ]),
          )
          .mockReturnValueOnce(queryReturning(rows))
          .mockReturnValueOnce(queryReturning([{ accepted: 0 }]))
          .mockReturnValueOnce(queryReturning([{ overdue: 0, oldestAgeMs: null }])),
      } as unknown as Database

      expect((await readSyncPushHealth(db, true)).push).toEqual({
        newByPush24h: 0,
        newByPoll24h: missed,
        pending: 0,
        missed24h: missed,
        late24h: 0,
        acceptedPushes24h: 0,
        locationsHealthy: missed === 0 ? 1 : 0,
        locationsSuspect: missed === 0 ? 0 : 1,
        accountsDark: missed === 0 ? 0 : 1,
      })
    },
  )
})
