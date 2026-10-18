// A goal's target, as the goals list printed it: the Portal goal results page
// says an ended goal's number with it (`portal-goal-results-view.ts`).
//
// A month that is running can carry a target of its own, so "the target" is
// two questions once a month has opened: what this month is judged against,
// and what the months after it will be. The row answers them in one line. Both
// read the running month through the plan the change command uses
// (`monthTargetPlan`), so a target a revision has set for next month is never
// shown as this month's.
//
// Pure.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import type { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { monthTargetMarker } from '#/contexts/reporting/application/goal-month-target-marker'
import { goalTargetProvenance } from '#/contexts/reporting/application/goal-target-provenance'
import { formatShortDate } from '#/lib/format'
import { goalMetricLabel } from './goal-metric-label'
import { goalFigure } from './goal-so-far'
import { goalTargetMarkerNote, type GoalMarkerFrame } from './goal-target-marker'

/** The goal as its page read it. */
type Goal = Parameters<typeof monthTargetPlan>[0]
/** What the running month is, or null while none runs. */
type Plan = ReturnType<typeof monthTargetPlan>
type RunningPlan = NonNullable<Plan>

/** "Oct 11", with its year once it is not the year the reader is in. */
const goalDay = (
  date: Date,
  { timezone, now }: Pick<GoalMarkerFrame, 'timezone' | 'now'>,
): string => formatShortDate(date, timezone, now) ?? 'an unknown date'

type Following = Readonly<{
  metric: GoalMetric
  targetValue: number
  /** The first instant the months after are judged against it. */
  from: Date
  /** When a change that still waits for its month was set; null when none waits. */
  setAt: Date | null
  /**
   * The goal is paused: it opens no month until it is resumed, and then
   * opens the months it missed. The day is said with that condition.
   */
  ifResumed: boolean
}>

/**
 * The target of the months after the running one: the change waiting for its
 * month, else the version in force, which simply goes on. Null for a goal that
 * has ended, which opens no further month.
 */
function followingOf(goal: Goal, plan: RunningPlan): Following | null {
  if (goal.program.status === 'ended') return null
  const ifResumed = goal.program.status === 'paused'
  const { pendingHead } = plan
  if (pendingHead === null) {
    return {
      metric: plan.inForceVersion.metric,
      targetValue: plan.inForceVersion.targetValue,
      from: plan.period.end,
      setAt: null,
      ifResumed,
    }
  }
  return {
    metric: pendingHead.metric,
    targetValue: pendingHead.targetValue,
    from: pendingHead.effectiveFrom,
    setAt: goalTargetProvenance(goal, pendingHead).setAt,
    ifResumed,
  }
}

const present = (note: string | null): note is string => note !== null

/** A goal's target on its row of the goals list. */
type GoalListTarget = Readonly<{
  /** The measure the target is for: the running month's, else the head version's. */
  metric: GoalMetric
  /** "target 300 this month · changed Oct 20, started at 400". */
  text: string
  /**
   * When that target was set, for the "set on" that ends the row. Null when
   * the text says it already: a changed month's marker says when and what it
   * started at, and a row that also names the months after dates this month's
   * target beside it, so the day is not read as theirs.
   */
  setAt: Date | null
}>

/**
 * The target a goal's row shows: this month's while a month runs, with its
 * marker when it changed and what the months after are when they differ
 * ("if resumed" for a paused goal).
 */
export function goalListTarget(
  goal: Goal,
  plan: Plan,
  frame: Pick<GoalMarkerFrame, 'timezone' | 'now'>,
): GoalListTarget {
  if (plan === null) {
    const { metric, targetValue } = goal.version
    return {
      metric,
      text: `target ${goalFigure(metric, targetValue)}`,
      setAt: goalTargetProvenance(goal, goal.version).setAt,
    }
  }
  const { metric } = plan.inForceVersion
  const [month] = plan.runningRows
  const marker = month ? monthTargetMarker(goal, month, plan.inForceVersion) : null
  const following = followingOf(goal, plan)
  const differs =
    following !== null &&
    (following.metric !== metric || following.targetValue !== plan.effectiveTarget)
  const target = `target ${goalFigure(metric, plan.effectiveTarget)}`
  const after = differs
    ? `${following.metric === metric ? '' : `${goalMetricLabel(following.metric)} `}${goalFigure(following.metric, following.targetValue)} from ${goalDay(following.from, frame)}${following.ifResumed ? ' if resumed' : ''}`
    : null
  const { setAt } = goalTargetProvenance(goal, plan.inForceVersion)
  if (marker) {
    return {
      metric,
      text: [`${target} this month`, goalTargetMarkerNote(metric, marker, frame), after]
        .filter(present)
        .join(' · '),
      setAt: null,
    }
  }
  if (after === null) return { metric, text: target, setAt }
  return {
    metric,
    text: `${target} this month, set on ${goalDay(setAt, frame)} · ${after}`,
    setAt: null,
  }
}
