import { describe, it, expect } from 'vitest'
import {
  type NotificationItem,
  type NotificationPreference,
  getDefaultEnabled,
  isDisableable,
  resolvePreference,
  shouldCoalesce,
  applyCoalescence,
  buildCoalescingKey,
} from './notification-policy'

describe('NotificationPolicy', () => {
  describe('getDefaultEnabled', () => {
    it('mandatory is on for both channels', () => {
      expect(getDefaultEnabled('mandatory', 'in_app')).toBe(true)
      expect(getDefaultEnabled('mandatory', 'email')).toBe(true)
    })

    it('recognition email is off by default', () => {
      expect(getDefaultEnabled('recognition', 'email')).toBe(false)
    })

    it('recognition in-app is on by default', () => {
      expect(getDefaultEnabled('recognition', 'in_app')).toBe(true)
    })

    it('digest is off for both channels by default', () => {
      expect(getDefaultEnabled('digest_summary', 'in_app')).toBe(false)
      expect(getDefaultEnabled('digest_summary', 'email')).toBe(false)
    })

    it('workflow email is off by default', () => {
      expect(getDefaultEnabled('workflow_collaboration', 'email')).toBe(false)
    })
  })

  describe('isDisableable', () => {
    it('mandatory is not disableable', () => {
      expect(isDisableable('mandatory')).toBe(false)
    })

    it('recognition is disableable', () => {
      expect(isDisableable('recognition')).toBe(true)
    })
  })

  describe('resolvePreference', () => {
    it('uses user preference when set', () => {
      const prefs: NotificationPreference[] = [
        {
          id: 'pref-1',
          userId: 'user-1',
          organizationId: 'org-1',
          category: 'recognition',
          channel: 'email',
          enabled: true,
          propertyFilter: null,
          version: 1,
        },
      ]
      const result = resolvePreference(prefs, 'user-1', 'org-1', 'recognition', 'email')
      expect(result).toBe(true)
    })

    it('falls back to default when no preference set', () => {
      const result = resolvePreference([], 'user-1', 'org-1', 'recognition', 'email')
      expect(result).toBe(false) // default off
    })
  })

  describe('shouldCoalesce', () => {
    it('finds existing unread notification for same resource', () => {
      const existing: NotificationItem[] = [
        {
          id: 'notif-1',
          userId: 'user-1',
          organizationId: 'org-1',
          category: 'workflow_collaboration',
          resourceType: 'goal',
          resourceId: 'goal-1',
          title: 'Goal updated',
          bodyPreview: 'Progress reached 50%',
          readAt: null,
          createdAt: new Date('2026-01-01'),
          coalescedCount: 1,
          coalescedLatestAt: new Date('2026-01-01'),
          deliveryState: 'delivered',
          applicationIdempotencyKey: 'key-1',
          providerMessageId: 'msg-1',
        },
      ]
      const result = shouldCoalesce(existing, 'user-1', 'goal', 'goal-1')
      expect(result?.id).toBe('notif-1')
    })

    it('returns null when no unread match', () => {
      const existing: NotificationItem[] = [
        {
          id: 'notif-1',
          userId: 'user-1',
          organizationId: 'org-1',
          category: 'workflow_collaboration',
          resourceType: 'goal',
          resourceId: 'goal-1',
          title: 'Goal updated',
          bodyPreview: '',
          readAt: new Date(),
          createdAt: new Date(),
          coalescedCount: 1,
          coalescedLatestAt: new Date(),
          deliveryState: 'delivered',
          applicationIdempotencyKey: 'key-1',
          providerMessageId: null,
        },
      ]
      const result = shouldCoalesce(existing, 'user-1', 'goal', 'goal-1')
      expect(result).toBeNull()
    })
  })

  describe('applyCoalescence', () => {
    it('bumps count and updates latest timestamp', () => {
      const item: NotificationItem = {
        id: 'notif-1',
        userId: 'user-1',
        organizationId: 'org-1',
        category: 'workflow_collaboration',
        resourceType: 'goal',
        resourceId: 'goal-1',
        title: 'Goal updated',
        bodyPreview: '',
        readAt: null,
        createdAt: new Date('2026-01-01'),
        coalescedCount: 1,
        coalescedLatestAt: new Date('2026-01-01'),
        deliveryState: 'delivered',
        applicationIdempotencyKey: 'key-1',
        providerMessageId: null,
      }
      const result = applyCoalescence(item, new Date('2026-01-02'))
      expect(result.coalescedCount).toBe(2)
      expect(result.coalescedLatestAt).toEqual(new Date('2026-01-02'))
    })
  })

  describe('buildCoalescingKey', () => {
    it('builds key from user, type, resource (not event ID)', () => {
      const key = buildCoalescingKey('user-1', 'goal', 'goal-1')
      expect(key).toBe('user-1:goal:goal-1')
    })
  })
})
