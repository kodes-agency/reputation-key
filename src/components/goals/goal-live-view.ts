// What a Goals row says under an active goal about the month so far.
//
// It is the live month to date and never the month's result, so it counts and
// does not judge: "64 of 120 so far", never "on track". The one thing it may
// say beyond the count is the nudge the Overview chip gives, "below pace", and
// only when the goal is (`goalPace`): never "on pace", never a verdict on the
// month. A count with one subject gets a neutral bar and, when it is below
// pace, that note; an average gets its figure against the target and no pace;
// a goal with several subjects gets how many are below pace. A figure that
// cannot be read says so and is never a zero, and an average too thin to show
// asks for more ratings. Pure.
import type {
  GoalListProgress,
  GoalMetric,
} from '#/contexts/reporting/application/public-api'
import { goalMetricLabel } from './goal-metric-label'
import { goalFigure, goalSoFarNote } from './goal-so-far'

/** The bar under a count, with the words a screen reader hears for it. */
export type GoalLiveBar = Readonly<{
  value: number
  max: number
  label: string
  valueText: string
}>

export type GoalLiveView = Readonly<{
  text: string
  /**
   * The nudge that follows the text in quiet amber, "below pace"; null for a
   * goal that is not below pace, or whose pace was not judged.
   */
  paceNote: string | null
  bar: GoalLiveBar | null
}>

const BELOW_PACE = 'below pace'

type Month = NonNullable<GoalListProgress['month']>

const plural = (count: number, one: string, many: string): string =>
  count === 1 ? one : many

/** "14 days left"; the last day of the month has none left after today. */
function daysLeftText(daysLeft: number): string {
  if (daysLeft <= 0) return 'last day'
  return `${daysLeft} ${plural(daysLeft, 'day', 'days')} left`
}

function countLine(goal: GoalListProgress, month: Month, value: number): GoalLiveView {
  const target = goalFigure(goal.metric, month.targetValue)
  const soFar = `${goalFigure(goal.metric, value)} of ${target} so far`
  return {
    text: `${soFar} · ${daysLeftText(goal.daysLeft)}`,
    paceNote: goal.belowPace === 1 ? BELOW_PACE : null,
    bar: {
      value,
      max: month.targetValue,
      label: `${goalMetricLabel(goal.metric)} so far this month`,
      valueText: soFar,
    },
  }
}

function averageLine(goal: GoalListProgress, month: Month): GoalLiveView {
  const { reading } = month
  const target = `target ${goalFigure(goal.metric, month.targetValue)}`
  const left = daysLeftText(goal.daysLeft)
  if (reading.kind === 'live') {
    return {
      text: `${goalFigure(goal.metric, reading.value)} so far · ${target} · ${left}`,
      paceNote: null,
      bar: null,
    }
  }
  if (reading.kind === 'too_few') {
    const counted = `${reading.sampleCount} of ${reading.minimumSample} so far`
    return {
      text: `More ratings needed · ${counted} · ${target} · ${left}`,
      paceNote: null,
      bar: null,
    }
  }
  return { text: goalSoFarNote(goal.metric, reading) ?? '', paceNote: null, bar: null }
}

function oneSubjectLine(goal: GoalListProgress, month: Month): GoalLiveView {
  const { reading } = month
  if (goal.metric === 'portal_rating_average') return averageLine(goal, month)
  if (reading.kind === 'live') return countLine(goal, month, reading.value)
  return { text: goalSoFarNote(goal.metric, reading) ?? '', paceNote: null, bar: null }
}

function severalSubjectsText(goal: GoalListProgress): string {
  const subjects = `${goal.subjectCount} subjects`
  if (goal.belowPace === null) return subjects
  const below = goal.belowPace === 0 ? 'none' : String(goal.belowPace)
  return `${subjects} · ${below} ${BELOW_PACE}`
}

/** The live line of an active goal's row; null when there is nothing to add to it. */
export function goalLiveView(goal: GoalListProgress): GoalLiveView | null {
  if (goal.month !== null) return oneSubjectLine(goal, goal.month)
  if (goal.subjectCount > 1) {
    return { text: severalSubjectsText(goal), paceNote: null, bar: null }
  }
  return null
}

/** What a row will hold under it once its month is read: a line, or a line and a bar. */
export type GoalLiveShape = 'line' | 'line_and_bar'

/**
 * The room to keep under a row while its month is still being read, so the line
 * that arrives does not push the rows below it down. It is told from the goal's
 * own row, before any figure: only an active goal has a live line, and only a
 * count with one subject draws a bar. Null for a goal that will have none.
 */
export function goalLiveShape(
  row: Readonly<{ status: string; metric: GoalMetric; subjectCount: number }>,
): GoalLiveShape | null {
  if (row.status !== 'active' || row.subjectCount < 1) return null
  const bar = row.subjectCount === 1 && row.metric !== 'portal_rating_average'
  return bar ? 'line_and_bar' : 'line'
}

/**
 * The subjects a row names in its quiet line. A goal with several subjects has
 * them in its live line, so the quiet line leaves them out; otherwise it names
 * them, as it always has.
 */
export function goalListSubjectText(
  count: number,
  live: GoalListProgress | undefined,
): string | null {
  if (live !== undefined && live.month === null && live.subjectCount > 1) return null
  return `${count} ${plural(count, 'subject', 'subjects')}`
}

/**
 * The quiet line of a row: the measure, the target, the subjects when the live
 * line does not name them, and when the target was set. Parts that are not
 * there are left out.
 */
export function goalListSummary(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(' · ')
}
