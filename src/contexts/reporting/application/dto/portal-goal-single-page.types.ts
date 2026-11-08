// Browser-safe types for a Portal, Portal Group or average goal's page (ADR 0068).
// The server decides states, days and numbers.
// Days are Property-local YYYY-MM-DD; months are YYYY-MM.

import type {
  GoalOfPage,
  PortalGoalSingleSubject,
  PortalGoalSeveralPageView,
} from '../../monthly-goals/contracts'
export type {
  PortalGoalSingleSubject,
  PortalGoalSeveralOfPage,
} from '../../monthly-goals/contracts'

import type { GoalProgressReading } from '../use-cases/goal-progress'
import type {
  PortalGoalChange,
  PortalGoalPageMonth,
  PortalGoalPageView,
} from './monthly-portal-goal-page.types'

/** What the month so far says of an average: the governed figure, or that it needs more ratings. */
export type PortalGoalAverageReading = Exclude<
  GoalProgressReading,
  Readonly<{ kind: 'not_started' }>
>

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
  | PortalGoalSeveralPageView
