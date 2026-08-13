import { describe, expect, it } from 'vitest'
import {
  applyCoalescence,
  getDefaultEnabled,
  isDisableable,
  resolvePreference,
  shouldCoalesce,
  type GovernedNotificationPreference,
  type NotificationItem,
} from './notification-policy'

const preference: GovernedNotificationPreference = {
  id: 'preference-1',
  userId: 'user-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  category: 'workflow_collaboration',
  channel: 'email',
  enabled: true,
  cadence: 'daily',
  urgentBypassEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  version: 1,
}

const item: NotificationItem = {
  id: 'notification-1',
  userId: 'user-1',
  organizationId: 'org-1',
  category: 'workflow_collaboration',
  resourceType: 'goal',
  resourceId: 'goal-1',
  title: 'Goal update',
  bodyPreview: '',
  readAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  coalescedCount: 1,
  coalescedLatestAt: new Date('2026-01-01T00:00:00.000Z'),
  deliveryState: 'pending',
  applicationIdempotencyKey: 'key-1',
  providerMessageId: null,
}

describe('notification policy', () => {
  it('resolves preferences only for the exact tenant and property', () => {
    expect(
      resolvePreference(
        [preference],
        'user-1',
        'org-1',
        'property-1',
        'workflow_collaboration',
        'email',
      ),
    ).toBe(true)
    expect(
      resolvePreference(
        [preference],
        'user-1',
        'org-1',
        'property-2',
        'workflow_collaboration',
        'email',
      ),
    ).toBe(false)
  })

  it('keeps mandatory channels enabled and non-disableable by default', () => {
    expect(getDefaultEnabled('mandatory', 'email')).toBe(true)
    expect(isDisableable('mandatory')).toBe(false)
  })

  it('coalesces only matching unread user/resource notifications', () => {
    expect(shouldCoalesce([item], 'user-1', 'goal', 'goal-1')).toEqual(item)
    expect(shouldCoalesce([item], 'user-2', 'goal', 'goal-1')).toBeNull()
  })

  it('increments coalesced count and latest timestamp', () => {
    const latest = new Date('2026-01-02T00:00:00.000Z')
    expect(applyCoalescence(item, latest)).toMatchObject({
      coalescedCount: 2,
      coalescedLatestAt: latest,
    })
  })
})
