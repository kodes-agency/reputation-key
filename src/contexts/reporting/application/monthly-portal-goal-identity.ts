// Reporting — which Goal Program is a Property's Monthly portal goal (ADR 0068
// decision 1, PLAN E9).
//
// The Monthly portal goal is not a kind of Program: it is the Property's count
// goal, the one whose subject is the Property alone and whose measure is private
// ratings or scans. One per Property is a screen rule, so it is chosen here and
// nowhere else, by Program, from the Programs the Property has:
//
// - the earliest-created one that has not ended (scheduled, active or paused);
// - else the most recently ended one that still counts a month: its window is
//   not over yet (a goal stopped on Nov 12 counts to Nov 30), or one of its
//   months is still open or reconciling (November is read on Dec 1 and 2).
//
// An average, a goal for a Portal or a Portal Group, and a goal whose month has
// closed are never it. Pure and client-safe: it reads only the bundles.
import type { GoalMetric } from '../domain/goal-program'
import type { GoalProgramBundle } from './ports/goal-program.repository'

const COUNT_MEASURES: ReadonlySet<GoalMetric> = new Set([
  'portal_rating_count',
  'qualified_scans',
])

/** The current version's subjects, as the goal names them now. */
const currentAssignments = (bundle: GoalProgramBundle) =>
  bundle.assignments.filter(
    (assignment) => assignment.programVersionId === bundle.version.id,
  )

/** A count goal whose subject, today, is the Property alone. */
function isPropertyCountGoal(bundle: GoalProgramBundle): boolean {
  if (!COUNT_MEASURES.has(bundle.version.metric)) return false
  const subjects = currentAssignments(bundle)
  return (
    subjects.length > 0 &&
    subjects.every((assignment) => assignment.subject.kind === 'property')
  )
}

/**
 * An ended goal still counts a month: its window holds days after now (an
 * empty window, a goal that ended before it began, holds none), or a month of
 * it is still open or reconciling.
 */
function stillCounts(bundle: GoalProgramBundle, now: Date): boolean {
  const windowOpen = currentAssignments(bundle).some(
    ({ effectiveFrom, effectiveTo }) =>
      effectiveTo === null || (effectiveTo > effectiveFrom && effectiveTo > now),
  )
  return (
    windowOpen ||
    bundle.results.some(({ status }) => status === 'open' || status === 'reconciling')
  )
}

const byTime =
  (time: (bundle: GoalProgramBundle) => Date) =>
  (a: GoalProgramBundle, b: GoalProgramBundle): number =>
    time(a).getTime() - time(b).getTime() || a.program.id.localeCompare(b.program.id)

/** The Property's Monthly portal goal among its Programs at `now`, or none. */
export function monthlyPortalGoalOf(
  programs: readonly GoalProgramBundle[],
  now: Date,
): GoalProgramBundle | null {
  const candidates = programs.filter(isPropertyCountGoal)
  const [running] = candidates
    .filter(({ program }) => program.status !== 'ended')
    .sort(byTime(({ program }) => program.createdAt))
  if (running) return running
  // Ending is the last change an ended goal takes, so its update time is when it ended.
  const ended = candidates
    .filter(({ program }) => program.status === 'ended')
    .filter((bundle) => stillCounts(bundle, now))
    .sort(byTime(({ program }) => program.updatedAt))
  return ended.at(-1) ?? null
}
