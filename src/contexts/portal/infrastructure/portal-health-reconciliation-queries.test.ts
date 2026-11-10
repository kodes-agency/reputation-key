import { expect, it } from 'vitest'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { createPortalHealthReconciliationStore } from './portal-health-reconciliation-store'

it('reconciles Portal health without overlapping queries on its transaction', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const rows: unknown[][][] = [
    [], // BEGIN
    [[id]], // receipt
    [['active', null, 'verified']], // Property
    [[id, 'published']], // Portal
    [[id]], // activation
    [[id]], // address
    [[id]], // manager
    [], // no health interval yet
    [], // initial interval
    [], // COMMIT
  ]
  let active = 0
  let peak = 0
  let queries = 0
  const client = Object.assign(new Client(), {
    query: async () => {
      const result = rows[queries++]
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return { rows: result }
    },
  })
  const now = new Date('2026-11-10T00:00:00Z')
  const store = createPortalHealthReconciliationStore(
    drizzle(client) as unknown as Database,
    { clock: () => now, idGen: () => id },
  )

  await expect(
    store.reconcile({
      eventId: id,
      consumerName: 'portal.health',
      organizationId: 'org',
      propertyId: id,
      portalId: id,
      sourceVersion: '1',
      occurredAt: now,
    }),
  ).resolves.toEqual({ status: 'applied', changed: 0 })
  expect(queries).toBe(rows.length)
  expect(peak).toBe(1)
})
