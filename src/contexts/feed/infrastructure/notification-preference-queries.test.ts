import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import type { Database } from '#/shared/db'
import { createNotificationPreferenceRepository } from './repositories/notification-preference.repository'

describe('notification preference reads on one client', () => {
  it.each(['delivery', 'window', 'defaults'] as const)(
    'finishes each %s query before starting the next',
    async (read) => {
      let active = 0
      let peak = 0
      let queries = 0
      const client = Object.assign(new Client(), {
        query: async () => {
          queries++
          active++
          peak = Math.max(peak, active)
          await Promise.resolve()
          active--
          return { rows: [] }
        },
      })
      const repository = createNotificationPreferenceRepository(
        drizzle(client) as unknown as Database,
      )

      if (read === 'delivery') {
        expect(
          await repository.resolveForDelivery(
            'user',
            'org',
            'property',
            'arrivals',
            'email',
          ),
        ).toMatchObject({ enabled: false })
      } else if (read === 'window') {
        expect(await repository.resolveDeliveryWindow('user', 'org', 'property')).toEqual(
          {
            quietHoursStart: null,
            quietHoursEnd: null,
            urgentBypassEnabled: false,
          },
        )
      } else {
        expect(await repository.findCategoryDefaults('user', 'org')).toEqual([])
      }

      expect(queries).toBeGreaterThan(1)
      expect(peak).toBe(1)
    },
  )
})
