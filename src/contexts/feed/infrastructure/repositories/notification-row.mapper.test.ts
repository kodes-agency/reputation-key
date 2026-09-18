import { describe, expect, it } from 'vitest'
import { NOTIFICATION_RESOURCE_TYPES } from '../../domain/notification-types'
import { notificationFromRow, type NotificationRow } from './notification-row.mapper'

const AT = new Date('2026-09-18T10:00:00.000Z')

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    organizationId: 'org-1',
    propertyId: '11111111-1111-4111-8111-111111111111',
    type: 'review.created',
    category: 'workflow_collaboration',
    priority: 'normal',
    status: 'unread',
    resourceType: 'inbox_item',
    resourceId: 'item-1',
    eventId: 'event-1',
    title: 'x',
    body: null,
    payload: {},
    coalescedCount: 1,
    coalescedLatestAt: null,
    readAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as NotificationRow
}

describe('notification row mapper', () => {
  // Regression: the constructor and this mapper kept separate resource-type
  // lists. `beta_feedback_report` was added to one, so the insert wrote a row
  // the read-back then refused — found only by running the real path live.
  it.each(NOTIFICATION_RESOURCE_TYPES)(
    'reads back a row pointing at %s',
    (resourceType) => {
      expect(notificationFromRow(row({ resourceType })).resourceType).toBe(resourceType)
    },
  )

  it('reads back an Organization-scoped report outcome (ADR 0059)', () => {
    expect(
      notificationFromRow(
        row({
          propertyId: null,
          type: 'beta_feedback.outcome',
          resourceType: 'beta_feedback_report',
          resourceId: '00000000-0000-4000-8000-0000000000f1',
          payload: { reportOutcome: 'resolved' },
        }),
      ),
    ).toMatchObject({
      propertyId: null,
      type: 'beta_feedback.outcome',
      resourceType: 'beta_feedback_report',
      payload: { reportOutcome: 'resolved' },
    })
  })

  it('still refuses a resource type nobody declared', () => {
    expect(() => notificationFromRow(row({ resourceType: 'spaceship' }))).toThrow(
      /Invalid notification\.resourceType: spaceship/u,
    )
  })
})
