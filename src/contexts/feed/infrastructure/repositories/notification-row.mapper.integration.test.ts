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

  // The coalescing count column is the one record of how often a row repeated.
  // Its copy reads the count from the payload, so the read projects the column
  // there: a row coalesced by the insert race, whose payload never got the
  // count, still says it, and a stale payload count never outvotes the column.
  it.each([
    [3, {}, 3],
    [2, { occurrences: 7 }, 2],
    [1, { occurrences: 4 }, undefined],
  ])(
    'reads a coalesced count of %i with payload %j as occurrences %s',
    (coalescedCount, payload, occurrences) => {
      expect(
        notificationFromRow(row({ coalescedCount, payload })).payload.occurrences,
      ).toBe(occurrences)
    },
  )

  // A wait is read as it stood when the row's latest event was raised, the
  // instant the row shows, so an item answered since never reads as still
  // waiting and an unread row's age never grows.
  it.each([
    ['a row that fired once, to its creation', null, 72],
    ['a coalesced row, to its latest event', new Date('2026-09-19T10:00:00.000Z'), 96],
  ])('measures the wait of %s', (_case, coalescedLatestAt, waitedHours) => {
    const read = notificationFromRow(
      row({
        type: 'inbox.escalated',
        payload: { waitingSince: '2026-09-15T10:00:00.000Z' },
        coalescedCount: coalescedLatestAt === null ? 1 : 2,
        coalescedLatestAt,
      }),
    )

    expect(read.payload.waitedHours).toBe(waitedHours)
  })

  it('never reads a stored wait back as the wait a notice was raised with', () => {
    const read = notificationFromRow(row({ payload: { waitedHours: 500 } }))

    expect(read.payload.waitedHours).toBeUndefined()
  })

  it('still refuses a resource type nobody declared', () => {
    expect(() => notificationFromRow(row({ resourceType: 'spaceship' }))).toThrow(
      /Invalid notification\.resourceType: spaceship/u,
    )
  })
})
