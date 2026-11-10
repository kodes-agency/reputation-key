import { describe, expect, it } from 'vitest'
import { insertNotification } from './insert-notification'
import { buildFakeInsertNotificationDeps } from './test-fixtures'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'

describe('notification channel reads on a lent transaction', () => {
  it.each(['inbox_note.added', 'feedback.created'] as const)(
    'resolves %s without overlapping preference reads',
    async (type) => {
      const deps = buildFakeInsertNotificationDeps()
      const resolve = deps.preferenceRepo.resolveForDelivery
      let active = 0
      let peak = 0
      let reads = 0
      const preferenceRepo: typeof deps.preferenceRepo = {
        ...deps.preferenceRepo,
        resolveForDelivery: async (...args) => {
          reads++
          active++
          peak = Math.max(peak, active)
          await Promise.resolve()
          try {
            return await resolve(...args)
          } finally {
            active--
          }
        },
      }

      const notice = await insertNotification({ ...deps, preferenceRepo })({
        userId: userId('user'),
        organizationId: organizationId('org'),
        propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
        type,
        resourceType: 'inbox_item',
        resourceId: 'item',
        eventId: 'event',
        payload: {
          propertyName: 'Hotel',
          platform: type === 'feedback.created' ? 'portal' : 'google',
          guestRating: 1,
        },
      })

      expect(notice).toMatchObject({
        category: type === 'feedback.created' ? 'low_ratings' : 'workflow_collaboration',
      })
      expect(reads).toBeGreaterThan(1)
      expect(peak).toBe(1)
    },
  )
})
