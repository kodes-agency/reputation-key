import { expect, it } from 'vitest'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createGoogleRatingReads } from './google-rating-reads'

it('reads rating aggregates sequentially on a lent client', async () => {
  let active = 0
  let peak = 0
  const client = Object.assign(new Client(), {
    query: async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return { rows: [] }
    },
  })
  const now = new Date('2026-11-10T00:00:00Z')
  const reads = createGoogleRatingReads({
    db: drizzle(client) as unknown as Database,
    clock: () => now,
  })

  const summary = await reads.getRatingSummary(
    organizationId('org'),
    propertyId('11111111-1111-4111-8111-111111111111'),
    { mixWindowStart: now, mostRecentLimit: 10, countSince: [] },
  )

  expect(summary).toMatchObject({
    all: { count: 0, sum: 0 },
    mostRecent: { count: 0, sum: 0 },
  })
  expect(peak).toBe(1)
})
