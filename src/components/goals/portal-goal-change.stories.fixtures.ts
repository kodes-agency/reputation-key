// What the Monthly portal goal's change works from in the stories (PLAN PG-14):
// Seaview's goal of 40 private ratings a month, read on Nov 22 (November runs,
// a change opens on December), on Dec 1 to 3 (December runs, a change opens on
// December itself) and on Dec 22 (December runs at 45). The sheet's offers for
// each month and measure are stated, never worked out.
import type {
  PortalGoalChangeFacts,
  PortalGoalOffer,
  PortalGoalSheetFacts,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { OFFER_NOVEMBER, OFFER_SCANS } from './portal-goal.stories.fixtures'

/**
 * Nov 22, while November runs at 40: a change now is to November (sent back
 * with its number, the version and December), or else from Dec 1; after the
 * 20th the sheet opens on December.
 */
export const CHANGE_NOVEMBER: PortalGoalChangeFacts = {
  now: {
    monthKey: '2026-11',
    expectedTarget: 40,
    expectedVersion: 1,
    expectedFollowingMonth: '2026-12',
    period: { start: '2026-10-31T22:00:00.000Z', end: '2026-11-30T22:00:00.000Z' },
    timezone: 'Europe/Sofia',
  },
  nextMonthKey: '2026-12',
  opensOn: 'next',
}

/**
 * The 4 weeks to Nov 21 at Reception, Restaurant and Spa: 34 private ratings,
 * so a 31-day December gets about 38, and 40 · 45 · 50 with 45 recommended.
 */
const OFFER_DECEMBER: PortalGoalOffer = {
  ...OFFER_NOVEMBER,
  month: '2026-12',
  days: 31,
  choices: { usual: 40, aBitMore: 45, stretch: 50 },
  usualAbout: 38,
  // 34 in 28 live days, for 31 days.
  usualExact: { num: '527', den: '14' },
  basis: {
    weeks: 4,
    days: 28,
    lastDay: '2026-11-21',
    count: 34,
    portals: [
      { name: 'Reception', count: 15, liveDays: 28 },
      { name: 'Restaurant', count: 9, liveDays: 28 },
      { name: 'Spa', count: 10, liveDays: 28 },
    ],
  },
  newPortals: [],
}

/** The rest of November on Nov 22: the 23 so far and about 11 for the 9 days left. */
const OFFER_REST_OF_NOVEMBER: PortalGoalOffer = {
  ...OFFER_DECEMBER,
  month: '2026-11',
  current: true,
  days: 30,
  choices: { usual: 34, aBitMore: 36, stretch: 37 },
  usualAbout: 36,
  usualExact: { num: '475', den: '14' },
  soFar: 23,
  rest: { daysLeft: 9, about: 11 },
}

/** December in scans: 50 · 55 · 60 (G5's numbers, a month on). */
const OFFER_DECEMBER_SCANS: PortalGoalOffer = {
  ...OFFER_SCANS,
  month: '2026-12',
  days: 31,
  basis: { ...OFFER_DECEMBER.basis, count: 46 },
}

/** What the change sheet works from on Nov 22: the rest of November, all of December. */
export const SHEET_NOVEMBER_22: PortalGoalSheetFacts = {
  month: '2026-12',
  ownNumber: {
    current: { key: '2026-11', soFar: { ratings: 23, scans: 61 } },
    next: { key: '2026-12' },
  },
  offers: {
    portal_rating_count: { current: OFFER_REST_OF_NOVEMBER, next: OFFER_DECEMBER },
    qualified_scans: {
      current: { ...OFFER_DECEMBER_SCANS, month: '2026-11', current: true, days: 30 },
      next: OFFER_DECEMBER_SCANS,
    },
  },
  readyOn: null,
}

/** Dec 1 to 3, while December runs at 40: the sheet opens on December itself. */
export const CHANGE_DECEMBER: PortalGoalChangeFacts = {
  now: {
    monthKey: '2026-12',
    expectedTarget: 40,
    expectedVersion: 1,
    expectedFollowingMonth: '2027-01',
    period: { start: '2026-11-30T22:00:00.000Z', end: '2026-12-31T22:00:00.000Z' },
    timezone: 'Europe/Sofia',
  },
  nextMonthKey: '2027-01',
  opensOn: 'now',
}

/** G4, Dec 1: December from today is 40 · 45 · 50 (45 recommended); January the same. */
export const SHEET_DECEMBER: PortalGoalSheetFacts = {
  month: '2026-12',
  ownNumber: {
    current: { key: '2026-12', soFar: { ratings: 0, scans: 0 } },
    next: { key: '2027-01' },
  },
  offers: {
    portal_rating_count: {
      current: {
        ...OFFER_DECEMBER,
        current: true,
        soFar: 0,
        rest: { daysLeft: 31, about: 38 },
      },
      next: { ...OFFER_DECEMBER, month: '2027-01' },
    },
    qualified_scans: {
      current: null,
      next: { ...OFFER_DECEMBER_SCANS, month: '2027-01' },
    },
  },
  readyOn: null,
}

/** Dec 22, December running at 45 after a change: after the 20th a change opens on January. */
export const CHANGE_DECEMBER_22: PortalGoalChangeFacts = {
  ...CHANGE_DECEMBER,
  now: CHANGE_DECEMBER.now && {
    ...CHANGE_DECEMBER.now,
    expectedTarget: 45,
    expectedVersion: 2,
  },
  opensOn: 'next',
}
