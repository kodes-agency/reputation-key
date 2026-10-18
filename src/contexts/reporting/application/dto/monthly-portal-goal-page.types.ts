// Monthly portal goal — what the goal page read returns (types only).
//
// No zod and no values: a component imports these with `import type`, so
// nothing here reaches a bundle (PLAN E10). The server decides every state,
// day and number; the page only words them (PLAN E12). Days are
// Property-local `YYYY-MM-DD`, months `YYYY-MM`.

import type { GoalProgramBundle } from '../ports/goal-program.repository'
import type { GoalListProgress } from '../use-cases/goal-list-progress'
import type { PortalGoalMeasure } from './goal-recommendation.types'
import type { PortalGoalCardView } from './monthly-portal-goal.types'

/** How a month came out, or how far it has got. */
export type PortalGoalMonthOutcome =
  'running' | 'updating' | 'met' | 'not_met' | 'unavailable'

/** A closed month's result after a correction: when, and what it is now. */
export type PortalGoalMonthCorrection = Readonly<{
  /** The local day of the latest correction. */
  on: string
  value: number | null
  outcome: 'met' | 'not_met' | 'unavailable'
}>

/** One month of the goal, or of a goal it took over from, on "Month by month". */
export type PortalGoalPageMonth = Readonly<{
  /** `YYYY-MM`. */
  key: string
  /** What the month counted, under its own version. */
  measure: PortalGoalMeasure
  /**
   * Running, or still being read: the governed figure so far. Closed: its
   * result, after any correction. Null when it cannot be read, never a zero.
   */
  value: number | null
  /** The month's own number ("Number in November: 40"). */
  target: number
  outcome: PortalGoalMonthOutcome
  /**
   * The local day its final figure is due while it runs or is read (null once
   * that day has gone with no figure), or the day it arrived once closed.
   */
  finalOn: string | null
  /** A closed month a correction changed; else null. */
  correction: PortalGoalMonthCorrection | null
}>

/** What the tiles say beside the month the goal is counting (P-4). */
export type PortalGoalPageTiles = Readonly<{
  /** The month before this one: its result, or that it had no goal. */
  lastMonth: PortalGoalPageMonth | Readonly<{ key: string; outcome: 'no_goal' }>
  /**
   * The usual for this whole month, in what the goal counts now, rounded half
   * up ("About 34 a month"), and the weeks it stands on; null with no usual.
   */
  usual: Readonly<{ about: number; weeks: 2 | 3 | 4 }> | null
}>

/** One published Portal's count this month, on the page (name order, P-1). */
export type PortalGoalPagePortal = Readonly<{
  portalId: string
  name: string
  count: number
}>

/**
 * What the Portals brought in this month, drawn only when it adds up to the
 * governed figure: every published Portal in name order (up to 100), what the
 * rest brought in, and the figure itself.
 */
export type PortalGoalPageRows = Readonly<{
  portals: readonly PortalGoalPagePortal[]
  /** Draft, disabled, archived and deleted Portals, and readings with no Portal. */
  elsewhere: number
  /** The governed figure: "All portals 23". */
  total: number
  /** Only the first 100 Portals by name are listed. */
  truncated: boolean
}>

/** An established Portal that has gone quiet (P-7): no scans since a day. */
export type PortalGoalQuietFact = Readonly<{
  /** The local day of its last scan. */
  noScansSince: string
  /** Its usual scans in a week, rounded half up. */
  usualPerWeek: number
}>

/** Who made a change, and the local day. */
type ChangeMade = Readonly<{
  /** The local day. */
  on: string
  /** The member's id; a page names them. */
  by: string
}>

/**
 * One dated fact about the goal, newest first (P-10…P-12): its number set from
 * a month, one month's own number set, the goal stopped, or Portals going live.
 */
export type PortalGoalChange =
  | (ChangeMade &
      Readonly<{
        kind: 'set_from'
        /** The first month the number counts. */
        fromMonth: string
        target: number
        measure: PortalGoalMeasure
        /** The measure changed from the version before. */
        switched: boolean
        source: 'recommended' | 'own' | null
        note: string | null
      }>)
  | (ChangeMade &
      Readonly<{
        kind: 'set_month'
        month: string
        target: number
        measure: PortalGoalMeasure
        source: 'recommended' | 'own' | null
        note: string | null
      }>)
  | (ChangeMade & Readonly<{ kind: 'stopped' }>)
  | Readonly<{
      kind: 'went_live'
      on: string
      /** The Portals whose current live run began that day, in name order. */
      portals: readonly string[]
    }>

/** The other Portal goals, with this month so far of the active ones. */
export type PortalGoalPageExtras = Readonly<{
  goals: readonly GoalProgramBundle[]
  /** Null when it could not be read: the rows say so, the page still draws. */
  progress: readonly GoalListProgress[] | null
  /** Each Portal and Portal Group subject's name, by `portal:<id>` or `portal_group:<id>`. */
  subjectNames: Readonly<Record<string, string>>
}>

/**
 * The Monthly portal goal's page: the card's arm (before a goal, it is what the
 * page shows), with a goal the tiles, what each Portal brought in and the
 * quiet Portals; with a goal or after one, the months of this goal and of the
 * ones it took over from, and what changed; and the other Portal goals.
 */
export type PortalGoalPageView = Readonly<{
  card: PortalGoalCardView
  /** Today, the Property's local day: a date of another year says its year. */
  today: string
  /** The Property's time zone, whose months the goal follows. */
  timezone: string
  /** Published Portals in name order: "from all 3 portals", or the one by name. */
  portals: readonly Readonly<{ portalId: string; name: string }>[]
  /** With a goal; else null. */
  tiles: PortalGoalPageTiles | null
  /** With a running month whose counts add up; else null. */
  rows: PortalGoalPageRows | null
  /** Each established Portal that has gone quiet; others are absent. */
  facts: Readonly<Record<string, PortalGoalQuietFact>>
  /**
   * Newest first, up to 24: the goal's and those of the goals it took over
   * from, or with no goal now, the stopped goals' (none before a first goal).
   */
  months: readonly PortalGoalPageMonth[]
  /** Newest first; none before a first goal. */
  changes: readonly PortalGoalChange[]
  extras: PortalGoalPageExtras
  /** A month of the goal, or of one before it, has closed: it has results to see. */
  anyMonthClosed: boolean
}>
