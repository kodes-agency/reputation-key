// Browser-safe goal figures, change fences and several-subject page contracts.
// Days are Property-local YYYY-MM-DD; months are YYYY-MM.

import type { GoalMetric } from '../domain/goal-program'

/** What the month so far says about one goal. */
export type GoalProgressReading =
  /** The figure counted from the first of the month to now. */
  | Readonly<{ kind: 'live'; value: number; sampleCount: number }>
  /** An average the ratings so far are too few to support. */
  | Readonly<{ kind: 'too_few'; sampleCount: number; minimumSample: number }>
  /** The metric cannot be read safely right now; never shown as a zero. */
  | Readonly<{ kind: 'unavailable' }>
  /** The goal is scheduled or paused, so there is no month to count yet. */
  | Readonly<{ kind: 'not_started' }>

type CountingReading = Exclude<GoalProgressReading, Readonly<{ kind: 'not_started' }>>

/** What the Goals list prints under an active goal. */
export type GoalListProgress = Readonly<{
  programId: string
  metric: GoalMetric
  /** Subjects counting this month. */
  subjectCount: number
  /** Whole local days still to begin after today. */
  daysLeft: number
  /** The one subject's month so far; null for a goal with several subjects. */
  month: Readonly<{ reading: CountingReading; targetValue: number }> | null
  /**
   * Subjects below pace, for a count goal: how many of several, or 1 or 0 for
   * a goal with one subject. Null when nothing was judged: an average, a month
   * in its first days or expecting too few yet (`goalPace`), subjects too many
   * to read, or figures that cannot be read.
   */
  belowPace: number | null
}>

/** A change must still match the month and version the manager saw. */
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

/** Whom the goal counts, and its name; null when Portal could not say it. */
export type PortalGoalSingleSubject = Readonly<{
  kind: 'property' | 'portal' | 'portal_group'
  /** `portal:<id>`, `portal_group:<id>` or `property:<id>`: the subject's reads are keyed by it. */
  key: string
  name: string | null
}>

/** A goal's status, the day it began or will begin, and the day it was stopped. */
export type GoalOfPage = Readonly<{
  programId: string
  status: 'scheduled' | 'active' | 'paused' | 'ended'
  /** Its current version's number: "goal 4.5". */
  target: number
  /** Scheduled: the local day its first month begins; else null. */
  startsOn: string | null
  /** Stopped: the local day it was stopped, when that was recorded; else null. */
  endedOn: string | null
  /** The latest month Stop retains, including an active goal's due but unopened month. */
  countingMonth: Readonly<{ key: string }> | null
  /** What a change or a stop is made against; null once it has been stopped. */
  change: PortalGoalChangeFacts | null
}>

/** The current subjects and month so far, as the Goals list reads them. */
export type PortalGoalSeveralOfPage = GoalOfPage &
  Readonly<{
    metric: GoalMetric
    /** Active: this month so far, as its row on the Goals page says it; else null. */
    live: GoalListProgress | null
  }>

export type PortalGoalSeveralPageView = Readonly<{
  kind: 'several'
  subjects: readonly PortalGoalSingleSubject[]
  today: string
  goal: PortalGoalSeveralOfPage
}>
