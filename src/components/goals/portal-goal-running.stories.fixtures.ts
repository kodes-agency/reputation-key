// The running Monthly portal goal's story fixtures: Seaview Hotel's goal of 40
// private ratings a month, set on Oct 23 for November (PLAN goldens G10, G11
// and G18). Nov 22 is the mock's day: 23 of 40, 9 days left, below pace. Every
// shape is the read's own type, from Reporting's application layer; nothing
// here is worked out, only stated.
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
  PortalGoalRows,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { GOAL_SCHEDULED } from './portal-goal.stories.fixtures'

/** G10, Nov 22: 23 of 40 with 22 of 30 days gone and 9 left, today counted. */
const NOVEMBER_22: PortalGoalRunningMonth = {
  key: '2026-11',
  target: 40,
  value: 23,
  elapsedDays: 22,
  totalDays: 30,
  daysAfterToday: 8,
  belowPace: true,
  quietDays: false,
}

/**
 * Spa has the most and Reception the fewest, and the rows are still in name
 * order: never sorted by count (P-1).
 */
const ROWS: PortalGoalRows = {
  kind: 'rows',
  portals: [
    { portalId: 'portal-reception', name: 'Reception', count: 3 },
    { portalId: 'portal-restaurant', name: 'Restaurant', count: 0 },
    { portalId: 'portal-spa', name: 'Spa', count: 20 },
  ],
  elsewhere: 0,
}

const RUNNING: PortalGoalOfCard = {
  ...GOAL_SCHEDULED,
  status: 'active',
  startsOn: null,
  month: NOVEMBER_22,
  rows: ROWS,
  currentMonthSoFar: null,
}

const goalCard = (
  today: string,
  goal: Partial<PortalGoalOfCard>,
  month: Partial<PortalGoalRunningMonth> = {},
): PortalGoalCardView => ({
  state: 'goal',
  today,
  goal: {
    ...RUNNING,
    ...goal,
    month: { ...NOVEMBER_22, ...month },
  },
})

export const CARD_RUNNING = goalCard('2026-11-22', {})

/** Nov 2: the first days are never judged, and the bar has no tick yet. */
export const CARD_FIRST_DAYS = goalCard(
  '2026-11-02',
  {
    rows: {
      kind: 'rows',
      portals: [
        { portalId: 'portal-reception', name: 'Reception', count: 1 },
        { portalId: 'portal-restaurant', name: 'Restaurant', count: 0 },
        { portalId: 'portal-spa', name: 'Spa', count: 0 },
      ],
      elsewhere: 0,
    },
  },
  { value: 1, elapsedDays: 2, daysAfterToday: 28, belowPace: null, quietDays: true },
)

/** Nov 30: the last day, still below pace. */
export const CARD_LAST_DAY = goalCard(
  '2026-11-30',
  {},
  { elapsedDays: 30, daysAfterToday: 0 },
)

/** G18, Nov 27: 41 of 40, passed with 4 days left. */
export const CARD_PASSED = goalCard(
  '2026-11-27',
  {
    rows: {
      kind: 'rows',
      portals: [
        { portalId: 'portal-reception', name: 'Reception', count: 22 },
        { portalId: 'portal-restaurant', name: 'Restaurant', count: 11 },
        { portalId: 'portal-spa', name: 'Spa', count: 8 },
      ],
      elsewhere: 0,
    },
  },
  { value: 41, elapsedDays: 27, daysAfterToday: 3, belowPace: false },
)

/** The governed read could not be trusted: no figure, no bar, no rows. */
export const CARD_UNREADABLE = goalCard(
  '2026-11-22',
  { rows: null },
  { value: null, belowPace: null },
)

export const CARD_ONE_PORTAL = goalCard('2026-11-22', {
  rows: { kind: 'one', name: 'Reception' },
})

export const CARD_FIVE_PORTALS = goalCard('2026-11-22', {
  rows: { kind: 'many', count: 5 },
})

/** A disabled Lobby's 2 readings, in Other portals. */
export const CARD_OTHER_PORTALS = goalCard('2026-11-22', {
  rows: {
    kind: 'rows',
    portals: [
      { portalId: 'portal-reception', name: 'Reception', count: 13 },
      { portalId: 'portal-restaurant', name: 'Restaurant', count: 6 },
      { portalId: 'portal-spa', name: 'Spa', count: 2 },
    ],
    elsewhere: 2,
  },
})

/** Stopped on Nov 12: November still counts to its end. */
export const CARD_STOPPED = goalCard('2026-11-22', {
  status: 'ended',
  stopped: { on: '2026-11-12', monthEnd: '2026-11-30' },
})

/** Stopped before the day was recorded. */
export const CARD_STOPPED_NO_DATE = goalCard('2026-11-22', {
  status: 'ended',
  stopped: { on: null, monthEnd: '2026-11-30' },
})

/** Dec 1: December's first day, and November is still being read. */
const DECEMBER_1: Partial<PortalGoalRunningMonth> = {
  key: '2026-12',
  value: 0,
  elapsedDays: 1,
  totalDays: 31,
  daysAfterToday: 30,
  belowPace: null,
  quietDays: true,
}

export const CARD_LAST_MONTH_UPDATING = goalCard(
  '2026-12-01',
  {
    rows: null,
    lastMonth: {
      key: '2026-11',
      value: 38,
      target: 40,
      outcome: 'updating',
      finalOn: '2026-12-02',
    },
  },
  DECEMBER_1,
)

/** Dec 3: November closed, met. */
export const CARD_LAST_MONTH_MET = goalCard(
  '2026-12-03',
  {
    rows: null,
    lastMonth: {
      key: '2026-11',
      value: 41,
      target: 40,
      outcome: 'met',
      finalOn: '2026-12-02',
    },
  },
  { ...DECEMBER_1, value: 3, elapsedDays: 3, daysAfterToday: 28 },
)

/** Dec 3: November closed, not met: neutral, never red. */
export const CARD_LAST_MONTH_NOT_MET = goalCard(
  '2026-12-03',
  {
    rows: null,
    lastMonth: {
      key: '2026-11',
      value: 36,
      target: 40,
      outcome: 'not_met',
      finalOn: '2026-12-02',
    },
  },
  { ...DECEMBER_1, value: 3, elapsedDays: 3, daysAfterToday: 28 },
)
