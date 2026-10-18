// Monthly portal goal — what the recommendation reads and returns (types only).
//
// The rule is `goal-recommendation.ts`. The read's result is re-exported for
// the UI by `application/dto/goal-recommendation.types.ts`, which a component
// imports with `import type`: no value here, so nothing reaches a bundle.
// Days are Property-local `YYYY-MM-DD`; instants are ISO strings on the way out.

export type PortalGoalMeasure = 'portal_rating_count' | 'qualified_scans'

export type PerMeasure<T> = Readonly<Record<PortalGoalMeasure, T>>

/** An exact number for the wire: decimal integers in lowest terms (JSON has no BigInt). */
export type PortalGoalRatio = Readonly<{ num: string; den: string }>

export type Choices = Readonly<{
  usual: number
  /** The recommended number (P-3). */
  aBitMore: number
  stretch: number
  /**
   * The usual rounded half up: a whole month's ("about 34 a month"), or, from
   * today, what the days left add ("the 9 days left add about 10").
   */
  about: number
}>

export type MeasureRecommendation = Readonly<{
  state: 'ready' | 'nothing' | 'unreadable'
  /** R × the month's days, exact: "about 34" and how far an own number is from it. */
  usualPerMonth: Readonly<{
    current: PortalGoalRatio | null
    next: PortalGoalRatio | null
  }>
  fullMonth: Readonly<{ current: Choices | null; next: Choices | null }>
  /** The rest of the current month, on top of what already counts. */
  fromToday: Choices | null
  /**
   * S + R × the days left with today, exact: the usual `fromToday` rounds to
   * ("23 · your usual"), what an own number for this month is measured against.
   */
  usualFromToday: PortalGoalRatio | null
}>

export type PortalGoalRecommendationState =
  | 'no_live_portal'
  | 'getting_ready'
  | 'ready'
  | 'scans_only'
  | 'nothing_counted'
  | 'unreadable'

export type PortalFacts = Readonly<{
  portalId: string
  name: string
  publicationState: 'published' | 'disabled'
  /** The local day its current live run began; null when it is not live. */
  liveSince: string | null
  liveDays: number
  /** The local day it joins the rate; null when it is in it or not live. */
  joinsOn: string | null
  inBasis: boolean
  codeMadeOn: string | null
  /**
   * A scan has arrived since its code was made. A disabled Portal's scans are
   * not looked for, so it reads false there: say nothing about it.
   */
  firstScan: boolean
  /** The local day of its last scan since that code; null when none, or disabled. */
  lastScanOn: string | null
  /** Its readings on its live days in the basis. */
  window: PerMeasure<number>
  monthToDate: PerMeasure<number>
  noScanSinceCodeDays: number | null
  noScansSince: Readonly<{ since: string; usualPerWeek: number }> | null
}>

export type PortalGoalRecommendation = Readonly<{
  asOf: string
  timezone: string
  window: Readonly<{ firstDay: string; lastDay: string }>
  state: PortalGoalRecommendationState
  defaultMeasure: PortalGoalMeasure
  defaultMonthKey: string
  /** While getting ready: the local day the closest live Portal joins. */
  readyOn: string | null
  basis: Readonly<{
    portals: number
    weeks: 2 | 3 | 4
    counts: PerMeasure<number>
  }> | null
  months: Readonly<{
    current: Readonly<{ key: string; days: number; daysLeftWithToday: number }>
    next: Readonly<{ key: string; days: number }>
  }>
  measures: PerMeasure<MeasureRecommendation>
  /** S: every reading of the Property this month; null when it cannot be read. */
  monthToDate: PerMeasure<number | null>
  /** S less the listed published Portals' month so far. */
  elsewhere: PerMeasure<number>
  /** Every reading of the basis, any Portal or none. */
  windowTotals: PerMeasure<number>
  /** Published and disabled Portals, in Portal's name order. */
  portals: readonly PortalFacts[]
  drafts: readonly Readonly<{ portalId: string; name: string }>[]
  truncated: boolean
}>

/** A Portal as Portal states it (`listGoalReadinessFacts`). */
export type RecommendationPortal = Readonly<{
  portalId: string
  name: string
  publicationState: 'draft' | 'published' | 'disabled'
  liveSince: Date | null
  liveIntervals: readonly Readonly<{ from: Date; to: Date | null }>[]
  codeIssuedAt: Date | null
  codeReady: boolean
}>

/** One local day's readings of one measure for one Portal (or none): a whole number. */
export type RecommendationDayCount = Readonly<{
  portalId: string | null
  measure: PortalGoalMeasure
  localDay: string
  count: number
}>

/**
 * A Portal's (or no Portal's) local day holding a reading of the measure that the
 * governed read would quarantine.
 */
export type RecommendationUnreadableDay = Readonly<{
  portalId: string | null
  measure: PortalGoalMeasure
  localDay: string
}>

export type RecommendPortalGoalInput = Readonly<{
  now: Date
  timezone: string
  /** When both measures' versions are in effect: no live day before its local day. */
  versionFrom: Date
  /** In Portal's name order. */
  portals: readonly RecommendationPortal[]
  truncated: boolean
  days: readonly RecommendationDayCount[]
  /** Where a reading the governed read would quarantine was found. */
  unreadable: readonly RecommendationUnreadableDay[]
  lastScanAt: ReadonlyMap<string, Date>
}>

export type RecommendationWindow = Readonly<{
  today: string
  firstDay: string
  lastDay: string
  /** Local midnight opening the first day. */
  start: Date
  /** Local midnight opening today. */
  end: Date
}>
