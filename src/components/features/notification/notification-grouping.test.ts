// How the bell and the page order and group rows: Needs you most pressing
// first, the rest by calendar day on the reader's clock, and same-kind
// arrivals at one Property folded into one row — never hiding a guest concern
// among pleasant arrivals, or waiting work among finished work.

import { describe, expect, it } from 'vitest'
import { makeNotification } from './notification.stories.fixtures'
import { byUrgency, groupByDay } from './notification-filters'
import { stackNotifications } from './notification-stacks'

const NOW = new Date('2026-09-30T09:00:00.000Z') // 12:00 in Sofia
const at = (iso: string) => new Date(iso)
const RIVERSIDE = '33333333-3333-4333-8333-333333333333'
const HARBOUR = '66666666-6666-4666-8666-666666666666'

describe('groupByDay', () => {
  it("groups by the calendar day on the reader's clock, not by 24-hour spans", () => {
    const lateYesterday = makeNotification({
      id: '30000000-0000-4000-8000-000000000001',
      createdAt: at('2026-09-29T20:50:00.000Z'), // 23:50 yesterday in Sofia
    })
    const earlyToday = makeNotification({
      id: '30000000-0000-4000-8000-000000000002',
      createdAt: at('2026-09-29T21:10:00.000Z'), // 00:10 today in Sofia
    })
    const lastWeek = makeNotification({
      id: '30000000-0000-4000-8000-000000000003',
      createdAt: at('2026-09-20T09:00:00.000Z'),
    })
    const threeDaysAgo = makeNotification({
      id: '30000000-0000-4000-8000-000000000004',
      createdAt: at('2026-09-27T09:00:00.000Z'),
    })

    const groups = groupByDay(
      [earlyToday, lateYesterday, threeDaysAgo, lastWeek],
      'Europe/Sofia',
      NOW,
    )

    expect(
      groups.map((group) => [group.label, group.notifications.map((n) => n.id)]),
    ).toEqual([
      ['Today', [earlyToday.id]],
      ['Yesterday', [lateYesterday.id]],
      ['Earlier this week', [threeDaysAgo.id]],
      ['Older', [lastWeek.id]],
    ])
  })

  it('leaves out the days nothing happened on', () => {
    const today = makeNotification({
      id: '30000000-0000-4000-8000-000000000005',
      createdAt: NOW,
    })
    expect(groupByDay([today], 'UTC', NOW).map((group) => group.key)).toEqual(['today'])
  })
})

describe('byUrgency', () => {
  it('puts what is on a clock first, then the rest, each newest first', () => {
    const newest = makeNotification({
      id: '30000000-0000-4000-8000-000000000011',
      type: 'reply.pending_approval',
      createdAt: at('2026-09-30T08:59:00.000Z'),
    })
    const passed = makeNotification({
      id: '30000000-0000-4000-8000-000000000012',
      type: 'inbox.response_target_passed',
      createdAt: at('2026-09-30T06:00:00.000Z'),
    })
    const urgent = makeNotification({
      id: '30000000-0000-4000-8000-000000000013',
      type: 'inbox.escalated',
      priority: 'urgent',
      createdAt: at('2026-09-30T07:00:00.000Z'),
    })

    expect(byUrgency([newest, passed, urgent]).map((n) => n.id)).toEqual([
      urgent.id,
      passed.id,
      newest.id,
    ])
  })
})

describe('stackNotifications', () => {
  const review = (id: string, propertyId = HARBOUR) =>
    makeNotification({
      id,
      type: 'review.created',
      propertyId,
      payload: { propertyName: 'Harbour View Suites', platform: 'google' },
    })

  it("folds new reviews at one Property into one entry, at the newest one's place", () => {
    const first = review('30000000-0000-4000-8000-000000000021')
    const note = makeNotification({
      id: '30000000-0000-4000-8000-000000000022',
      type: 'reply.published',
    })
    const second = review('30000000-0000-4000-8000-000000000023')

    const entries = stackNotifications([first, note, second])

    expect(entries.map((entry) => entry.kind)).toEqual(['stack', 'row'])
    expect(entries[0]).toMatchObject({ notifications: [first, second] })
  })

  it('keeps a kind seen once, and reviews at different Properties, as plain rows', () => {
    const entries = stackNotifications([
      review('30000000-0000-4000-8000-000000000031'),
      review('30000000-0000-4000-8000-000000000032', RIVERSIDE),
    ])

    expect(entries.map((entry) => entry.kind)).toEqual(['row', 'row'])
  })

  it('never folds a notice into others of a different category', () => {
    // Private feedback is filed by its rating (D4): a 2-star guest concern and
    // a 5-star arrival are the same type in different categories, and the
    // concern must stay a row of its own.
    const feedback = (
      id: string,
      category: 'urgent_operational' | 'workflow_collaboration',
    ) => ({
      ...makeNotification({
        id,
        type: 'feedback.created',
        propertyId: HARBOUR,
        payload: { platform: 'portal' },
      }),
      category,
    })

    const entries = stackNotifications([
      feedback('30000000-0000-4000-8000-000000000041', 'workflow_collaboration'),
      feedback('30000000-0000-4000-8000-000000000042', 'urgent_operational'),
      feedback('30000000-0000-4000-8000-000000000043', 'workflow_collaboration'),
    ])

    expect(entries.map((entry) => entry.kind)).toEqual(['stack', 'row'])
    expect(entries[1]).toMatchObject({
      notification: { id: '30000000-0000-4000-8000-000000000042' },
    })
  })

  it('never folds finished work into work still waiting', () => {
    const waiting = review('30000000-0000-4000-8000-000000000051')
    const done = makeNotification({
      id: '30000000-0000-4000-8000-000000000052',
      type: 'review.created',
      propertyId: HARBOUR,
      resolvedAt: NOW,
    })

    expect(stackNotifications([waiting, done]).map((entry) => entry.kind)).toEqual([
      'row',
      'row',
    ])
  })
})
