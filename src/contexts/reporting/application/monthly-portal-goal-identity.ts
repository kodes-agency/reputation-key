// Select the Property's count goal across private ratings and scans (ADR 0068):
// the earliest-created non-ended Program, else the most recently ended one whose
// window or open/reconciling month still counts. A stopped November goal may still
// be selected in December while November reconciles.
// Average, Portal and Portal Group goals are separate. All Property count goals
// use /goals/portals; other shapes keep their own page. Browser-safe.

import type { GoalMetric, GoalSubject } from '../domain/goal-program'
import type { PortalGoalMeasure } from '../domain/goal-recommendation-types'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
} from './ports/goal-program.repository'

const COUNT_MEASURES: ReadonlySet<GoalMetric> = new Set([
  'portal_rating_count',
  'qualified_scans',
])

/** Private ratings or scans: a measure a Monthly portal goal can count. */
export const isPortalGoalMeasure = (metric: GoalMetric): metric is PortalGoalMeasure =>
  COUNT_MEASURES.has(metric)

/** The current version's subjects, as the goal names them now. */
const currentAssignments = (bundle: GoalProgramBundle) =>
  bundle.assignments.filter(
    (assignment) => assignment.programVersionId === bundle.version.id,
  )

/** A Program that counts private ratings or scans: the Property's, a Portal's or a group's. */
export type PortalCountGoal = GoalProgramBundle &
  Readonly<{ version: GoalProgramVersion & Readonly<{ metric: PortalGoalMeasure }> }>

/** A Program that counts private ratings or scans for the Property alone. */
export type PropertyCountGoal = PortalCountGoal

/** A Program that counts private ratings or scans, for whatever subjects. */
export const isPortalCountGoal = (bundle: GoalProgramBundle): bundle is PortalCountGoal =>
  isPortalGoalMeasure(bundle.version.metric)

/** A count goal whose subject, today, is the Property alone. */
export function isPropertyCountGoal(
  bundle: GoalProgramBundle,
): bundle is PropertyCountGoal {
  if (!isPortalGoalMeasure(bundle.version.metric)) return false
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
  (time: (bundle: PropertyCountGoal) => Date) =>
  (a: PropertyCountGoal, b: PropertyCountGoal): number =>
    time(a).getTime() - time(b).getTime() || a.program.id.localeCompare(b.program.id)

/** The Property's Monthly portal goal among its Programs at `now`, or none. */
export function monthlyPortalGoalOf(
  programs: readonly GoalProgramBundle[],
  now: Date,
): PropertyCountGoal | null {
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

/**
 * The page `$goalId` draws for a goal: the Monthly portal goal's
 * own (`/goals/portals`) for a Property count goal; a subject's page for a count
 * goal for one Portal or one Portal Group; an average's page for the average; a
 * plain page for a goal that names several subjects now; none for a goal that
 * names no subject.
 */
export function portalGoalPageOf(
  bundle: GoalProgramBundle,
):
  | Readonly<{ kind: 'monthly' }>
  | Readonly<{ kind: 'subject' | 'average'; subject: GoalSubject }>
  | Readonly<{ kind: 'several'; subjects: readonly GoalSubject[] }>
  | null {
  if (isPropertyCountGoal(bundle)) return { kind: 'monthly' }
  const assignments = currentAssignments(bundle)
  const [only, ...more] = assignments
  if (only === undefined) return null
  if (more.length > 0) {
    return { kind: 'several', subjects: assignments.map(({ subject }) => subject) }
  }
  const { subject } = only
  if (bundle.version.metric === 'portal_rating_average') {
    return { kind: 'average', subject }
  }
  return subject.kind === 'property' ? null : { kind: 'subject', subject }
}
