// The goal card on a group's page (board 13): "September · Private ratings",
// the figure so far against the target, a neutral bar, and who set it. Pure: the
// words and the bar's fill are decided here, from the live month-to-date read.
//
// It is never the month's result. The figure is what has counted so far, so the
// bar is neutral (no good or bad colour, no praise), a figure that cannot be
// read is not a zero, and an average too thin to show says why instead.
import type { GoalProgress } from '#/contexts/reporting/application/public-api'
import { goalMetricLabel } from '#/components/goals/goal-metric-label'
import { formatNumber, formatDayKey, formatMonthDay, formatMonthName } from '#/lib/format'

export type GoalCardState = 'live' | 'too_few' | 'unavailable' | 'not_started'

export type GoalCardView = Readonly<{
  /** "September · Private ratings". */
  title: string
  state: GoalCardState
  /** The figure so far; null where there is none to show. */
  figure: string | null
  /** "of 250". */
  target: string
  /** 0 to 1 for the bar; null where there is no figure. */
  fraction: number | null
  /** Why there is no figure, or what the goal is waiting for. */
  detail: string | null
  /** "Set by Elena Petrova · the month ends today". */
  note: string
  /** What the bar says to a screen reader. */
  progressLabel: string
}>

export type GoalCardContext = Readonly<{
  /** The person's name, or null where the directory cannot give one. */
  setByName: (userId: string) => string | null
  now: Date
}>

const DAY_MS = 86_400_000

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round(
    (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS,
  )
}

/** Whole local days from today to the month's last day: 0 on that day, negative after it. */
function daysLeftInMonth(goal: GoalProgress, now: Date): number {
  const lastDay = new Date(goal.period.end.getTime() - 1)
  const today = formatDayKey(now, goal.timezone)
  const last = formatDayKey(lastDay, goal.timezone)
  // A day that cannot be read counts as past, which says nothing rather than a wrong count.
  return today === null || last === null ? -1 : daysBetween(today, last)
}

function monthEnds(daysLeft: number): string | null {
  if (daysLeft < 0) return null
  if (daysLeft === 0) return 'the month ends today'
  if (daysLeft === 1) return 'the month ends tomorrow'
  return `the month ends in ${daysLeft} days`
}

function formatValue(goal: GoalProgress, value: number): string {
  return goal.metric === 'portal_rating_average' ? value.toFixed(1) : formatNumber(value)
}

function noteOf(goal: GoalProgress, context: GoalCardContext): string {
  const name = context.setByName(goal.setBy)
  const ends =
    goal.status === 'active' ? monthEnds(daysLeftInMonth(goal, context.now)) : null
  const parts = [name === null ? null : `Set by ${name}`, ends].filter(
    (part): part is string => part !== null,
  )
  const note = parts.join(' · ')
  return name === null ? note.charAt(0).toUpperCase() + note.slice(1) : note
}

type Outcome = Readonly<{
  state: GoalCardState
  figure: string | null
  fraction: number | null
  detail: string | null
}>

function outcomeOf(goal: GoalProgress): Outcome {
  const { reading } = goal
  switch (reading.kind) {
    case 'live':
      return {
        state: 'live',
        figure: formatValue(goal, reading.value),
        fraction: Math.min(Math.max(reading.value / goal.targetValue, 0), 1),
        detail: null,
      }
    case 'too_few':
      return {
        state: 'too_few',
        figure: null,
        fraction: null,
        detail: `Too few ratings so far: ${reading.sampleCount} of the ${reading.minimumSample} an average needs`,
      }
    case 'unavailable':
      return {
        state: 'unavailable',
        figure: null,
        fraction: null,
        detail: 'This figure can’t be read right now',
      }
    case 'not_started':
      return {
        state: 'not_started',
        figure: null,
        fraction: null,
        detail:
          goal.status === 'paused'
            ? 'Paused'
            : `Starts on ${formatMonthDay(goal.period.start, goal.timezone) ?? 'a later date'}`,
      }
  }
}

export function goalCardView(goal: GoalProgress, context: GoalCardContext): GoalCardView {
  const label = goalMetricLabel(goal.metric)
  const outcome = outcomeOf(goal)
  const target = formatValue(goal, goal.targetValue)
  return {
    title: `${formatMonthName(goal.period.start, goal.timezone) ?? 'This month'} · ${label}`,
    ...outcome,
    target: `of ${target}`,
    note: noteOf(goal, context),
    progressLabel:
      outcome.figure === null
        ? `${label}: no figure yet`
        : `${label}: ${outcome.figure} of ${target} so far this month`,
  }
}
