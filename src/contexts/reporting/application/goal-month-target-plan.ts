// Reporting — what changing this month's target would touch.
//
// While a goal month runs, a manager can change its target, and by default the
// new target also applies to the months after it. What that means for one goal
// depends on which months are running, which version they belong to, whether a
// change is already waiting for its month, and where the next version could
// start. The rule is stated once here: the command calls it to decide what to
// write, and the dialog calls it to say so before the manager saves, so what is
// shown is what is written.

// The month key comes from its own module, not through the Program module: the
// dialog runs this in the browser, and the Program module is part of the
// first-paint bundle.
import { monthKeyOf } from '../domain/goal-start'
import { monthTargetHistory } from './goal-month-target-marker'
import { nextRevisionStart } from './goal-revision-start'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
} from './ports/goal-program.repository'

/** Why the months after the running one cannot take its new target. */
export type GoalFollowingBlockedReason = 'scheduled_change_has_other_measure'

export type GoalMonthTargetPlan = Readonly<{
  /**
   * The running month as `YYYY-MM`, on the calendar it was cut in. The dialog
   * sends it back with the change, so a form left open over the end of a
   * month cannot change the month after the one it showed.
   */
  monthKey: string
  /** The running month itself. */
  period: Readonly<{ start: Date; end: Date }>
  /** The open months `now` falls in, one per subject of the goal. Never empty. */
  runningRows: readonly GoalMonthlyResult[]
  /** The version those months belong to. Not the Program's head while a change waits. */
  inForceVersion: GoalProgramVersion
  /** The target the running months are judged against now. */
  effectiveTarget: number
  /** The target they started with. */
  startTarget: number
  /** How many times their target was changed. */
  changeCount: number
  /**
   * A change already waiting for its month: the Program's head, with no month
   * of its own yet. Null when the head is the version in force.
   */
  pendingHead: GoalProgramVersion | null
  /** The first instant a version for the months after could start. */
  followingStart: Date
  /**
   * The Property-local month that start opens, as `YYYY-MM`: the day the
   * dialog names on its checkbox. The dialog sends it back with the change, so
   * a version is never cut from another month than the form said.
   */
  followingMonthKey: string
  /**
   * True when that start leaves a local month with no result: after the
   * Property moved east, its next month begins before the running one ends.
   */
  skipsMonth: boolean
  /** False when the months after cannot take the new target; the reason says why. */
  canApplyFollowing: boolean
  followingBlockedReason: GoalFollowingBlockedReason | null
}>

/** Whole months since year zero, for a `YYYY-MM` key. */
function monthIndex(monthKey: string): number {
  const [year, month] = monthKey.split('-')
  return Number(year) * 12 + Number(month)
}

/**
 * The months of a goal that are running at `now`: open, begun, and not yet at
 * their end. They all belong to one version, the one in force.
 */
function runningMonths(
  bundle: Pick<GoalProgramBundle, 'results' | 'versions'>,
  now: Date,
): Readonly<{ rows: readonly GoalMonthlyResult[]; version: GoalProgramVersion }> | null {
  const running = bundle.results.filter(
    (result) =>
      result.status === 'open' && result.periodStart <= now && now < result.periodEnd,
  )
  const versionId = running[0]?.programVersionId
  const version = bundle.versions.find((candidate) => candidate.id === versionId)
  if (!version) return null
  return {
    rows: running.filter((result) => result.programVersionId === version.id),
    version,
  }
}

/**
 * What changing the running month's target would work on, as of `now`.
 * `propertyTimezone` is the Property's current zone, the one a new version is
 * cut in. Null when no month is running: a goal that has not started, a month
 * that has ended, or a month the hourly job has not opened yet.
 *
 * The command opens an active goal's due months before it calls this. A screen
 * that calls it with a bundle read earlier can be a month behind for the first
 * hour of a month; the command then answers for itself.
 */
export function monthTargetPlan(
  bundle: GoalProgramBundle,
  now: Date,
  propertyTimezone: string,
): GoalMonthTargetPlan | null {
  const running = runningMonths(bundle, now)
  const month = running?.rows[0]
  if (!running || !month) return null

  // Every running month of a goal carries the same target: they open together
  // and the command changes them together.
  const history = monthTargetHistory(bundle, month, running.version)
  const { head, period } = nextRevisionStart(bundle, now, propertyTimezone)
  const pendingHead = head === 'pending' ? bundle.version : null
  const blocked = pendingHead !== null && pendingHead.metric !== running.version.metric
  const monthKey = monthKeyOf(month.periodStart, month.propertyTimezone)
  const followingMonthKey = monthKeyOf(period.start, propertyTimezone)
  return {
    monthKey,
    period: { start: month.periodStart, end: month.periodEnd },
    runningRows: running.rows,
    inForceVersion: running.version,
    effectiveTarget: history.effectiveTarget,
    startTarget: history.startTarget,
    changeCount: history.changeCount,
    pendingHead,
    followingStart: period.start,
    followingMonthKey,
    // The month right after the running one is the next on the calendar. A
    // start further on than that leaves a local month no version covers.
    skipsMonth: monthIndex(followingMonthKey) > monthIndex(monthKey) + 1,
    canApplyFollowing: !blocked,
    followingBlockedReason: blocked ? 'scheduled_change_has_other_measure' : null,
  }
}
