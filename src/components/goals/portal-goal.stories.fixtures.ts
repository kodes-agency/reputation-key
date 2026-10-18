// The Monthly portal goal's story fixtures: Seaview Hotel on Sofia time, where
// Reception and Restaurant went live on Oct 9 and Spa on Oct 15, read on Oct 17
// (PROPOSAL §4.1). Every shape is the read's own type, from Reporting's
// application layer; nothing here is worked out, only stated.
import type {
  PortalGoalCardView,
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

/**
 * A number ready, drawn with the first weeks until the card can offer it: the
 * steps and the month so far, with no ready day. Scans only here (P-2), so the
 * section line counts scans.
 */
export const CARD_SCANS_ONLY: PortalGoalCardView = {
  state: 'scans_only',
  today: '2026-10-23',
  month: '2026-10',
  soFar: { ratings: 0, scans: 23 },
  portals: [
    ready('portal-reception', 'Reception'),
    ready('portal-restaurant', 'Restaurant'),
  ],
}

/** The same with private ratings: the number is ready, and not offered yet. */
export const CARD_READY: PortalGoalCardView = {
  ...CARD_SCANS_ONLY,
  state: 'ready',
  soFar: { ratings: 12, scans: 47 },
}

export const CARD_GOAL: PortalGoalCardView = {
  state: 'goal',
  goal: { programId: 'program-monthly' },
}

export const CARD_NOTHING: PortalGoalCardView = { state: 'nothing_counted', weeks: 2 }

export const CARD_REC_UNREADABLE: PortalGoalCardView = {
  state: 'recommendation_unreadable',
}
