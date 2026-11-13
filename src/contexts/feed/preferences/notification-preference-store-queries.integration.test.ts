// The preference reads inside a transaction one connection owns (real
// PostgreSQL). A job that holds a transaction hands that one client to the
// store, and node-postgres queues overlapping queries on a client with a
// deprecation warning that becomes an error in a future release: each read
// must finish a statement before it starts the next.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import * as store from './notification-preferences.server'

describe('notification preference reads on one client (real PostgreSQL)', () => {
  let held: HeldTransaction
  let db: Database
  let active = 0
  let peak = 0
  let queries = 0

  beforeAll(async () => {
    held = await holdTransaction()
    db = held.db
    const query = held.client.query.bind(held.client) as (...args: unknown[]) => unknown
    ;(held.client as unknown as { query: unknown }).query = (...args: unknown[]) => {
      queries++
      active++
      peak = Math.max(peak, active)
      const done = () => {
        active--
      }
      const result = query(...args)
      if (result instanceof Promise) return result.finally(done)
      done()
      return result
    }
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  const measured = async (read: () => Promise<unknown>): Promise<void> => {
    active = 0
    peak = 0
    queries = 0
    await read()
  }

  it.each(['delivery', 'window', 'defaults'] as const)(
    'finishes each %s query before starting the next',
    async (kind) => {
      const read =
        kind === 'delivery'
          ? () =>
              store.resolveForDelivery(
                db,
                'user',
                'org',
                '86500000-0000-4000-8000-000000000001',
                'arrivals',
                'email',
              )
          : kind === 'window'
            ? () =>
                store.resolveDeliveryWindow(
                  db,
                  'user',
                  'org',
                  '86500000-0000-4000-8000-000000000001',
                )
            : () => store.findCategoryDefaults(db, 'user', 'org')

      await measured(read)

      expect(queries).toBeGreaterThan(1)
      expect(peak).toBe(1)
    },
  )

  it('answers an account with no stored preference from the policy defaults', async () => {
    expect(await store.resolveDeliveryWindow(db, 'nobody', 'nowhere', null)).toEqual({
      quietHoursStart: null,
      quietHoursEnd: null,
      urgentBypassEnabled: false,
    })
    expect(await store.findCategoryDefaults(db, 'nobody', 'nowhere')).toEqual([])
  })
})
