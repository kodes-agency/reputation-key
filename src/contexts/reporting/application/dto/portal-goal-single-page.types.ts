// A goal for one Portal, one Portal Group, or the average private rating — what
// its page read returns (types only; ADR 0068, PLAN PG-21).
//
// No zod and no values: a component imports these with `import type`, so
// nothing here reaches a bundle (PLAN E10). The server decides every state,
// day and number; the page only words them (PLAN E12). Days are
// Property-local `YYYY-MM-DD`, months `YYYY-MM`.

import type { GoalMetric } from '../../domain/goal-program'
import type { GoalListProgress } from '../use-cases/goal-list-progress'
import type { GoalProgressReading } from '../use-cases/goal-progress'
import type {
  PortalGoalChange,
  PortalGoalPageMonth,
  PortalGoalPageView,
} from './monthly-portal-goal-page.types'
import type { PortalGoalChangeFacts } from './monthly-portal-goal.types'

/** Whom the goal counts, and its name; null when Portal could not say it. */
export type PortalGoalSingleSubject = Readonly<{
  kind: 'property' | 'portal' | 'portal_group'
  /** `portal:<id>`, `portal_group:<id>` or `property:<id>`: the subject's reads are keyed by it. */
  key: string
  name: string | null
}>

/** What the month so far says of an average: the governed figure, or that it needs more ratings. */
export type PortalGoalAverageReading = Exclude<
  GoalProgressReading,
  Readonly<{ kind: 'not_started' }>
>

/** A goal's status, the day it began or will begin, and the day it was stopped. */
type GoalOfPage = Readonly<{
  programId: string
  status: 'scheduled' | 'active' | 'paused' | 'ended'
  /** Its current version's number: "goal 4.5". */
  target: number
  /** Scheduled: the local day its first month begins; else null. */
  startsOn: string | null
  /** Stopped: the local day it was stopped, when that was recorded; else null. */
  endedOn: string | null
  /** What a change or a stop is made against; null once it has been stopped. */
  change: PortalGoalChangeFacts | null
}>

/** The average private rating goal on its page: its level, and this month while it counts. */
export type PortalGoalAverageOfPage = GoalOfPage &
  Readonly<{
    /** The version a change from a coming month is made against. */
    version: number
    /** Active: the month it counts, its own level, and its days; else null. */
    month: Readonly<{
      key: string
      target: number
      /** The local days still to begin after today ("9 days left" counts today too). */
      daysAfterToday: number
      reading: PortalGoalAverageReading
    }> | null
  }>

/**
 * A goal that names several subjects now, made before goals had pages of their
 * own: what it counts, and this month so far as the Goals list reads it.
 */
export type PortalGoalSeveralOfPage = GoalOfPage &
  Readonly<{
    metric: GoalMetric
    /** Active: this month so far, as its row on the Goals page says it; else null. */
    live: GoalListProgress | null
  }>

/**
 * `$goalId`'s read. A Property count goal is the Monthly portal goal, whose page
 * is `/goals/portals`. A count goal for one Portal or one Portal Group has the
 * Monthly portal goal's page made from its own subject (its card arm is always
 * the goal, and it has no Portals' rows, quiet Portals or other goals). The
 * average has a page of its own, with its months and changes. A goal for
 * several subjects has a plain page: whom it counts, this month, and Stop.
 */
export type PortalGoalSinglePageView =
  | Readonly<{ kind: 'monthly' }>
  | Readonly<{
      kind: 'subject'
      subject: PortalGoalSingleSubject
      page: PortalGoalPageView
      /**
       * The subject already holds a goal for the other measure from the month a
       * change of measure would start: "Count scans instead" is not offered.
       */
      otherMeasureHeld: boolean
    }>
  | Readonly<{
      kind: 'average'
      subject: PortalGoalSingleSubject
      /** Today, the Property's local day. */
      today: string
      goal: PortalGoalAverageOfPage
      /** Its months, newest first, with their figures and results. */
      months: readonly PortalGoalPageMonth[]
      /** What changed, newest first. */
      changes: readonly PortalGoalChange[]
    }>
  | Readonly<{
      kind: 'several'
      /** Each subject it counts now, by name. */
      subjects: readonly PortalGoalSingleSubject[]
      today: string
      goal: PortalGoalSeveralOfPage
    }>
