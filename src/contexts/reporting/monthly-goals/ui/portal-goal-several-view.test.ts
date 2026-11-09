import { describe, expect, it } from 'vitest'
import {
  SEVERAL_RUNNING,
  SEVERAL_STOPPED,
} from './portal-goal-single-page.stories.fixtures'
import { severalGoalWords, severalMonthLine } from './portal-goal-several-view'

const reception = { kind: 'portal', key: 'portal:reception', name: 'Reception' } as const
const rooms = { kind: 'portal_group', key: 'portal_group:rooms', name: 'Rooms' } as const

describe('several-subject goal presentation', () => {
  it('a goal for several subjects is named as its row is, and says what it counts where', () => {
    const spa = { kind: 'portal', key: 'portal:spa', name: 'Spa' } as const

    expect(
      severalGoalWords('portal_rating_count', [spa, reception, rooms], 'Seaview Hotel'),
    ).toEqual({
      title: 'Rooms (group) and 2 more · portal goal',
      line: 'Private ratings from Rooms (group) and 2 more at Seaview Hotel.',
    })
    expect(
      severalGoalWords('portal_rating_average', [spa, reception], 'Seaview'),
    ).toEqual({
      title: 'Reception and Spa · portal goal',
      line: 'The average private rating guests give at Reception and Spa. A month needs at least 10 ratings.',
    })
  })

  it('uses property and missing-name fallbacks in the same subject order as the list', () => {
    expect(
      severalGoalWords(
        'qualified_scans',
        [
          { kind: 'portal', key: 'portal:gone', name: null },
          { kind: 'portal_group', key: 'portal_group:gone', name: null },
          { kind: 'property', key: 'property:p1', name: null },
        ],
        'Seaview',
      ).title,
    ).toBe('Seaview and 2 more · portal goal')
    expect(
      severalGoalWords(
        'qualified_scans',
        [
          { kind: 'portal', key: 'portal:gone', name: null },
          { kind: 'portal_group', key: 'portal_group:gone', name: null },
        ],
        'Seaview',
      ).title,
    ).toBe('Group (group) and Portal · portal goal')
  })

  it('keeps the live subject and below-pace counts', () => {
    expect(severalMonthLine(SEVERAL_RUNNING.goal)).toBe('3 subjects · 1 below pace')
  })

  it('names the scheduled start, with no live month', () => {
    expect(
      severalMonthLine({
        ...SEVERAL_RUNNING.goal,
        status: 'scheduled',
        live: null,
        startsOn: '2026-12-01',
      }),
    ).toBe('Starts on Dec 1.')
  })

  it('shows no month line when stopped or when progress cannot be read', () => {
    expect(severalMonthLine(SEVERAL_STOPPED.goal)).toBeNull()
    expect(severalMonthLine({ ...SEVERAL_RUNNING.goal, live: null })).toBeNull()
  })
})
