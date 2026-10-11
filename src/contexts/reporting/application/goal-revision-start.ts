// Reporting — the month a change to a goal starts in.
//
// A change to a goal's measure, target or subjects is a new version that
// starts with a whole Property-local month. Which month depends on how far the
// goal's head version has come, so the rule is stated once here: the revise
// and change-subjects commands call it to write the version, and the dialogs
// call it to say "Applies from {date}" before the manager saves.
import {
  firstFullMonthlyPeriodAtOrAfter,
  type GoalMonthlyPeriod,
  type GoalProgramStatus,
} from '../domain/goal-program'
import type {
  GoalMonthlyResult,
  GoalProgramVersion,
} from './ports/goal-program.repository'

/**
 * How far a Program's head version has come:
 * - `never_started`: the goal is scheduled and no month has opened yet;
 * - `pending`: the goal has started, and its head is a change still waiting
 *   for its first month;
 * - `in_force`: at least one month has opened under the head.
 *
 * A head with no month is replaced by the next change and keeps an empty
 * window. A head in force is closed where the next change starts.
 */
export type GoalHeadState = 'never_started' | 'pending' | 'in_force'

export type GoalRevisionStart = Readonly<{
  head: GoalHeadState
  /** The first month the change counts for. */
  period: GoalMonthlyPeriod
}>

/** The part of a Program bundle the start of its next change is read from. */
type RevisionSource = Readonly<{
  program: Readonly<{ status: GoalProgramStatus }>
  version: Pick<GoalProgramVersion, 'id' | 'effectiveFrom'>
  results: readonly Pick<GoalMonthlyResult, 'programVersionId' | 'status' | 'periodEnd'>[]
}>

/**
 * The earliest instant a revision may start: after the request, and never
 * before a month that still has to reconcile ends. That month belongs to the
 * current version's timezone; the next month in a Property timezone further
 * east starts before it ends, and closing the version there would leave the
 * month outside its version window, where the database refuses every update.
 */
function earliestRevisionStart(results: RevisionSource['results'], now: Date): Date {
  // One millisecond on: a revision never redefines a month already in
  // progress, even when the request lands exactly on its first instant.
  const earliest = results
    .filter((result) => result.status === 'open' || result.status === 'reconciling')
    .reduce(
      (latest, result) => Math.max(latest, result.periodEnd.getTime()),
      now.getTime() + 1,
    )
  return new Date(earliest)
}

function headState(bundle: RevisionSource): GoalHeadState {
  // Not `version.effectiveFrom > now`: a scheduled goal whose start has passed
  // but which maintenance has not activated yet has still not started.
  if (bundle.program.status === 'scheduled' && bundle.results.length === 0) {
    return 'never_started'
  }
  return bundle.results.some((result) => result.programVersionId === bundle.version.id)
    ? 'in_force'
    : 'pending'
}

/**
 * The month the next change to this goal starts in, as of `now`. `timezone` is
 * the one the new version will be cut in: the Property's own for a revision,
 * the head version's for a change of subjects, which keeps the version's zone.
 *
 * The start is always recomputed, never copied from the head, so it is a real
 * local month start even after the Property changed time zone:
 * - a goal that has not started keeps its start month;
 * - a change waiting for its month is replaced from that month, or from the
 *   first month after every month still open or reconciling, if that is later;
 * - a head in force is followed from the first month after every month still
 *   open or reconciling.
 *
 * The commands open an active goal's due months before they call this. A
 * screen that calls it with a bundle read earlier can therefore be a month
 * behind for the first hour of a month; the saved change states its own start.
 */
export function nextRevisionStart(
  bundle: RevisionSource,
  now: Date,
  timezone: string,
): GoalRevisionStart {
  const head = headState(bundle)
  const headStart = bundle.version.effectiveFrom
  const afterOpenMonths = earliestRevisionStart(bundle.results, now)
  const earliest =
    head === 'never_started'
      ? headStart
      : head === 'pending' && headStart > afterOpenMonths
        ? headStart
        : afterOpenMonths
  return { head, period: firstFullMonthlyPeriodAtOrAfter(earliest, timezone) }
}
