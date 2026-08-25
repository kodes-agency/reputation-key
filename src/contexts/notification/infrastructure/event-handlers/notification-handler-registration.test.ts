import { describe, expect, it, vi } from 'vitest'
import { registerPortalNotificationHandlers } from './portal-event-handlers'
import { registerPropertyNotificationHandlers } from './property-event-handlers'

describe('notification event-handler registration', () => {
  it('registers Portal responsibility under its governed consumer identity', () => {
    const on = vi.fn()

    registerPortalNotificationHandlers({
      events: { on } as never,
      queue: {} as never,
      userLookup: {} as never,
      logger: {} as never,
    })

    expect(on).toHaveBeenCalledWith(
      'portal.responsibility_became_needed',
      expect.any(Function),
      { consumer: 'notification.portal-event-handlers' },
    )
  })

  it('registers Property responsibility under its governed consumer identity', () => {
    const on = vi.fn()

    registerPropertyNotificationHandlers({
      events: { on } as never,
      queue: {} as never,
      userLookup: {} as never,
      logger: {} as never,
    })

    expect(on).toHaveBeenCalledWith(
      'property.responsibility_became_needed',
      expect.any(Function),
      { consumer: 'notification.property-event-handlers' },
    )
  })
})
