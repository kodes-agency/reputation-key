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
  /**
   * What the month counts: its own version's measure, which a change from a
   * coming month ("Count scans instead") does not touch.
   */
  measure: PortalGoalMeasure
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
  /** What that month counted, under its own version. */
  measure: PortalGoalMeasure
  /**
   * Once closed, its result's figure; while it is read, the governed figure so
   * far. Null when it cannot be read.
   */
  value: number | null
  /** That month's own number. */
  target: number
  outcome: 'updating' | 'met' | 'not_met' | 'unavailable'
  /**
   * The local day its final figure is due: "Final figure on Dec 2". Null while
   * it is still read after that day, so no day already gone is promised.
   */
  finalOn: string | null
}>

/**
 * What a change to the goal is made against (PLAN PG-14), from the plan the
 * month-target command follows: the running month while its number can still
 * change (to its last day), and the month a change from a coming month starts
 * with. The sheet sends these back with the change, so a sheet left open over
 * a change made elsewhere, or over the end of a month, is refused rather than
 * changing what it never showed.
 */
export type PortalGoalChangeFacts = Readonly<{
  /** The running month; null with none running (not started, or it has ended). */
  now: Readonly<{
    /** `YYYY-MM`. */
    monthKey: string
    /** The number the month is judged against now. */
    expectedTarget: number
    /** The version the change is made against. */
    expectedVersion: number
    /** The month the months after take the new number from, `YYYY-MM`. */
    expectedFollowingMonth: string
    /**
     * False while a change of the other measure waits for the next month
     * ("Count scans instead"): the months after keep it, so a change now is
     * this month's alone.
     */
    appliesToFollowing: boolean
    /** The month's first instant and the next one's (ISO), for "starts below pace". */
    period: Readonly<{ start: string; end: string }>
    /** The zone the month's days are drawn in. */
    timezone: string
  }> | null
  /** The first month a change from a coming month counts for: "From Dec 1". */
  nextMonthKey: string
  /** The month the sheet opens on: this one through the 20th local day, else the next. */
  opensOn: 'now' | 'next'
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
  countingMonth: Readonly<{
    key: string
    /** What that month counts, under its own version. */
    measure: PortalGoalMeasure
    target: number
  }> | null
  /** What a change is made against; null once the goal has been stopped. */
  change: PortalGoalChangeFacts | null
  /**
   * Stopped: the month a new goal can start in, the one after the last month
   * this one counts, when the set sheet offers it; else null.
   */
  newGoalFrom: string | null
  /** On local days 1 to 7, the month-start check-in, until it is answered; else null. */
  checkIn: PortalGoalCheckIn | null
}>

/**
 * The month-start check-in (PLAN PG-15; copy deck K-1…K-11): on local days 1
 * to 7 of a month that is not the goal's first, while the goal runs and until
 * a manager answers it, whether the month keeps its number. Nothing changes
 * unless a manager chooses. The read decides it all; the card words it.
 */
export type PortalGoalCheckIn = Readonly<{
  /** `YYYY-MM`: the running month it asks about. */
  month: string
  /** What that month counts. */
  measure: PortalGoalMeasure
  /** The number the month is judged against now: "Keep 40". */
  target: number
}> &
  (
    | Readonly<{
        /** "Use 45" (the offer's recommended number), "Keep 40", or another number. */
        kind: 'offer'
        /**
         * The number recommended for the month now, the sheet's: the rest of
         * the month on top of what already counts (`current` true); on its
         * first day with nothing in yet, the same numbers worked out for the
         * whole month (`current` false: "a 31-day month gets about 38").
         */
        offer: PortalGoalOffer
      }>
    /** The recommended number is the month's already: one line, and "Change". */
    | Readonly<{ kind: 'same' }>
    | Readonly<{
        /** Nothing of the measure came in over the basis: "Keep 40", or another number. */
        kind: 'nothing'
        /** The weeks the basis covers: "in the last 4 weeks". */
        weeks: 2 | 3 | 4
      }>
  )

/**
 * The Overview's prompt for the number ready to use (PLAN PG-16; copy deck
 * O-1): "Your monthly portal goal for November is ready: 40 private ratings."
 * The month and the number are the offer's (its recommended number); the
 * measure is the offer's.
 */
export type PortalGoalPrompt = Readonly<{
  /** `YYYY-MM`: the month offered. */
  month: string
  /** The recommended number for it. */
  number: number
  /** A manager chose "Not now" for this month (or a later one): the Overview shows nothing. */
  deferred: boolean
}>

/** An arm the set sheet opens from: what it works from. */
type WithSheet = Readonly<{ sheet: PortalGoalSheetFacts }>

/**
 * The card's arm. Before a goal: no Portal at all (or none live and no draft),
 * draft Portals only, the first weeks, a number ready to use (with scans only,
 * scans first), nothing counted, or a recommendation that cannot be read; each
 * of the last four opens the set sheet. With one: the goal, with the same
 * facts for the sheet that changes it (its offers) and, once it is stopped,
 * sets the next one.
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
  | (WithSheet &
      Readonly<{
        state: 'ready' | 'scans_only'
        offer: PortalGoalOffer
        /** What the Overview says of it, and whether a manager put that off. */
        prompt: PortalGoalPrompt
      }>)
  | (WithSheet &
      Readonly<{
        state: 'nothing_counted'
        /** The weeks the basis covers: "No scans in the last 2 weeks." */
        weeks: 2 | 3 | 4
      }>)
  | (WithSheet & Readonly<{ state: 'recommendation_unreadable' }>)
  | (WithSheet &
      Readonly<{
        state: 'goal'
        /** The Property's local day today, for the header tile. */
        today: string
        goal: PortalGoalOfCard
      }>)

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

/** The goal a change or a stop is for. */
type OfTheGoal = Readonly<{ propertyId: string; programId: string }>

/**
 * "November, now" (and the month-start check-in's Use): the running month's
 * number, and the months after it, from the change facts' `now`.
 */
export type ChangeMonthlyPortalGoalNowRequest = OfTheGoal &
  Readonly<{
    /** `YYYY-MM`: the running month the sheet showed. */
    month: string
    targetValue: number
    expectedTarget: number
    expectedVersion: number
    expectedFollowingMonth: string
    /** The manager's note, stored with the change. */
    note?: string
    targetSource: 'recommended' | 'own'
  }>

/** "From Dec 1" and "Count scans instead": the goal from its next month. */
export type ReviseMonthlyPortalGoalRequest = OfTheGoal &
  Readonly<{
    metric: PortalGoalMeasure
    targetValue: number
    expectedVersion: number
    /**
     * `YYYY-MM`: the month the sheet said the change starts with (the change
     * facts' `nextMonthKey`); refused once the month has turned since.
     */
    startMonth: string
    /** The manager's note, stored on the new version. */
    note?: string
    targetSource: 'recommended' | 'own'
  }>

/** Stop: the goal ends, and keeps the month it is counting. */
export type StopMonthlyPortalGoalRequest = OfTheGoal

/** The check-in's Keep: the month keeps its number, and the check-in is answered. */
export type KeepMonthlyPortalGoalRequest = OfTheGoal &
  Readonly<{
    /** `YYYY-MM`: the month the check-in asked about. */
    month: string
  }>

/** The Overview prompt's "Not now", for the month it named. */
export type DeferMonthlyPortalGoalPromptRequest = Readonly<{
  propertyId: string
  /** `YYYY-MM`: the month the prompt named. */
  month: string
}>

/** A Portal's Results line: which Portal, at which Property. */
export type MonthlyPortalGoalLineRequest = Readonly<{
  propertyId: string
  portalId: string
}>

/**
 * The line at the top of a Portal's Results tab (PLAN PG-16; copy deck R-1,
 * R-2): this month, what the Portal brought in toward the Monthly portal goal,
 * and the Portal's own goal when it has one. Null (no line) for a draft Portal,
 * and when neither goal is counting this month.
 */
export type PortalGoalLineView = Readonly<{
  /** `YYYY-MM`: this month, on the Property's calendar. */
  month: string
  /**
   * The Portal's count of the month the Monthly portal goal is counting, in
   * that month's measure: only when every Portal's count adds up to the
   * goal's governed figure (as the card's rows are); else null.
   */
  monthlyGoal: Readonly<{ measure: PortalGoalMeasure; count: number }> | null
  /**
   * The goal for this Portal alone, when one is counting this month and its
   * governed figure can be read: its month so far against the month's number;
   * else null.
   */
  ownGoal: Readonly<{
    programId: string
    measure: PortalGoalMeasure
    value: number
    target: number
  }> | null
}>
