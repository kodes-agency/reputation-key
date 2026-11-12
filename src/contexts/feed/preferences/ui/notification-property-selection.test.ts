import { describe, expect, it } from 'vitest'
import { notificationPropertyScopeKey } from './notification-property-selection'

describe('notification property selection', () => {
  it('keeps the remount boundary stable when only list order changes', () => {
    expect(
      notificationPropertyScopeKey([{ id: 'property-2' }, { id: 'property-1' }]),
    ).toBe(notificationPropertyScopeKey([{ id: 'property-1' }, { id: 'property-2' }]))
  })

  it('changes the remount boundary when property access changes', () => {
    expect(notificationPropertyScopeKey([{ id: 'property-1' }])).not.toBe(
      notificationPropertyScopeKey([{ id: 'property-1' }, { id: 'property-2' }]),
    )
  })
})
