// The page of a goal for one Portal, one Portal Group or the average (PLAN
// PG-21), on the mock's day, Nov 22: Reception's own goal of 22 private
// ratings a month, set by Elena on Oct 23 for November, 13 so far; the Rooms
// group's 35; and the Property's average private rating, 4.5, at 4.6 from 12
// ratings or with 6 of the 10 a month needs. Every shape is the read's own
// type, from Reporting's application layer; nothing here is worked out, only
// stated.
import type {
  PortalGoalChange,
  PortalGoalPageView,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import type { PortalGoalSinglePageView } from '#/contexts/reporting/application/dto/portal-goal-single-page.types'
import { CHANGE_NOVEMBER } from './portal-goal-change.stories.fixtures'
import { PAGE_RUNNING } from './portal-goal-page.stories.fixtures'
import { CARD_RUNNING } from './portal-goal-running.stories.fixtures'

type SubjectView = Extract<PortalGoalSinglePageView, Readonly<{ kind: 'subject' }>>
type AverageView = Extract<PortalGoalSinglePageView, Readonly<{ kind: 'average' }>>

/** A count goal of its own, on Nov 22: `target` a month, `value` so far, on pace. */
function ownGoalCard(
  programId: string,
  target: number,
  value: number,
): PortalGoalCardView {
  if (CARD_RUNNING.state !== 'goal') throw new Error('expected a goal card')
  const { goal } = CARD_RUNNING
  if (goal.month === null) throw new Error('expected a running month')
  return {
    ...CARD_RUNNING,
    goal: {
      ...goal,
      programId,
      target,
      month: { ...goal.month, target, value, belowPace: false },
      rows: null,
      change: {
        ...CHANGE_NOVEMBER,
        now: CHANGE_NOVEMBER.now && { ...CHANGE_NOVEMBER.now, expectedTarget: target },
      },
    },
  }
}

const setOnOct23 = (target: number): PortalGoalChange => ({
  kind: 'set_from',
  on: '2026-10-23',
  by: 'elena',
  fromMonth: '2026-11',
  target,
  measure: 'portal_rating_count',
  switched: false,
  source: 'recommended',
  note: null,
})

/** A Portal's or a group's goal page: no Portals' rows, quiet Portals or other goals. */
function ownPage(
  card: PortalGoalCardView,
  usual: number,
  live: Extract<PortalGoalChange, Readonly<{ kind: 'went_live' }>>,
): PortalGoalPageView {
  const target = card.state === 'goal' ? card.goal.target : 0
  const value = card.state === 'goal' ? (card.goal.month?.value ?? null) : null
  return {
    ...PAGE_RUNNING,
    card,
    portals: [],
    tiles: {
      lastMonth: { key: '2026-10', outcome: 'no_goal' },
      usual: { about: usual, weeks: 4 },
    },
    rows: null,
    facts: {},
    months: [
      {
        key: '2026-11',
        measure: 'portal_rating_count',
        value,
        target,
        outcome: 'running',
        finalOn: '2026-12-02',
        correction: null,
      },
    ],
    changes: [setOnOct23(target), live],
  }
}

/** Reception's own goal: 13 of 22 on Nov 22. */
export const SINGLE_RECEPTION: SubjectView = {
  kind: 'subject',
  subject: { kind: 'portal', key: 'portal:portal-reception', name: 'Reception' },
  page: ownPage(ownGoalCard('program-reception', 22, 13), 20, {
    kind: 'went_live',
    on: '2026-10-09',
    portals: ['Reception'],
  }),
}

/** The Rooms group's goal, Reception and Restaurant: 21 of 35 on Nov 22. */
export const SINGLE_ROOMS: SubjectView = {
  kind: 'subject',
  subject: { kind: 'portal_group', key: 'portal_group:group-rooms', name: 'Rooms' },
  page: ownPage(ownGoalCard('program-rooms', 35, 21), 32, {
    kind: 'went_live',
    on: '2026-10-09',
    portals: ['Reception', 'Restaurant'],
  }),
}

const AVERAGE_BASE: AverageView = {
  kind: 'average',
  subject: { kind: 'property', key: 'property:p1', name: null },
  today: '2026-11-22',
  goal: {
    programId: 'program-average',
    status: 'active',
    target: 4.5,
    startsOn: null,
    month: {
      key: '2026-11',
      target: 4.5,
      daysAfterToday: 8,
      reading: { kind: 'live', value: 4.6, sampleCount: 12 },
    },
    change: CHANGE_NOVEMBER,
  },
}

/** The Property's average private rating: 4.6 from 12 ratings against 4.5. */
export const AVERAGE_RUNNING: AverageView = AVERAGE_BASE

/** The same, on 6 of the 10 ratings a month needs. */
export const AVERAGE_MORE_NEEDED: AverageView = {
  ...AVERAGE_BASE,
  goal: {
    ...AVERAGE_BASE.goal,
    month: AVERAGE_BASE.goal.month && {
      ...AVERAGE_BASE.goal.month,
      reading: { kind: 'too_few', sampleCount: 6, minimumSample: 10 },
    },
  },
}
