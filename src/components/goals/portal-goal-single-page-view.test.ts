import { describe, expect, it } from 'vitest'
import type { PortalGoalAverageOfPage } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import {
  AVERAGE_GOAL_LINE,
  averageTiles,
  singleGoalTitle,
  singleSubjectWords,
} from './portal-goal-single-page-view'

/** The Property's average, 4.5 in November, on Nov 22. */
const running = (reading: NonNullable<PortalGoalAverageOfPage['month']>['reading']) =>
  ({
    programId: 'average-goal',
    status: 'active',
    target: 4.5,
    startsOn: null,
    month: { key: '2026-11', target: 4.5, daysAfterToday: 8, reading },
    change: null,
  }) satisfies PortalGoalAverageOfPage

describe('the page of a goal for one portal, one group or the average', () => {
  it('a portal goal is called by its portal, a group goal by its group', () => {
    expect(
      singleSubjectWords({ kind: 'portal', key: 'portal:reception', name: 'Reception' }),
    ).toBe('Reception')
    expect(
      singleSubjectWords({
        kind: 'portal_group',
        key: 'portal_group:rooms',
        name: 'Rooms',
      }),
    ).toBe('Rooms (group)')
    // A name Portal could not say: what the Goals list says.
    expect(
      singleSubjectWords({ kind: 'portal', key: 'portal:reception', name: null }),
    ).toBe('Portal')
    expect(
      singleSubjectWords({ kind: 'portal_group', key: 'portal_group:rooms', name: null }),
    ).toBe('Group (group)')
    expect(
      singleGoalTitle({ kind: 'portal', key: 'portal:reception', name: 'Reception' }),
    ).toBe('Reception · portal goal')
    expect(
      singleGoalTitle({ kind: 'portal_group', key: 'portal_group:rooms', name: 'Rooms' }),
    ).toBe('Rooms (group) · portal goal')
  })

  it('the average says what it is, and that a month needs 10 ratings', () => {
    expect(
      singleGoalTitle(
        { kind: 'property', key: 'property:seaview', name: null },
        'average',
      ),
    ).toBe('Average private rating')
    expect(AVERAGE_GOAL_LINE).toBe(
      'The average private rating guests give at your portals. A month needs at least 10 ratings.',
    )
  })

  it('the average reads "4.6 so far · goal 4.5", with the days left', () => {
    expect(averageTiles(running({ kind: 'live', value: 4.6, sampleCount: 12 }))).toEqual([
      {
        key: 'this',
        label: 'November',
        value: '4.6 so far · goal 4.5',
        detail: '9 days left',
      },
    ])
  })

  it('an average on too few ratings reads "More ratings needed · 6 of 10"', () => {
    expect(
      averageTiles(running({ kind: 'too_few', sampleCount: 6, minimumSample: 10 })),
    ).toEqual([
      {
        key: 'this',
        label: 'November',
        value: 'More ratings needed · 6 of 10',
        detail: '9 days left',
      },
    ])
  })

  it('an average it cannot read says so, never a zero', () => {
    expect(averageTiles(running({ kind: 'unavailable' }))[0]).toMatchObject({
      value: null,
      detail: 'This month’s figure can’t be read right now.',
    })
  })

  it('a scheduled average names its first month and its level; a stopped one, nothing', () => {
    const scheduled = {
      ...running({ kind: 'unavailable' }),
      status: 'scheduled',
      startsOn: '2026-12-01',
      month: null,
    } as const

    expect(averageTiles(scheduled)).toEqual([
      { key: 'this', label: 'December', value: 'Goal 4.5', detail: 'Starts on Dec 1' },
    ])
    expect(averageTiles({ ...scheduled, status: 'ended', startsOn: null })).toEqual([])
  })
})
