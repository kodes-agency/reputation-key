import { describe, expect, it } from 'vitest'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { Notification } from '../domain/notification-types'
import { toNotificationView } from './notification-view'

const stored: Notification = {
  id: notificationId('10000000-0000-4000-8000-000000000001'),
  userId: userId('user-view'),
  organizationId: organizationId('org-view'),
  propertyId: propertyId('10000000-0000-4000-8000-000000000002'),
  type: 'inbox.escalated',
  category: 'urgent_operational',
  priority: 'urgent',
  status: 'unread',
  resourceType: 'inbox_item',
  resourceId: '10000000-0000-4000-8000-000000000003',
  eventId: 'outbox-correlation-id',
  title: 'Inbox item 10000000-0000-4000-8000-000000000003 has been escalated',
  body: 'Frozen pre-template body',
  payload: { propertyName: 'Riverside Hotel' },
  coalescedCount: 2,
  coalescedLatestAt: new Date('2026-09-22T09:00:00.000Z'),
  resolvedAt: null,
  readAt: null,
  createdAt: new Date('2026-09-20T09:00:00.000Z'),
  updatedAt: new Date('2026-09-22T09:00:00.000Z'),
}

describe('notification browser view', () => {
  it('carries only what the in-app surfaces render or act on', () => {
    expect(Object.keys(toNotificationView(stored)).sort()).toEqual([
      'category',
      'coalescedCount',
      'coalescedLatestAt',
      'createdAt',
      'id',
      'payload',
      'priority',
      'propertyId',
      'readAt',
      'resolvedAt',
      'resourceId',
      'resourceType',
      'status',
      'type',
    ])
  })

  it('never carries the correlation id or the frozen snapshot', () => {
    const wire = JSON.stringify(toNotificationView(stored))

    expect(wire).not.toContain(stored.eventId)
    expect(wire).not.toContain(stored.title)
    expect(wire).not.toContain('Frozen pre-template body')
  })
})
