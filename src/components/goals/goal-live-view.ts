// What a Goals row says under an active goal about the month so far.
//
// It is the live month to date and never the month's result, so its words count
// and do not judge: "64 of 120 so far", never "on track". The pace is the shared
// pill (ADR 0068, amended 2026-10-19: one goal design system) and it is the
// pace of the month so far, not a forecast of the result: a count with one
// subject gets a neutral bar and, where `goalPace` judged it, "On pace" or
// "Below pace"; a month it did not judge (the first days, too few expected by
// today) gets no pill, and neither does an average, which has no pace. A goal
// with several subjects gets how many are below pace, as words. A figure that
// cannot be read says so and is never a zero, and an average too thin to show
// asks for more ratings. Today counts as a day left. Pure.
import type {
  GoalListProgress,
  GoalMetric,
} from '#/contexts/reporting/application/public-api'
import type { StatusPresentation } from '#/components/ui/status-badge'
import { GOAL_PACE_STATUS } from './goal-pace-status'
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
   * The pace pill of a count with one subject, "On pace" or "Below pace"; null
   * where `goalPace` judged nothing (an early month, too few expected, an
   * average) or the figure cannot be read. It is its own part, not the end of
   * `text`: where it goes (after the days left, or beside the bar) depends on
   * the room the cell has, so `GoalLiveLine` places it.
   */
  pace: StatusPresentation | null
  bar: GoalLiveBar | null
}>

const BELOW_PACE = 'below pace'

type Month = NonNullable<GoalListProgress['month']>

/**
 * "9 days left" on Nov 22 of a 30-day month: today is one of them. The last day
 * of the month is "last day". Takes the whole days that begin after today.
 */
export function daysLeftWords(daysAfterToday: number): string {
  const left = daysAfterToday + 1
  return left <= 1 ? 'last day' : `${left} days left`
}

/**
 * The pill of a count with one subject: 0 below pace is "On pace", 1 is "Below
 * pace", null is not judged and says nothing. A row's read carries no flag for
 * the month's first quiet days, so "Getting started" is the card's and the
 * page's alone: those days are not judged, and a row shows no pill for them.
 */
function countPace(belowPace: number | null): StatusPresentation | null {
  if (belowPace === null) return null
  return belowPace >= 1 ? GOAL_PACE_STATUS.below_pace : GOAL_PACE_STATUS.on_pace
}

function countLine(goal: GoalListProgress, month: Month, value: number): GoalLiveView {
  const target = goalFigure(goal.metric, month.targetValue)
  const soFar = `${goalFigure(goal.metric, value)} of ${target} so far`
  return {
    text: `${soFar} · ${daysLeftWords(goal.daysLeft)}`,
    pace: countPace(goal.belowPace),
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
  const left = daysLeftWords(goal.daysLeft)
  if (reading.kind === 'live') {
    return {
      text: `${goalFigure(goal.metric, reading.value)} so far · ${target} · ${left}`,
      pace: null,
      bar: null,
    }
  }
  if (reading.kind === 'too_few') {
    const counted = `${reading.sampleCount} of ${reading.minimumSample} so far`
    return {
      text: `More ratings needed · ${counted} · ${target} · ${left}`,
      pace: null,
      bar: null,
    }
  }
  return { text: goalSoFarNote(goal.metric, reading) ?? '', pace: null, bar: null }
}

function oneSubjectLine(goal: GoalListProgress, month: Month): GoalLiveView {
  const { reading } = month
  if (goal.metric === 'portal_rating_average') return averageLine(goal, month)
  if (reading.kind === 'live') return countLine(goal, month, reading.value)
  return { text: goalSoFarNote(goal.metric, reading) ?? '', pace: null, bar: null }
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
    return { text: severalSubjectsText(goal), pace: null, bar: null }
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
 * The quiet line of a row: the measure, the target, who the goal is for by
 * name (`goalListSubjectText`), and when the target was set. Parts that are not
 * there are left out.
 */
export function goalListSummary(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(' · ')
}
