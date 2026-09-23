// The notification health reads' statement timeout against the operations
// snapshot's own patience. The snapshot stops waiting for a health signal at
// its per-signal cap; the database must give up on a stalled statement no
// later, or the query outlives the caller that asked for it.

import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { OPS_HEALTH_SIGNAL_BUDGET_MS } from '#/shared/health/operations-snapshot'
import {
  NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS,
  NotificationHealthReadTimeoutError,
  withHealthReadTimeout,
} from './repositories/health-read-timeout'

/** A database whose transaction fails the way drizzle wraps a driver error. */
const failingDb = (cause: unknown): Database =>
  ({
    transaction: async () => {
      throw Object.assign(new Error('Failed query'), { cause })
    },
  }) as unknown as Database

describe('notification health read statement timeout', () => {
  it('cancels a stalled statement before the operations snapshot stops waiting for it', () => {
    expect(NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS).toBeLessThan(
      OPS_HEALTH_SIGNAL_BUDGET_MS,
    )
  })

  it("names PostgreSQL's cancellation, wrapped or not, as the read's timeout", async () => {
    const canceled = {
      code: '57014',
      message: 'canceling statement due to statement timeout',
    }

    await expect(
      withHealthReadTimeout(failingDb(canceled), 250, async () => 0),
    ).rejects.toBeInstanceOf(NotificationHealthReadTimeoutError)
  })

  it('passes every other failure through unchanged', async () => {
    const lost = {
      code: '57P01',
      message: 'terminating connection due to administrator command',
    }

    await expect(
      withHealthReadTimeout(failingDb(lost), 250, async () => 0),
    ).rejects.toMatchObject({ message: 'Failed query', cause: lost })
  })
})
