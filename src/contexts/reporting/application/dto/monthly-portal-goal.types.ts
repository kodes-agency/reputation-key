// Monthly portal goal — what the Goals page card read returns (types only).
//
// No zod and no values: a component imports these with `import type`, so
// nothing here reaches a bundle (PLAN E10). The server decides every state,
// day and number; the card only words them (PLAN E12). Days are
// Property-local `YYYY-MM-DD`, months `YYYY-MM`.

import type { PortalGoalMeasure, PortalGoalRatio } from './goal-recommendation.types'

/** One published Portal's steps before the number is ready (P-4). */
export type PortalReadinessRow = Readonly<{
  portalId: string
  name: string
  live: boolean
  /** Its code is made and its QR or NFC marker published. */
  codeMade: boolean
  /** A scan has arrived since that code was made. */
  firstScan: boolean
  /**
   * The local days since its code was made, once 14 or more have passed with
   * no scan; null otherwise (a younger code, or one that has been scanned).
   */
  noScanSinceCodeDays: number | null
}>

/** This month so far at the Property, per measure; null where it cannot be read. */
export type PortalGoalSoFar = Readonly<{ ratings: number | null; scans: number | null }>

/** What the card shows of the first weeks: each Portal's steps and the month so far. */
export type PortalGoalFirstWeeks = Readonly<{
  /** The Property's local day today, for the header tile. */
  today: string
  /** This month. */
  month: string
  soFar: PortalGoalSoFar
  /** Published Portals, in name order. */
  portals: readonly PortalReadinessRow[]
}>

/** One Portal in the number: "Reception · 11 in 14 days". */
export type PortalGoalBasisPortal = Readonly<{
  name: string
  /** Its readings of the measure on its live days in the basis. */
  count: number
  liveDays: number
}>

/** What the number stands on: the Portals with 2 weeks live, over the basis. */
export type PortalGoalOfferBasis = Readonly<{
  /** "from the last 2 weeks": the longest live run among them, in whole weeks. */
  weeks: 2 | 3 | 4
  /** The longest live days among them: "in the 14 days to Oct 22". */
  days: number
  /** The basis's last day: yesterday. */
  lastDay: string
  /** Their readings of the measure on their live days: "brought in 16". */
  count: number
  /** In name order, never by count. */
  portals: readonly PortalGoalBasisPortal[]
}>

/** A live Portal not in the number yet: it joins once it has 2 weeks. */
export type PortalGoalNewPortal = Readonly<{
  name: string
  liveDays: number
  /** The local day it joins the number. */
  joinsOn: string
}>

/**
 * The number the ready card offers, for one month and one measure (P-3, P-4):
 * this month through the 20th, else the next; private ratings, or scans when
 * the Portals had scans but no private ratings (P-2).
 */
export type PortalGoalOffer = Readonly<{
  /** The month offered, `YYYY-MM`. */
  month: string
  /** This month: it counts from its first day, with what already counts. */
  current: boolean
  /** The offered month's days: "a 30-day month". */
  days: number
  measure: PortalGoalMeasure
  /** "your usual", "a bit more" (the recommended number) and "stretch". */
  choices: Readonly<{ usual: number; aBitMore: number; stretch: number }>
  /** The usual for the whole offered month, rounded half up: "about 34 a month". */
  usualAbout: number
  /**
   * The usual "your usual" is rounded from, exact: what an own number is
   * measured against ("about 4 times"). The next month's is the whole month's;
   * this month's is what already counts plus the days left at the usual.
   */
  usualExact: PortalGoalRatio
  basis: PortalGoalOfferBasis
  /** Live Portals not in the number yet, in name order. */
  newPortals: readonly PortalGoalNewPortal[]
  /** This month so far at the Property, when this month is offered; else null. */
  soFar: number | null
  /** This month offered: its days left with today, and what they add at the usual. */
  rest: Readonly<{ daysLeft: number; about: number }> | null
  /** The Property's time zone, whose months the goal follows. */
  timezone: string
}>

/** One measure's numbers for the set sheet; null where it has none to offer. */
export type PortalGoalMeasureOffers = Readonly<{
  /** The rest of this month, on top of what already counts. */
  current: PortalGoalOffer | null
  /** The whole of the next month. */
  next: PortalGoalOffer | null
}>

/**
 * What the set sheet works from (PLAN PG-10): the month it opens on, the two
 * months a goal may start in with this month so far (for a number of the
 * manager's own, which the sheet starts empty), each measure's offers for both
 * months, and, in the first weeks, the day the recommended number is ready.
 */
export type PortalGoalSheetFacts = Readonly<{
  /** The month the card offers: this month through the 20th local day, else the next. */
  month: string
  ownNumber: Readonly<{
    current: Readonly<{ key: string; soFar: PortalGoalSoFar }>
    next: Readonly<{ key: string }>
  }>
  offers: Readonly<Record<PortalGoalMeasure, PortalGoalMeasureOffers>>
  /** While the first weeks last: when the recommended number is ready; else null. */
  readyOn: string | null
}>

/**
 * The month a goal is counting, as its card draws it (copy deck G-21…G-25,
 * G-32): the governed figure against the month's own number, the days, and
 * the pace, all decided by the read.
 */
export type PortalGoalRunningMonth = Readonly<{
  /** `YYYY-MM`. */
  key: string
  /** The month's own number, else its version's. */
  target: number
  /** The governed figure so far; null when it cannot be read, never a zero. */
  value: number | null
  /** The month's local days that have begun, today included. */
  elapsedDays: number
  /** The month's local days. */
  totalDays: number
  /** The local days still to begin after today ("9 days left" counts today too). */
  daysAfterToday: number
  /**
   * `goalPace` says behind (true) or on pace (false); null when the month is
   * not judged: its first days, fewer than 5 expected by today (P-6), or no
   * figure.
   */
  belowPace: boolean | null
  /** The first days of the month, which are never judged: no pace word and no tick. */
  quietDays: boolean
}>

/** One published Portal's count this month, under "From your portals". */
export type PortalGoalPortalCount = Readonly<{
  portalId: string
  name: string
  count: number
}>

/**
 * What the Portals brought in this month (P-1): plain counts in name order,
 * never sorted by count. Each published Portal with what the others leave
 * (draft, disabled, archived and deleted Portals and readings with no Portal,
 * "Other portals"); one Portal that brought in all of it; or, from 5 Portals,
 * how many.
 */
export type PortalGoalRows =
  | Readonly<{
      kind: 'rows'
      portals: readonly PortalGoalPortalCount[]
      elsewhere: number
    }>
  | Readonly<{ kind: 'one'; name: string }>
  | Readonly<{ kind: 'many'; count: number }>

/** The month before this one, while its result is being read and through the 7th. */
export type PortalGoalLastMonth = Readonly<{
  /** `YYYY-MM`. */
  key: string
  /**
   * Once closed, its result's figure; while it is read, the governed figure so
   * far. Null when it cannot be read.
   */
  value: number | null
  /** That month's own number. */
  target: number
  outcome: 'updating' | 'met' | 'not_met' | 'unavailable'
  /** The local day its final figure is due: "Final figure on Dec 2". */
  finalOn: string
}>

/**
 * The Property's Monthly portal goal on its card: while it waits for its first
 * month, the day it starts and this month so far; while it runs (or after it
 * was stopped, to the end of the month it still counts), that month with the
 * governed figure, never the recommendation's, and each Portal's count; and
 * the month before, while it is read and through the 7th.
 */
export type PortalGoalOfCard = Readonly<{
  programId: string
  /** The version a change is made against. */
  version: number
  measure: PortalGoalMeasure
  status: 'scheduled' | 'active' | 'paused' | 'ended'
  /** Its current version's number. */
  target: number
  /** Scheduled: the local day its first month begins; else null. */
  startsOn: string | null
  /**
   * Active, or stopped with this month still counting: the month it is
   * counting; else null.
   */
  month: PortalGoalRunningMonth | null
  /**
   * With a month: what each Portal brought in, drawn only when the counts add
   * up to the governed figure; else null.
   */
  rows: PortalGoalRows | null
  /**
   * Stopped with this month still counting: the local day it was stopped (null
   * when no day was recorded) and the month's last day; else null.
   */
  stopped: Readonly<{ on: string | null; monthEnd: string }> | null
  /** The month before, while its result is read and through the 7th; else null. */
  lastMonth: PortalGoalLastMonth | null
  /** Scheduled: this month so far at the Property; null when it cannot be read. */
  currentMonthSoFar: number | null
  /**
   * Paused, or stopped with no month counting now: the latest month of it
   * still open or being read, as `YYYY-MM` with that month's own target (on
   * Dec 1 a goal stopped in November still counts November); else null.
   */
  countingMonth: Readonly<{ key: string; target: number }> | null
}>

/** An arm the set sheet opens from: what it works from. */
type WithSheet = Readonly<{ sheet: PortalGoalSheetFacts }>

/**
 * The card's arm. Before a goal: no Portal at all (or none live and no draft),
 * draft Portals only, the first weeks, a number ready to use (with scans only,
 * scans first), nothing counted, or a recommendation that cannot be read; each
 * of the last four opens the set sheet. With one: the goal.
 */
export type PortalGoalCardView =
  | Readonly<{ state: 'no_portal' }>
  | Readonly<{
      state: 'drafts_only'
      drafts: readonly Readonly<{ portalId: string; name: string }>[]
    }>
  | (PortalGoalFirstWeeks &
      WithSheet &
      Readonly<{
        state: 'getting_ready'
        /** When the closest live Portal has 2 weeks live; null when that is not known. */
        readyOn: string | null
      }>)
  | (WithSheet & Readonly<{ state: 'ready' | 'scans_only'; offer: PortalGoalOffer }>)
  | (WithSheet &
      Readonly<{
        state: 'nothing_counted'
        /** The weeks the basis covers: "No scans in the last 2 weeks." */
        weeks: 2 | 3 | 4
      }>)
  | (WithSheet & Readonly<{ state: 'recommendation_unreadable' }>)
  | Readonly<{
      state: 'goal'
      /** The Property's local day today, for the header tile. */
      today: string
      goal: PortalGoalOfCard
    }>

export type PortalGoalCardState = PortalGoalCardView['state']

/** What the card's Use (and the set sheet) sends: one number, one measure, from one month. */
export type SetMonthlyPortalGoalRequest = Readonly<{
  propertyId: string
  metric: PortalGoalMeasure
  targetValue: number
  /** `YYYY-MM`: the month the card or the sheet named. */
  startMonth: string
  /** What the screen offered; recorded only as far as the recommendation bears it out. */
  targetSource: 'recommended' | 'own'
}>
