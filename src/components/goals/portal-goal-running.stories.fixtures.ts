// The running Monthly portal goal's story fixtures: Seaview Hotel's goal of 40
// private ratings a month, set on Oct 23 for November (PLAN goldens G10, G11
// and G18). Nov 22 is the mock's day: 23 of 40, 9 days left, below pace, and a
// steady month would be at 29 on the ruler. Every
// shape is the read's own type, from Reporting's application layer; nothing
// here is worked out, only stated.
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
  PortalGoalRows,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  CHANGE_DECEMBER,
  CHANGE_NOVEMBER,
  CHANGE_NOVEMBER_BEFORE_SCANS,
  CHANGE_WHILE_DECEMBER_OPENS,
  SHEET_DECEMBER,
  SHEET_NOVEMBER_22,
} from './portal-goal-change.stories.fixtures'
import { GOAL_SCHEDULED } from './portal-goal.stories.fixtures'

/** G10, Nov 22: 23 of 40 with 22 of 30 days gone and 9 left, today counted. */
const NOVEMBER_22: PortalGoalRunningMonth = {
  key: '2026-11',
  measure: 'portal_rating_count',
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
  change: CHANGE_NOVEMBER,
}

const goalCard = (
  today: string,
  goal: Partial<PortalGoalOfCard>,
  month: Partial<PortalGoalRunningMonth> = {},
): PortalGoalCardView => {
  // From Dec 1 December runs: what a change is made against moves with it.
  const december = today >= '2026-12-01'
  return {
    state: 'goal',
    today,
    goal: {
      ...RUNNING,
      ...(december ? { change: CHANGE_DECEMBER } : {}),
      ...goal,
      month: { ...NOVEMBER_22, ...month },
    },
    sheet: december ? SHEET_DECEMBER : SHEET_NOVEMBER_22,
  }
}

export const CARD_RUNNING = goalCard('2026-11-22', {})

/**
 * Changed on Nov 20 to 55 scans from December: the goal's head counts scans,
 * and November keeps counting private ratings.
 */
export const CARD_CHANGED_TO_SCANS = goalCard('2026-11-22', {
  version: 2,
  measure: 'qualified_scans',
  target: 55,
  change: CHANGE_NOVEMBER_BEFORE_SCANS,
})

/** Nov 2: the first days are never judged, and the ruler has no steady stop yet. */
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

/** Nov 22: 30 of 40, on the way: "On pace", with Spa on 23. */
export const CARD_ON_PACE = goalCard(
  '2026-11-22',
  {
    rows: {
      kind: 'rows',
      portals: [
        { portalId: 'portal-reception', name: 'Reception', count: 5 },
        { portalId: 'portal-restaurant', name: 'Restaurant', count: 2 },
        { portalId: 'portal-spa', name: 'Spa', count: 23 },
      ],
      elsewhere: 0,
    },
  },
  { value: 30, belowPace: false },
)

/**
 * P-6, Nov 29: a goal of 4 expects fewer than 5 by today, so the rule judges
 * nothing: no pill, though the ruler still marks where a steady month stands.
 */
export const CARD_NOT_JUDGED = goalCard(
  '2026-11-29',
  { rows: { kind: 'one', name: 'Reception' } },
  {
    target: 4,
    value: 1,
    elapsedDays: 29,
    daysAfterToday: 1,
    belowPace: null,
  },
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

/** The governed read could not be trusted: no figure, no ruler, no rows. */
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

/**
 * Stopped on Nov 12: November still counts to its end, it takes no change, and
 * a new goal can start in December.
 */
export const CARD_STOPPED = goalCard('2026-11-22', {
  status: 'ended',
  stopped: { on: '2026-11-12', monthEnd: '2026-11-30' },
  change: null,
  newGoalFrom: '2026-12',
})

/** Stopped before the day was recorded. */
export const CARD_STOPPED_NO_DATE = goalCard('2026-11-22', {
  status: 'ended',
  stopped: { on: null, monthEnd: '2026-11-30' },
  change: null,
  newGoalFrom: '2026-12',
})

/** Each published Portal's count of December so far, as the read returns it. */
const decemberRows = (reception: number, restaurant: number): PortalGoalRows => ({
  kind: 'rows',
  portals: [
    { portalId: 'portal-reception', name: 'Reception', count: reception },
    { portalId: 'portal-restaurant', name: 'Restaurant', count: restaurant },
    { portalId: 'portal-spa', name: 'Spa', count: 0 },
  ],
  elsewhere: 0,
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
    // Nothing in yet: each Portal on 0.
    rows: decemberRows(0, 0),
    lastMonth: {
      key: '2026-11',
      measure: 'portal_rating_count',
      value: 38,
      target: 40,
      outcome: 'updating',
      finalOn: '2026-12-02',
    },
  },
  DECEMBER_1,
)

/**
 * Dec 1 in its first minutes: December counts, but its month is not opened
 * yet, so there is no month to change now; November is still being read.
 */
export const CARD_WHILE_DECEMBER_OPENS = goalCard(
  '2026-12-01',
  {
    rows: decemberRows(0, 0),
    change: CHANGE_WHILE_DECEMBER_OPENS,
    lastMonth: {
      key: '2026-11',
      measure: 'portal_rating_count',
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
    rows: decemberRows(2, 1),
    lastMonth: {
      key: '2026-11',
      measure: 'portal_rating_count',
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
    rows: decemberRows(2, 1),
    lastMonth: {
      key: '2026-11',
      measure: 'portal_rating_count',
      value: 36,
      target: 40,
      outcome: 'not_met',
      finalOn: '2026-12-02',
    },
  },
  { ...DECEMBER_1, value: 3, elapsedDays: 3, daysAfterToday: 28 },
)
