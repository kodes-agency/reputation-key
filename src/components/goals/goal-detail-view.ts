// The words of a goal's own page: when it counts from and when it was set,
// what a goal that has not started is waiting for, and the notes on a month.
//
// Pure. A goal can start in the month it was created in, so the page always
// says when its target was set: a month that was already running when the
// target arrived is marked, and the month still running shows what has counted
// so far (the live month to date, never the month's result).
import type {
  GoalMetric,
  GoalProgram,
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
    /** The goal has ended: no further month will open. */
    ended: boolean
    /** The months the goal has opened so far, under any target. */
    months: readonly Readonly<{ periodStart: Date }>[]
    /** The first month counted against the target, or the month planned for it. */
    countsFrom: Date
    /** When the target now in force was set. */
    setAt: Date
  }>

/**
 * "Counts from Oct 1 · set on Oct 11", or "Starts on Nov 1 · set on Oct 21"
 * while the goal's first month is still ahead.
 *
 * A target changed while a month is running waits for the next one, and the
 * goal goes on counting under the target before it: that reads "Target applies
 * from Nov 1 · set on Oct 12", never "Starts on". A goal that ended first says
 * the target never applied, and one ended before its first month says so.
 */
export function goalStartLine(facts: GoalStartFacts): string {
  const set = `set on ${goalDay(facts.setAt, facts)}`
  const started = facts.months.length > 0
  if (facts.ended && !started) return `Never started · ${set}`
  // No month has opened under this target yet: every month so far began
  // before the one it counts from.
  const waiting =
    started && facts.months.every((month) => month.periodStart < facts.countsFrom)
  if (waiting && facts.ended) return `Target never applied · ${set}`
  const from = goalDay(facts.countsFrom, facts)
  if (facts.countsFrom <= facts.now) return `Counts from ${from} · ${set}`
  return started ? `Target applies from ${from} · ${set}` : `Starts on ${from} · ${set}`
}

/** A reason the system wrote: lower-case words joined by underscores, and nothing else. */
const isSystemCode = (note: string): boolean =>
  note.includes('_') && /^[a-z_]+$/u.test(note)

/**
 * The reasons this page sent with every status change before the note became
 * optional. No manager wrote them and each only repeats the status badge, so a
 * goal changed back then prints no line for one.
 */
const FORMER_DEFAULT_REASONS: ReadonlySet<string> = new Set([
  'Goal paused',
  'Goal active',
  'Ended by manager',
])

/**
 * Why a Program has the status it has, in words. The system writes a code, and
 * each one it writes today has a sentence here; a code without one still reads
 * as words, never as a code. A manager's note is printed as it was written.
 * Null when there is no reason, and then the page prints no line for it.
 */
export function statusReasonLabel(
  reason: string | null,
  startsOn: string,
): string | null {
  const note = reason?.trim()
  if (!note || FORMER_DEFAULT_REASONS.has(note)) return null
  if (note === 'metric_source_not_active') return 'Waiting for the metric source'
  if (note === 'awaiting_first_full_month') return `Starts on ${startsOn}`
  if (note === 'organization_closure_fence') {
    return 'Paused while the organization is being closed'
  }
  return isSystemCode(note) ? note.replaceAll('_', ' ') : note
}

/**
 * The one line a goal that has not started carries about its start month. Its
 * target, name and subjects can be edited before it starts; the month cannot,
 * so the page says how to move it. Null once a month has opened or the goal
 * has ended.
 */
export function goalStartMonthHint(
  goal: Readonly<{ status: GoalProgram['status']; resultCount: number }>,
): string | null {
  return goal.status === 'scheduled' && goal.resultCount === 0
    ? 'To change the start month, end this goal and set it again.'
    : null
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
