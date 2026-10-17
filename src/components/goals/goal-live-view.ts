// What a Goals row says under an active goal about the month so far, and who
// the goal is for.
//
// It is the live month to date and never the month's result, so it counts and
// does not judge: "64 of 120 so far", never "on track". The one thing it may
// say beyond the count is the nudge the Overview chip gives, "below pace", and
// only when the goal is (`goalPace`): never "on pace", never a verdict on the
// month. A count with one subject gets a neutral bar and, when it is below
// pace, that note; an average gets its figure against the target and no pace;
// a goal with several subjects gets how many are below pace. A figure that
// cannot be read says so and is never a zero, and an average too thin to show
// asks for more ratings. The quiet line names who a goal is for, never a count
// of subjects. Today counts as a day left. Pure.
import type {
  GoalListProgress,
  GoalMetric,
  GoalSubject,
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
   * The nudge in quiet amber, "below pace"; null for a goal that is not below
   * pace, or whose pace was not judged. It is its own part, not the end of
   * `text`: where it goes (after the days left, or beside the bar) depends on
   * the room the cell has, so `GoalLiveLine` places it and draws the separator.
   */
  paceNote: string | null
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

function countLine(goal: GoalListProgress, month: Month, value: number): GoalLiveView {
  const target = goalFigure(goal.metric, month.targetValue)
  const soFar = `${goalFigure(goal.metric, value)} of ${target} so far`
  return {
    text: `${soFar} · ${daysLeftWords(goal.daysLeft)}`,
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
  const left = daysLeftWords(goal.daysLeft)
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

const SUBJECT_ORDER: Readonly<Record<GoalSubject['kind'], number>> = {
  property: 0,
  portal_group: 1,
  portal: 2,
}

/**
 * Who a goal is for, by name: "Reception", the property's name or "Rooms
 * (group)" for one; "Reception and Spa" for two; "Reception and 2 more" for
 * three or more. The property comes first, then groups, then portals, each in
 * name order. Null for a goal with no subject. `nameOf` gives a subject's own
 * name.
 */
export function goalListSubjectText(
  subjects: readonly GoalSubject[],
  nameOf: (subject: GoalSubject) => string,
): string | null {
  const names = subjects
    .map((subject) => ({
      kind: subject.kind,
      name:
        subject.kind === 'portal_group' ? `${nameOf(subject)} (group)` : nameOf(subject),
    }))
    .sort(
      (left, right) =>
        SUBJECT_ORDER[left.kind] - SUBJECT_ORDER[right.kind] ||
        left.name.localeCompare(right.name),
    )
    .map(({ name }) => name)
  const [first, second] = names
  if (first === undefined) return null
  if (second === undefined) return first
  return names.length === 2
    ? `${first} and ${second}`
    : `${first} and ${names.length - 1} more`
}

/**
 * The quiet line of a row: the measure, the target, the subjects when the live
 * line does not name them, and when the target was set. Parts that are not
 * there are left out.
 */
export function goalListSummary(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(' · ')
}
