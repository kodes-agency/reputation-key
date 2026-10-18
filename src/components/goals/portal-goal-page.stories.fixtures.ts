// The Monthly portal goal page's story fixtures: Seaview Hotel's goal of 40
// private ratings a month, set by Elena on Oct 23 for November, read on the
// mock's day, Nov 22 (23 of 40, 9 days left, below pace); then in December,
// with November and October closed; and across a stop. Every shape is the
// read's own type, from Reporting's application layer; nothing here is worked
// out, only stated.
import type {
  PortalGoalChange,
  PortalGoalPageMonth,
  PortalGoalPageView,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  CARD_ONE_PORTAL,
  CARD_RUNNING,
  CARD_STOPPED,
} from './portal-goal-running.stories.fixtures'
import {
  CARD_NOTHING,
  CARD_READY,
  CARD_SCHEDULED,
  SEAVIEW,
} from './portal-goal.stories.fixtures'

export { SEAVIEW }

/** The members a page can name. */
const MEMBERS: Readonly<Record<string, string>> = { elena: 'Elena', marco: 'Marco' }
export const personName = (userId: string): string | null => MEMBERS[userId] ?? null

const PORTALS = [
  { portalId: 'portal-reception', name: 'Reception' },
  { portalId: 'portal-restaurant', name: 'Restaurant' },
  { portalId: 'portal-spa', name: 'Spa' },
]

const goalOf = (card: PortalGoalCardView): PortalGoalOfCard => {
  if (card.state !== 'goal') throw new Error('expected a goal card')
  return card.goal
}

const GO_LIVES: readonly PortalGoalChange[] = [
  { kind: 'went_live', on: '2026-10-15', portals: ['Spa'] },
  { kind: 'went_live', on: '2026-10-09', portals: ['Reception', 'Restaurant'] },
]

/** Where the goal counted from October: its Portals went live in early September. */
const SEPTEMBER_GO_LIVES: readonly PortalGoalChange[] = [
  { kind: 'went_live', on: '2026-09-08', portals: ['Spa'] },
  { kind: 'went_live', on: '2026-09-02', portals: ['Reception', 'Restaurant'] },
]

const SET_ON_OCT_23: PortalGoalChange = {
  kind: 'set_from',
  on: '2026-10-23',
  by: 'elena',
  fromMonth: '2026-11',
  target: 40,
  measure: 'portal_rating_count',
  switched: false,
  source: 'recommended',
  note: null,
}

/** November, still counting: 23 of 40 so far. */
const NOVEMBER_RUNNING: PortalGoalPageMonth = {
  key: '2026-11',
  measure: 'portal_rating_count',
  value: 23,
  target: 40,
  outcome: 'running',
  finalOn: '2026-12-02',
  correction: null,
}

const NO_EXTRAS: PortalGoalPageView['extras'] = {
  goals: [],
  progress: [],
  subjectNames: {},
}

/** Nov 22, G10: the mock's day. Spa has 20, Reception 3: still in name order. */
export const PAGE_RUNNING: PortalGoalPageView = {
  card: CARD_RUNNING,
  today: '2026-11-22',
  timezone: SEAVIEW.timezone,
  portals: PORTALS,
  tiles: {
    lastMonth: { key: '2026-10', outcome: 'no_goal' },
    usual: { about: 34, weeks: 4 },
  },
  rows: {
    portals: [
      { portalId: 'portal-reception', name: 'Reception', count: 3 },
      { portalId: 'portal-restaurant', name: 'Restaurant', count: 0 },
      { portalId: 'portal-spa', name: 'Spa', count: 20 },
    ],
    elsewhere: 0,
    total: 23,
    truncated: false,
  },
  facts: {},
  months: [NOVEMBER_RUNNING],
  changes: [SET_ON_OCT_23, ...GO_LIVES],
  extras: NO_EXTRAS,
  anyMonthClosed: false,
}

/** Oct 23, set for November: its first month, and nothing counted yet. */
export const PAGE_SCHEDULED: PortalGoalPageView = {
  ...PAGE_RUNNING,
  card: CARD_SCHEDULED,
  today: '2026-10-23',
  tiles: {
    lastMonth: { key: '2026-10', outcome: 'no_goal' },
    usual: { about: 34, weeks: 2 },
  },
  rows: null,
  months: [],
}

/** Spa, established, has had no scan since Nov 15; it usually gets about 7 a week. */
export const PAGE_WITH_NO_SCAN_FACTS: PortalGoalPageView = {
  ...PAGE_RUNNING,
  facts: { 'portal-spa': { noScansSince: '2026-11-15', usualPerWeek: 7 } },
}

const december = (value: number, patch: Partial<PortalGoalOfCard> = {}) => {
  const card: PortalGoalCardView = {
    state: 'goal',
    today: '2026-12-22',
    goal: {
      ...goalOf(CARD_RUNNING),
      target: 45,
      rows: null,
      ...patch,
      month: {
        key: '2026-12',
        measure: 'portal_rating_count',
        target: 45,
        value,
        elapsedDays: 22,
        totalDays: 31,
        daysAfterToday: 9,
        belowPace: true,
        quietDays: false,
      },
    },
  }
  return card
}

const closedMonth = (
  key: string,
  value: number,
  patch: Partial<PortalGoalPageMonth> = {},
): PortalGoalPageMonth => ({
  key,
  measure: 'portal_rating_count',
  value,
  target: 40,
  outcome: value >= 40 ? 'met' : 'not_met',
  finalOn: key === '2026-11' ? '2026-12-02' : '2026-11-02',
  correction: null,
  ...patch,
})

/** Dec 22: December counting against 45; November met, October not. */
export const PAGE_LATER: PortalGoalPageView = {
  ...PAGE_RUNNING,
  card: december(12),
  today: '2026-12-22',
  tiles: {
    lastMonth: closedMonth('2026-11', 41),
    usual: { about: 38, weeks: 4 },
  },
  rows: {
    portals: [
      { portalId: 'portal-reception', name: 'Reception', count: 7 },
      { portalId: 'portal-restaurant', name: 'Restaurant', count: 3 },
      { portalId: 'portal-spa', name: 'Spa', count: 2 },
    ],
    elsewhere: 0,
    total: 12,
    truncated: false,
  },
  months: [
    {
      ...NOVEMBER_RUNNING,
      key: '2026-12',
      value: 12,
      target: 45,
      finalOn: '2027-01-02',
    },
    closedMonth('2026-11', 41),
    closedMonth('2026-10', 36),
  ],
  changes: [
    {
      kind: 'set_month',
      on: '2026-12-01',
      by: 'elena',
      month: '2026-12',
      target: 45,
      measure: 'portal_rating_count',
      source: 'recommended',
      note: null,
    },
    { ...SET_ON_OCT_23, on: '2026-09-23', fromMonth: '2026-10' },
    ...SEPTEMBER_GO_LIVES,
  ],
  anyMonthClosed: true,
}

/** November was corrected on Dec 5: 41 of 40, now met. */
export const PAGE_CORRECTED: PortalGoalPageView = {
  ...PAGE_LATER,
  months: [
    PAGE_LATER.months[0] ?? NOVEMBER_RUNNING,
    closedMonth('2026-11', 41, {
      correction: { on: '2026-12-05', value: 41, outcome: 'met' },
    }),
    closedMonth('2026-10', 36),
  ],
}

const RUNNING_GOAL = goalOf(CARD_RUNNING)

/** Counting scans: the page says so, and how scans count. */
export const PAGE_SCANS: PortalGoalPageView = {
  ...PAGE_RUNNING,
  card: {
    state: 'goal',
    today: '2026-11-22',
    goal: {
      ...RUNNING_GOAL,
      measure: 'qualified_scans',
      rows: null,
      month: RUNNING_GOAL.month && { ...RUNNING_GOAL.month, measure: 'qualified_scans' },
    },
  },
  rows: null,
  months: [{ ...NOVEMBER_RUNNING, measure: 'qualified_scans' }],
}

/** One published Portal: the page names it. */
export const PAGE_ONE_PORTAL: PortalGoalPageView = {
  ...PAGE_RUNNING,
  card: CARD_ONE_PORTAL,
  portals: [{ portalId: 'portal-reception', name: 'Reception' }],
  rows: {
    portals: [{ portalId: 'portal-reception', name: 'Reception', count: 23 }],
    elsewhere: 0,
    total: 23,
    truncated: false,
  },
}

/**
 * Dec 22, after a stop: the first goal was stopped on Nov 12 and counted to Nov
 * 30; the goal set after it counts 45 from December.
 */
export const PAGE_ACROSS_A_STOP: PortalGoalPageView = {
  ...PAGE_LATER,
  months: [
    PAGE_LATER.months[0] ?? NOVEMBER_RUNNING,
    closedMonth('2026-11', 36),
    closedMonth('2026-10', 41),
  ],
  tiles: { lastMonth: closedMonth('2026-11', 36), usual: { about: 38, weeks: 4 } },
  changes: [
    {
      kind: 'set_from',
      on: '2026-11-20',
      by: 'elena',
      fromMonth: '2026-12',
      target: 45,
      measure: 'portal_rating_count',
      switched: false,
      source: 'own',
      note: 'Spa reopens in December',
    },
    { kind: 'stopped', on: '2026-11-12', by: 'marco' },
    { ...SET_ON_OCT_23, on: '2026-09-23', fromMonth: '2026-10' },
    ...SEPTEMBER_GO_LIVES,
  ],
}

/** Stopped on Nov 12: November still counts to its end. */
export const PAGE_STOPPED: PortalGoalPageView = {
  ...PAGE_RUNNING,
  card: CARD_STOPPED,
  changes: [
    { kind: 'stopped', on: '2026-11-12', by: 'marco' },
    SET_ON_OCT_23,
    ...GO_LIVES,
  ],
}

/** No goal yet: the page is the card's own state, the number ready to use. */
export const PAGE_NO_GOAL: PortalGoalPageView = {
  card: CARD_READY,
  today: '2026-10-23',
  timezone: SEAVIEW.timezone,
  portals: PORTALS,
  tiles: null,
  rows: null,
  facts: {},
  months: [],
  changes: [],
  extras: NO_EXTRAS,
  anyMonthClosed: false,
}

/**
 * Dec 3: stopped on Nov 12, and November closed met (41 of 40). It counts no
 * month any more, so the page is the card before a goal, with its months and
 * what changed under it.
 */
export const PAGE_NO_GOAL_AFTER_A_STOP: PortalGoalPageView = {
  ...PAGE_NO_GOAL,
  card: CARD_NOTHING,
  today: '2026-12-03',
  months: [closedMonth('2026-11', 41, { finalOn: '2026-12-01' })],
  changes: [
    { kind: 'stopped', on: '2026-11-12', by: 'marco' },
    SET_ON_OCT_23,
    ...GO_LIVES,
  ],
  anyMonthClosed: true,
}

/** Nov 22 with 14 changes: the first 12, then "Show all". */
export const PAGE_MANY_CHANGES: PortalGoalPageView = {
  ...PAGE_RUNNING,
  changes: Array.from({ length: 14 }, (_, index) => ({
    ...SET_ON_OCT_23,
    on: `2026-10-${String(28 - index).padStart(2, '0')}`,
  })),
}
