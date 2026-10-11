// The words of a goal's own page: when it counts from and when it was set,
// what a goal that has not started is waiting for, and the notes on a month.
//
// Pure. A goal can start in the month it was created in, so the page always
// says when its target was set: a month that was already running when the
// target arrived is marked, and the month still running shows what has counted
// so far (the live month to date, never the month's result).
import type {
  GoalMetric,
  GoalProgress,
} from '#/contexts/reporting/application/public-api'
import { formatShortDate } from '#/lib/format'
import { goalSoFarNote } from './goal-so-far'

type Calendar = Readonly<{ timezone: string; now: Date }>

/** "Oct 11", with its year once it is not the year the reader is in. */
export const goalDay = (date: Date, { timezone, now }: Calendar): string =>
  formatShortDate(date, timezone, now) ?? 'an unknown date'

export type GoalStartFacts = Calendar &
  Readonly<{
    /** Ended with no month ever opened. */
    neverStarted: boolean
    /** The first month counted against the target, or the planned start. */
    countsFrom: Date
    /** When the target now in force was set. */
    setAt: Date
  }>

/**
 * "Counts from Oct 1 · set on Oct 11", or "Starts on Nov 1 · set on Oct 21"
 * while that month is still ahead. A goal ended before its first month says so.
 */
export function goalStartLine(facts: GoalStartFacts): string {
  const set = `set on ${goalDay(facts.setAt, facts)}`
  if (facts.neverStarted) return `Never started · ${set}`
  const from = goalDay(facts.countsFrom, facts)
  return facts.countsFrom > facts.now
    ? `Starts on ${from} · ${set}`
    : `Counts from ${from} · ${set}`
}

/** A Program's status note in words; a note with no wording here is never shown as a code. */
export function goalStatusNote(reason: string, startsOn: string): string {
  if (reason === 'metric_source_not_active') return 'Waiting for the metric source'
  if (reason === 'awaiting_first_full_month') return `Starts on ${startsOn}`
  return reason.replaceAll('_', ' ')
}

/** What the results card says while a goal has no month to show. */
export function goalNoResultsText(
  input: Readonly<{ scheduled: boolean; statusReason: string | null; startsOn: string }>,
): string {
  if (!input.scheduled) return 'This goal has no monthly results.'
  return input.statusReason === 'metric_source_not_active'
    ? 'Results start when the metric source is ready.'
    : `Results start on ${input.startsOn}.`
}

export type GoalMonthNotesInput = Calendar &
  Readonly<{
    metric: GoalMetric
    result: Readonly<{ status: string; periodStart: Date }>
    /** When the target this month is judged against was set. */
    setAt: Date
    /** The live month to date of this row's subject, once it has been read. */
    progress: Pick<GoalProgress, 'period' | 'reading'> | null
  }>

/**
 * The quiet lines under a month's figure: "412 so far" on the month still
 * running, and "Set on Oct 20" on a month that had begun when its target was
 * set.
 */
export function goalMonthNotes(input: GoalMonthNotesInput): readonly string[] {
  const { result, progress } = input
  const running =
    progress !== null &&
    result.status === 'open' &&
    progress.period.start.getTime() === result.periodStart.getTime()
  const soFar = running ? goalSoFarNote(input.metric, progress.reading) : null
  const setDuringMonth =
    input.setAt > result.periodStart ? `Set on ${goalDay(input.setAt, input)}` : null
  return [soFar, setDuringMonth].filter((note): note is string => note !== null)
}
