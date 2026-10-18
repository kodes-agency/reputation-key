// The Monthly portal goal's story fixtures: Seaview Hotel on Sofia time, where
// Reception and Restaurant went live on Oct 9 and Spa on Oct 15, read on Oct 17
// (PROPOSAL §4.1); on Oct 23 the number is ready (PLAN goldens G1, G2 and G5),
// and a goal set from it runs in November. Every shape is the read's own type,
// from Reporting's application layer; nothing here is worked out, only stated.
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
  PortalGoalOffer,
  PortalGoalSheetFacts,
  PortalReadinessRow,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'

export const SEAVIEW = {
  propertyId: 'p1',
  name: 'Seaview Hotel',
  timezone: 'Europe/Sofia',
  today: '2026-10-17',
} as const

const ready = (portalId: string, name: string): PortalReadinessRow => ({
  portalId,
  name,
  live: true,
  codeMade: true,
  firstScan: true,
  noScanSinceCodeDays: null,
})

const SPA: PortalReadinessRow = {
  portalId: 'portal-spa',
  name: 'Spa',
  live: true,
  codeMade: true,
  firstScan: false,
  noScanSinceCodeDays: null,
}

export const CARD_NO_PORTAL: PortalGoalCardView = { state: 'no_portal' }

export const CARD_DRAFTS_ONE: PortalGoalCardView = {
  state: 'drafts_only',
  drafts: [{ portalId: 'portal-spa', name: 'Spa' }],
}

export const CARD_DRAFTS_TWO: PortalGoalCardView = {
  state: 'drafts_only',
  drafts: [
    { portalId: 'portal-spa', name: 'Spa' },
    { portalId: 'portal-bar', name: 'Bar' },
  ],
}

/** What the set sheet works from on Oct 17: no number yet, both months open to an own one. */
export const SHEET_FIRST_WEEKS: PortalGoalSheetFacts = {
  month: '2026-10',
  ownNumber: {
    current: { key: '2026-10', soFar: { ratings: 8, scans: 47 } },
    next: { key: '2026-11' },
  },
  offers: {
    portal_rating_count: { current: null, next: null },
    qualified_scans: { current: null, next: null },
  },
  readyOn: '2026-10-23',
}

export const CARD_GETTING_READY: PortalGoalCardView = {
  state: 'getting_ready',
  today: SEAVIEW.today,
  month: '2026-10',
  soFar: { ratings: 8, scans: 47 },
  readyOn: '2026-10-23',
  sheet: SHEET_FIRST_WEEKS,
  portals: [
    ready('portal-reception', 'Reception'),
    ready('portal-restaurant', 'Restaurant'),
    SPA,
  ],
}

/** The beta's own case: Spa's code was made 17 days ago and has had no scan. */
export const CARD_GETTING_READY_SILENT: PortalGoalCardView = {
  ...CARD_GETTING_READY,
  portals: [
    ready('portal-reception', 'Reception'),
    ready('portal-restaurant', 'Restaurant'),
    { ...SPA, noScanSinceCodeDays: 17 },
  ],
}

/** G1, Oct 23: November is offered, 35 · 40 · 45 with 40 recommended; Spa joins Oct 29. */
export const OFFER_NOVEMBER: PortalGoalOffer = {
  month: '2026-11',
  current: false,
  days: 30,
  measure: 'portal_rating_count',
  choices: { usual: 35, aBitMore: 40, stretch: 45 },
  usualAbout: 34,
  // 16 in 14 live days, for 30 days.
  usualExact: { num: '240', den: '7' },
  basis: {
    weeks: 2,
    days: 14,
    lastDay: '2026-10-22',
    count: 16,
    portals: [
      { name: 'Reception', count: 11, liveDays: 14 },
      { name: 'Restaurant', count: 5, liveDays: 14 },
    ],
  },
  newPortals: [{ name: 'Spa', liveDays: 8, joinsOn: '2026-10-29' }],
  soFar: null,
  rest: null,
  timezone: SEAVIEW.timezone,
}

/** G2: the rest of October, 23 · 24 · 25 on top of the 12 that already count. */
export const OFFER_OCTOBER: PortalGoalOffer = {
  ...OFFER_NOVEMBER,
  month: '2026-10',
  current: true,
  days: 31,
  choices: { usual: 23, aBitMore: 24, stretch: 25 },
  usualAbout: 35,
  // What "23 · your usual" stands for: the 12 so far and 72 / 7 for the 9 days left.
  usualExact: { num: '156', den: '7' },
  soFar: 12,
  rest: { daysLeft: 9, about: 10 },
}

/** G5: 23 scans and no private ratings in 2 weeks at one Portal: scans first, 55. */
export const OFFER_SCANS: PortalGoalOffer = {
  ...OFFER_NOVEMBER,
  measure: 'qualified_scans',
  choices: { usual: 50, aBitMore: 55, stretch: 60 },
  usualAbout: 49,
  // 23 in 14 live days, for 30 days.
  usualExact: { num: '345', den: '7' },
  basis: {
    weeks: 2,
    days: 14,
    lastDay: '2026-10-22',
    count: 23,
    portals: [{ name: 'Reception', count: 23, liveDays: 14 }],
  },
  newPortals: [],
}

/**
 * Seaview's scans on Oct 23, for "Count scans instead": 23 in 14 days at
 * Reception and Restaurant, so 50 · 55 · 60 for November and, on top of the 30
 * already in October, 45 · 50 · 55 for its 9 days left.
 */
const SEAVIEW_SCANS_NOVEMBER: PortalGoalOffer = {
  ...OFFER_SCANS,
  basis: {
    ...OFFER_NOVEMBER.basis,
    count: 23,
    portals: [
      { name: 'Reception', count: 15, liveDays: 14 },
      { name: 'Restaurant', count: 8, liveDays: 14 },
    ],
  },
  newPortals: OFFER_NOVEMBER.newPortals,
}

const SEAVIEW_SCANS_OCTOBER: PortalGoalOffer = {
  ...SEAVIEW_SCANS_NOVEMBER,
  month: '2026-10',
  current: true,
  days: 31,
  choices: { usual: 45, aBitMore: 50, stretch: 55 },
  usualAbout: 51,
  // The 30 so far and 207 / 14 for the 9 days left.
  usualExact: { num: '627', den: '14' },
  soFar: 30,
  rest: { daysLeft: 9, about: 15 },
}

/** What the set sheet works from on Oct 23: each measure, October's rest and all of November. */
export const SHEET_READY: PortalGoalSheetFacts = {
  month: '2026-11',
  ownNumber: {
    current: { key: '2026-10', soFar: { ratings: 12, scans: 30 } },
    next: { key: '2026-11' },
  },
  offers: {
    portal_rating_count: { current: OFFER_OCTOBER, next: OFFER_NOVEMBER },
    qualified_scans: { current: SEAVIEW_SCANS_OCTOBER, next: SEAVIEW_SCANS_NOVEMBER },
  },
  readyOn: null,
}

/** Scans first: private ratings have no number, scans 50 · 55 · 60 for November. */
export const SHEET_SCANS_ONLY: PortalGoalSheetFacts = {
  ...SHEET_READY,
  ownNumber: {
    current: { key: '2026-10', soFar: { ratings: 0, scans: 30 } },
    next: { key: '2026-11' },
  },
  offers: {
    portal_rating_count: { current: null, next: null },
    qualified_scans: {
      current: { ...SEAVIEW_SCANS_OCTOBER, basis: OFFER_SCANS.basis, newPortals: [] },
      next: OFFER_SCANS,
    },
  },
}

/** Nothing came in: no number for either measure. */
const SHEET_NOTHING: PortalGoalSheetFacts = {
  ...SHEET_FIRST_WEEKS,
  month: '2026-11',
  ownNumber: {
    current: { key: '2026-10', soFar: { ratings: 0, scans: 0 } },
    next: { key: '2026-11' },
  },
  readyOn: null,
}

export const CARD_READY: PortalGoalCardView = {
  state: 'ready',
  offer: OFFER_NOVEMBER,
  sheet: SHEET_READY,
}

export const CARD_READY_OCTOBER: PortalGoalCardView = {
  state: 'ready',
  offer: OFFER_OCTOBER,
  sheet: { ...SHEET_READY, month: '2026-10' },
}

export const CARD_SCANS_ONLY: PortalGoalCardView = {
  state: 'scans_only',
  offer: OFFER_SCANS,
  sheet: SHEET_SCANS_ONLY,
}

/** Set from the ready card on Oct 23: November, 40 private ratings, 12 so far in October. */
export const GOAL_SCHEDULED: PortalGoalOfCard = {
  programId: 'program-monthly',
  version: 1,
  measure: 'portal_rating_count',
  status: 'scheduled',
  target: 40,
  startsOn: '2026-11-01',
  month: null,
  rows: null,
  stopped: null,
  lastMonth: null,
  currentMonthSoFar: 12,
  countingMonth: null,
}

export const CARD_SCHEDULED: PortalGoalCardView = {
  state: 'goal',
  today: '2026-10-23',
  goal: GOAL_SCHEDULED,
}

/** G10, Nov 22: 23 of 40 with 9 days left, today counted. */
export const CARD_RUNNING: PortalGoalCardView = {
  state: 'goal',
  today: '2026-11-22',
  goal: {
    ...GOAL_SCHEDULED,
    status: 'active',
    startsOn: null,
    month: {
      key: '2026-11',
      target: 40,
      value: 23,
      elapsedDays: 22,
      totalDays: 30,
      daysAfterToday: 8,
      belowPace: true,
      quietDays: false,
    },
    currentMonthSoFar: null,
  },
}

export const CARD_NOTHING: PortalGoalCardView = {
  state: 'nothing_counted',
  weeks: 2,
  sheet: SHEET_NOTHING,
}

export const CARD_REC_UNREADABLE: PortalGoalCardView = {
  state: 'recommendation_unreadable',
  sheet: {
    ...SHEET_NOTHING,
    ownNumber: {
      current: { key: '2026-10', soFar: { ratings: null, scans: 30 } },
      next: { key: '2026-11' },
    },
  },
}
