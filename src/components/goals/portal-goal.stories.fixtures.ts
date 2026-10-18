// The Monthly portal goal's story fixtures: Seaview Hotel on Sofia time, where
// Reception and Restaurant went live on Oct 9 and Spa on Oct 15, read on Oct 17
// (PROPOSAL §4.1); on Oct 23 the number is ready (PLAN goldens G1, G2 and G5),
// and a goal set from it runs in November. Every shape is the read's own type,
// from Reporting's application layer; nothing here is worked out, only stated.
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
  PortalGoalOffer,
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

export const CARD_GETTING_READY: PortalGoalCardView = {
  state: 'getting_ready',
  today: SEAVIEW.today,
  month: '2026-10',
  soFar: { ratings: 8, scans: 47 },
  readyOn: '2026-10-23',
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
  soFar: 12,
  rest: { daysLeft: 9, about: 10 },
}

/** G5: 23 scans and no private ratings in 2 weeks at one Portal: scans first, 55. */
export const OFFER_SCANS: PortalGoalOffer = {
  ...OFFER_NOVEMBER,
  measure: 'qualified_scans',
  choices: { usual: 50, aBitMore: 55, stretch: 60 },
  usualAbout: 49,
  basis: {
    weeks: 2,
    days: 14,
    lastDay: '2026-10-22',
    count: 23,
    portals: [{ name: 'Reception', count: 23, liveDays: 14 }],
  },
  newPortals: [],
}

export const CARD_READY: PortalGoalCardView = { state: 'ready', offer: OFFER_NOVEMBER }

export const CARD_READY_OCTOBER: PortalGoalCardView = {
  state: 'ready',
  offer: OFFER_OCTOBER,
}

export const CARD_SCANS_ONLY: PortalGoalCardView = {
  state: 'scans_only',
  offer: OFFER_SCANS,
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
  currentMonthSoFar: 12,
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
    month: { key: '2026-11', target: 40, value: 23, daysAfterToday: 8 },
    currentMonthSoFar: null,
  },
}

export const CARD_NOTHING: PortalGoalCardView = { state: 'nothing_counted', weeks: 2 }

export const CARD_REC_UNREADABLE: PortalGoalCardView = {
  state: 'recommendation_unreadable',
}
