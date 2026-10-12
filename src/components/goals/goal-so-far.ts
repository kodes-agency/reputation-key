// What the month so far says, in words.
//
// A goal that starts this month counts from the first of the month, so the
// form shows what has already counted before the target is saved, and the
// goal's page shows it on the month still running. It is the live month to
// date and never the month's result: a figure that cannot be read says so and
// is never a zero, and an average too thin to show says why.
import type {
  GoalMetric,
  GoalProgressReading,
} from '#/contexts/reporting/application/public-api'
import { formatNumber } from '#/lib/format'

/** A count as a whole number, an average to one decimal. */
export function goalFigure(metric: GoalMetric, value: number): string {
  return metric === 'portal_rating_average' ? value.toFixed(1) : formatNumber(value)
}

const UNREADABLE = 'This month’s figure can’t be read right now'

type CountingReading = Exclude<GoalProgressReading, Readonly<{ kind: 'not_started' }>>

/** The line under the start choice of a new goal: "So far this month: 412". */
export function goalSoFarLine(metric: GoalMetric, reading: CountingReading): string {
  switch (reading.kind) {
    case 'live':
      return `So far this month: ${goalFigure(metric, reading.value)}`
    case 'too_few':
      return `Too few ratings so far this month: ${reading.sampleCount} of the ${reading.minimumSample} an average needs`
    case 'unavailable':
      return UNREADABLE
  }
}

/** The note on a goal's running month: "412 so far". Null for a goal that is not counting. */
export function goalSoFarNote(
  metric: GoalMetric,
  reading: GoalProgressReading,
): string | null {
  switch (reading.kind) {
    case 'live':
      return `${goalFigure(metric, reading.value)} so far`
    case 'too_few':
      return `Too few ratings so far: ${reading.sampleCount} of the ${reading.minimumSample} an average needs`
    case 'unavailable':
      return UNREADABLE
    case 'not_started':
      return null
  }
}
