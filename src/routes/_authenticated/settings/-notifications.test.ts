import { describe, expect, it, vi } from 'vitest'

vi.mock('#/contexts/feed/server/notifications', () => ({
  getNotificationPreferencesFn: vi.fn(),
  updateNotificationPreferenceFn: vi.fn(),
  updateNotificationQuietHoursFn: vi.fn(),
  resetNotificationPropertyCategoryFn: vi.fn(),
}))
vi.mock('#/routes/-queries/route-queries', () => ({
  notificationUserSettingsQuery: vi.fn(),
  propertiesQuery: {},
}))
vi.mock('#/shared/auth/controlled-route-check', () => ({
  checkControlledRoute: vi.fn(),
}))

import { Route } from './notifications'

const PROPERTY_ID = '0b9d7c1a-3e5f-4b2a-8c6d-1e2f3a4b5c6d'

/** The route's search reader, as the router calls it. */
const readSearch = Route.options.validateSearch as (
  search: Record<string, unknown>,
) => Readonly<{ propertyId?: string }>

describe('Notification settings address', () => {
  it('reads the property whose preferences are being edited', () => {
    expect(readSearch({ propertyId: PROPERTY_ID })).toEqual({ propertyId: PROPERTY_ID })
  })

  // The router reads `?propertyId=42` as a number, and a Property's id is a
  // UUID. The page then opens on its default property, as it does for an id
  // that is not in the list.
  it('drops a property it cannot read instead of failing the page', () => {
    expect(readSearch({ propertyId: 42 })).toEqual({})
    expect(readSearch({ propertyId: 'property-1' })).toEqual({})
  })
})
