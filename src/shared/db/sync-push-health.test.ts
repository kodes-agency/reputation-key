import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { readSyncPushHealth } from './sync-push-health'

async function reconciliationQuery(reconcileWithinHours = 6) {
  let selected: { overdue: SQL; oldestAgeMs: SQL } | undefined
  const where = vi.fn(async (_predicate: SQL | undefined) => [
    { overdue: 1, oldestAgeMs: 36_000_000 },
  ])
  const query = {
    from: () => query,
    innerJoin: () => query,
    leftJoin: () => query,
    where,
  }
  const db = {
    select: (fields: typeof selected) => {
      // The reconciliation age is read first; a head-cover read may follow.
      selected ??= fields
      return query
    },
  } as unknown as Database
  const health = await readSyncPushHealth(db, false, reconcileWithinHours)
  const predicate = where.mock.calls[0]?.[0]
  if (!predicate) throw new Error('Missing reconciliation predicate')
  if (!selected) throw new Error('Missing reconciliation selection')
  return {
    health,
    overdue: new PgDialect().sqlToQuery(selected.overdue),
    ...new PgDialect().sqlToQuery(predicate),
  }
}

describe('reconciliation age selection', () => {
  it.each([
    [6, 8],
    [12, 14],
    [24, 26],
  ])('uses the %ih window plus two hours of slack', async (window, limit) => {
    const query = await reconciliationQuery(window)

    expect(query.overdue.params).toContain(limit * 3_600_000)
    expect(query.health.reconciliation.overdueAfterMs).toBe(limit * 3_600_000)
    expect(query.overdue.sql).toContain('listing_complete')
    expect(query.overdue.sql).toContain('source_epoch')
    expect(query.overdue.sql).toContain('GREATEST')
  })

  it('reads no head cover up to a day: every Property has the configured limit', async () => {
    for (const window of [6, 24]) {
      const query = await reconciliationQuery(window)

      expect(query.overdue.sql).not.toContain('head_covered_at')
    }
  })

  it('above a day, limits a Property without head cover to a day plus slack', async () => {
    const query = await reconciliationQuery(168)

    expect(query.health.reconciliation.overdueAfterMs).toBe(170 * 3_600_000)
    expect(query.overdue.sql).toContain('"review_sync_state"."head_covered_at"')
    expect(query.overdue.sql).toContain('LEAST')
    expect(query.overdue.params).toEqual(
      expect.arrayContaining([170 * 3_600_000, 26 * 3_600_000, 15 * 3_600_000]),
    )
  })

  it('does not exclude failed properties from the overdue count', async () => {
    const query = await reconciliationQuery()

    expect(query.sql).not.toContain('error_class')
    expect(query.health.reconciliation).toEqual({
      overdueAfterMs: 8 * 3_600_000,
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
