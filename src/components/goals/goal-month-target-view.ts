// A goal's target, as its own page and the goals list print it.
//
// A month that is running can carry a target of its own, so "the target" is
// two questions once a month has opened: what this month is judged against,
// and what the months after it will be. The page answers them on separate
// lines and the list in one. Both read the running month through the plan the
// change command uses (`monthTargetPlan`), so a target a revision has set for
// next month is never shown as this month's.
//
// Pure.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import type { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { monthTargetMarker } from '#/contexts/reporting/application/goal-month-target-marker'
import { goalTargetProvenance } from '#/contexts/reporting/application/goal-target-provenance'
import { goalDay, goalPageMetricLabel } from './goal-detail-view'
import { goalMetricLabel } from './goal-metric-label'
import { goalFigure } from './goal-so-far'
import {
  goalTargetMarkerLine,
  goalTargetMarkerNote,
  type GoalMarkerFrame,
} from './goal-target-marker'

/** The goal as its page read it. */
type Goal = Parameters<typeof monthTargetPlan>[0]
/** What the running month is, or null while none runs. */
type Plan = ReturnType<typeof monthTargetPlan>
type RunningPlan = NonNullable<Plan>

/** One line of the Program card about the target. */
export type GoalTargetLine = Readonly<{
  /** "This month", "From Nov 1", or "Target" while no month is running. */
  label: string
  /** The target as a figure. */
  value: string
  /** Quiet facts after it: the marker, its own measure, when it was set. */
  notes: readonly string[]
}>

type Following = Readonly<{
  metric: GoalMetric
  targetValue: number
  /** The first instant the months after are judged against it. */
  from: Date
  /** When a change that still waits for its month was set; null when none waits. */
  setAt: Date | null
}>

/**
 * The target of the months after the running one: the change waiting for its
 * month, else the version in force, which simply goes on. Null for a goal that
 * has ended, which opens no further month.
 */
function followingOf(goal: Goal, plan: RunningPlan): Following | null {
  if (goal.program.status === 'ended') return null
  const { pendingHead } = plan
  if (pendingHead === null) {
    return {
      metric: plan.inForceVersion.metric,
      targetValue: plan.inForceVersion.targetValue,
      from: plan.period.end,
      setAt: null,
    }
  }
  return {
    metric: pendingHead.metric,
    targetValue: pendingHead.targetValue,
    from: pendingHead.effectiveFrom,
    setAt: goalTargetProvenance(goal, pendingHead).setAt,
  }
}

const present = (note: string | null): note is string => note !== null

/**
 * The Program card's lines about the target: "This month" and "From Nov 1"
 * while a month runs, one "Target" otherwise. A changed month carries its
 * marker; a change waiting for its month says when it was set, and its measure
 * when that is another one.
 */
export function goalTargetLines(
  goal: Goal,
  plan: Plan,
  frame: GoalMarkerFrame,
): readonly GoalTargetLine[] {
  if (plan === null) {
    const { metric, targetValue } = goal.version
    return [{ label: 'Target', value: goalFigure(metric, targetValue), notes: [] }]
  }
  const { metric } = plan.inForceVersion
  const [month] = plan.runningRows
  const marker = month ? monthTargetMarker(goal, month, plan.inForceVersion) : null
  const following = followingOf(goal, plan)
  const otherMeasure = following !== null && following.metric !== metric
  const thisMonth: GoalTargetLine = {
    label: 'This month',
    value: goalFigure(metric, plan.effectiveTarget),
    notes: [
      otherMeasure ? goalPageMetricLabel(metric) : null,
      marker ? goalTargetMarkerLine(metric, marker, frame) : null,
    ].filter(present),
  }
  if (following === null) return [thisMonth]
  return [
    thisMonth,
    {
      label: `From ${goalDay(following.from, frame)}`,
      value: goalFigure(following.metric, following.targetValue),
      notes: [
        otherMeasure ? goalPageMetricLabel(following.metric) : null,
        following.setAt ? `set on ${goalDay(following.setAt, frame)}` : null,
      ].filter(present),
    },
  ]
}

/** A goal's target on its row of the goals list. */
export type GoalListTarget = Readonly<{
  /** The measure the target is for: the running month's, else the head version's. */
  metric: GoalMetric
  /** "target 300 this month · changed Oct 20, started at 400". */
  text: string
  /**
   * When that target was set, for the row's "set on". Null for a changed
   * month: its marker already says when, and what it started at.
   */
  setAt: Date | null
}>

/**
 * The target a goal's row shows: this month's while a month runs, with its
 * marker when it changed and what the months after are when they differ.
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
    ? `${following.metric === metric ? '' : `${goalMetricLabel(following.metric)} `}${goalFigure(following.metric, following.targetValue)} from ${goalDay(following.from, frame)}`
    : null
  return {
    metric,
    text: [
      marker || after ? `${target} this month` : target,
      marker ? goalTargetMarkerNote(metric, marker, frame) : null,
      after,
    ]
      .filter(present)
      .join(' · '),
    setAt: marker ? null : goalTargetProvenance(goal, plan.inForceVersion).setAt,
  }
}
