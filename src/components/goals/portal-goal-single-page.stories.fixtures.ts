// The page of a goal for one Portal, one Portal Group or the average (PLAN
// PG-21), on the mock's day, Nov 22: Reception's own goal of 22 private
// ratings a month, set by Elena on Oct 23 for November, 13 so far (and the same
// with Reception holding a scans goal from December); the Rooms group's 35;
// the Property's average private rating, 4.5, at 4.6 from 12 ratings or with 6
// of the 10 a month needs, October met at 4.6, set by Elena on Sep 28; the
// average set and not yet begun, stopped on Nov 12, and Reception's own; and a
// goal an older form made for Reception, Spa and the Rooms group, running and
// stopped. Every shape is the read's own type, from Reporting's application
// layer; nothing here is worked out, only stated.
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
type SeveralView = Extract<PortalGoalSinglePageView, Readonly<{ kind: 'several' }>>

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
  otherMeasureHeld: false,
}

/** The same, with Reception holding a scans goal from December: no switch. */
export const SINGLE_RECEPTION_SCANS_HELD: SubjectView = {
  ...SINGLE_RECEPTION,
  otherMeasureHeld: true,
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
  otherMeasureHeld: false,
}

/** November running at 4.5, a change from a coming month from Dec 1. */
const AVERAGE_CHANGE = {
  ...CHANGE_NOVEMBER,
  now: CHANGE_NOVEMBER.now && { ...CHANGE_NOVEMBER.now, expectedTarget: 4.5 },
}

/** The average's months: November running at 4.6, October met at 4.6. */
const AVERAGE_MONTHS: AverageView['months'] = [
  {
    key: '2026-11',
    measure: 'portal_rating_average',
    value: 4.6,
    target: 4.5,
    outcome: 'running',
    finalOn: '2026-12-02',
    correction: null,
  },
  {
    key: '2026-10',
    measure: 'portal_rating_average',
    value: 4.6,
    target: 4.5,
    outcome: 'met',
    finalOn: '2026-11-02',
    correction: null,
  },
]

/** Sep 28: Elena set 4.5 from October. */
const AVERAGE_SET: PortalGoalChange = {
  kind: 'set_from',
  on: '2026-09-28',
  by: 'elena',
  fromMonth: '2026-10',
  target: 4.5,
  measure: 'portal_rating_average',
  switched: false,
  source: 'own',
  note: null,
}

const AVERAGE_BASE: AverageView = {
  kind: 'average',
  subject: { kind: 'property', key: 'property:p1', name: null },
  today: '2026-11-22',
  goal: {
    programId: 'program-average',
    status: 'active',
    version: 1,
    target: 4.5,
    startsOn: null,
    endedOn: null,
    month: {
      key: '2026-11',
      target: 4.5,
      daysAfterToday: 8,
      reading: { kind: 'live', value: 4.6, sampleCount: 12 },
    },
    change: AVERAGE_CHANGE,
  },
  months: AVERAGE_MONTHS,
  changes: [AVERAGE_SET],
}

/** The Property's average private rating: 4.6 from 12 ratings against 4.5. */
export const AVERAGE_RUNNING: AverageView = AVERAGE_BASE

/** The same, on 6 of the 10 ratings a month needs: November has no figure yet. */
export const AVERAGE_MORE_NEEDED: AverageView = {
  ...AVERAGE_BASE,
  goal: {
    ...AVERAGE_BASE.goal,
    month: AVERAGE_BASE.goal.month && {
      ...AVERAGE_BASE.goal.month,
      reading: { kind: 'too_few', sampleCount: 6, minimumSample: 10 },
    },
  },
  months: AVERAGE_MONTHS.map((month) =>
    month.outcome === 'running' ? { ...month, value: null } : month,
  ),
}

/** Set on Nov 22 for December, at 4.5: not begun, so nothing has counted yet. */
export const AVERAGE_SCHEDULED: AverageView = {
  ...AVERAGE_BASE,
  goal: {
    ...AVERAGE_BASE.goal,
    status: 'scheduled',
    startsOn: '2026-12-01',
    month: null,
    change: { now: null, nextMonthKey: '2026-12', opensOn: 'next' },
  },
  months: [],
  changes: [{ ...AVERAGE_SET, on: '2026-11-22', fromMonth: '2026-12' }],
}

/** Stopped by Elena on Nov 12: November still counts to Nov 30, and nothing changes. */
export const AVERAGE_STOPPED: AverageView = {
  ...AVERAGE_BASE,
  goal: {
    ...AVERAGE_BASE.goal,
    status: 'ended',
    endedOn: '2026-11-12',
    month: null,
    change: null,
  },
  changes: [{ kind: 'stopped', on: '2026-11-12', by: 'elena' }, AVERAGE_SET],
}

/** Reception's own average, made by an older form: whose it is, and where it counts. */
export const AVERAGE_RECEPTION: AverageView = {
  ...AVERAGE_BASE,
  subject: { kind: 'portal', key: 'portal:portal-reception', name: 'Reception' },
}

/** Reception, Spa and the Rooms group at 40 a month, as an older form made it. */
export const SEVERAL_RUNNING: SeveralView = {
  kind: 'several',
  subjects: [
    { kind: 'portal', key: 'portal:portal-reception', name: 'Reception' },
    { kind: 'portal', key: 'portal:portal-spa', name: 'Spa' },
    { kind: 'portal_group', key: 'portal_group:group-rooms', name: 'Rooms' },
  ],
  today: '2026-11-22',
  goal: {
    programId: 'program-several',
    metric: 'portal_rating_count',
    status: 'active',
    target: 40,
    startsOn: null,
    endedOn: null,
    live: {
      programId: 'program-several',
      metric: 'portal_rating_count',
      subjectCount: 3,
      daysLeft: 8,
      month: null,
      belowPace: 1,
    },
    change: CHANGE_NOVEMBER,
  },
}

/** The same, stopped on Nov 12. */
export const SEVERAL_STOPPED: SeveralView = {
  ...SEVERAL_RUNNING,
  goal: {
    ...SEVERAL_RUNNING.goal,
    status: 'ended',
    endedOn: '2026-11-12',
    live: null,
    change: null,
  },
}
