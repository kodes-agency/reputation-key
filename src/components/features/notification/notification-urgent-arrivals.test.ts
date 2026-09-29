import { describe, expect, it } from 'vitest'
import { makeNotification } from './notification.stories.fixtures'
import { newUrgentArrivals, urgentArrivalMessage } from './notification-urgent-arrivals'

const SHOWN_AT = new Date('2026-09-30T08:00:00Z')
const LATER = new Date('2026-09-30T08:01:00Z')
const EARLIER = new Date('2026-09-30T07:00:00Z')

const urgent = (id: string, createdAt: Date, propertyName = 'Riverside Hotel') =>
  makeNotification({
    id,
    type: 'inbox.escalated',
    priority: 'urgent',
    createdAt,
    payload: { propertyName },
  })

describe('newUrgentArrivals', () => {
  it('names only what is on a clock and was created after the newest row shown', () => {
    const shown = urgent('50000000-0000-4000-8000-000000000001', SHOWN_AT)
    const fresh = urgent('50000000-0000-4000-8000-000000000002', LATER)
    const passed = makeNotification({
      id: '50000000-0000-4000-8000-000000000003',
      type: 'inbox.response_target_passed',
      createdAt: LATER,
    })
    const calm = makeNotification({
      id: '50000000-0000-4000-8000-000000000004',
      type: 'reply.pending_approval',
      createdAt: LATER,
    })

    expect(
      newUrgentArrivals(SHOWN_AT.getTime(), [fresh, passed, calm, shown]).map(
        (n) => n.id,
      ),
    ).toEqual([fresh.id, passed.id])
  })

  it('does not name an older row that joins the head: moved up from the backlog, or marked unread again', () => {
    const fromTheBacklog = urgent('50000000-0000-4000-8000-000000000006', EARLIER)

    expect(newUrgentArrivals(SHOWN_AT.getTime(), [fromTheBacklog])).toEqual([])
  })

  it('names any urgent row when nothing had been shown yet', () => {
    const first = urgent('50000000-0000-4000-8000-000000000007', EARLIER)

    expect(newUrgentArrivals(null, [first]).map((n) => n.id)).toEqual([first.id])
  })

  it('never names finished work, even when it is urgent and new', () => {
    const settled = makeNotification({
      id: '50000000-0000-4000-8000-000000000005',
      type: 'inbox.escalated',
      priority: 'urgent',
      createdAt: LATER,
      resolvedAt: LATER,
    })
    expect(newUrgentArrivals(SHOWN_AT.getTime(), [settled])).toEqual([])
  })
})

describe('urgentArrivalMessage', () => {
  it('names the property of one arrival and counts several', () => {
    expect(
      urgentArrivalMessage([urgent('50000000-0000-4000-8000-000000000011', LATER)]),
    ).toBe('Something urgent needs you at Riverside Hotel')
    expect(
      urgentArrivalMessage([
        urgent('50000000-0000-4000-8000-000000000012', LATER),
        urgent('50000000-0000-4000-8000-000000000013', LATER),
      ]),
    ).toBe('2 urgent notifications need you')
  })
})
