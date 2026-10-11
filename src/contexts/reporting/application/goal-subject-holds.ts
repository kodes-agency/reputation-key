// Reporting — which subjects a goal already holds for a measure.
//
// One subject carries one goal per measure at a time. This is the rule the
// database's no-overlap constraint enforces and the create command checks
// before it writes, stated once for a form that has the goal list in hand: it
// can say which goal holds a subject, with what target and until when, without
// another request.
import type { GoalMetric } from '../domain/goal-program'
import { goalSubjectIdentity, type GoalSubject } from '../domain/goal-subject'
import type {
  GoalProgramBundle,
  GoalSubjectAssignment,
} from './ports/goal-program.repository'

export type GoalSubjectHold = Readonly<{
  subject: GoalSubject
  /** The goal that holds the subject. */
  programId: string
  programName: string
  /**
   * That goal's target for the subject at the start asked about: the one in
   * force then, or the one the goal begins on when it has not begun by then.
   */
  targetValue: number
  /** Null while the goal is live; otherwise the instant the subject is free again. */
  heldUntil: Date | null
  /**
   * The goal that holds the subject has ended. It holds its subject until the
   * month it had open is over and takes no further change, a change to that
   * month's target included. A subject taken out of a goal that goes on is held
   * until the month ends too, by a goal that can still be changed.
   */
  goalEnded: boolean
}>

/**
 * True when an assignment holds its subject for a goal that starts at `from`:
 * it is open-ended, or it ends after `from`. A window that ends where it
 * starts (a goal ended before it began) is empty and holds nothing.
 */
export function assignmentHoldsFrom(
  assignment: Pick<GoalSubjectAssignment, 'effectiveFrom' | 'effectiveTo'>,
  from: Date,
): boolean {
  return (
    assignment.effectiveTo === null ||
    (assignment.effectiveTo > from && assignment.effectiveTo > assignment.effectiveFrom)
  )
}

/** True when a hold ending at `candidate` outlasts one ending at `known`; null never ends. */
export const holdOutlasts = (candidate: Date | null, known: Date | null): boolean =>
  known !== null && (candidate === null || candidate > known)

/**
 * The goal's target for a held subject at `from`. A revision that waits for
 * next month already holds the subject for good, but the month `from` is in is
 * still counted against the target before it: the assignment in force at
 * `from` says which. A goal that has not begun by `from` has none in force,
 * and shows the target it begins on.
 */
function targetAt(
  bundle: GoalProgramBundle,
  holding: GoalSubjectAssignment,
  from: Date,
): number {
  const identity = goalSubjectIdentity(holding.subject)
  const inForce =
    bundle.assignments.find(
      (candidate) =>
        candidate.metric === holding.metric &&
        goalSubjectIdentity(candidate.subject) === identity &&
        candidate.effectiveFrom <= from &&
        assignmentHoldsFrom(candidate, from),
    ) ?? holding
  const version =
    bundle.versions.find((candidate) => candidate.id === inForce.programVersionId) ??
    bundle.version
  return version.targetValue
}

/**
 * The subjects held for `metric` from `from`, one entry per subject: the hold
 * that lasts longest, with that goal's target at `from`. A goal ended this
 * month still holds its subject until the month it had open ends.
 */
export function subjectHolds(
  bundles: readonly GoalProgramBundle[],
  metric: GoalMetric,
  from: Date,
): readonly GoalSubjectHold[] {
  const holds = new Map<string, GoalSubjectHold>()
  for (const bundle of bundles) {
    for (const assignment of bundle.assignments) {
      if (assignment.metric !== metric || !assignmentHoldsFrom(assignment, from)) continue
      const identity = goalSubjectIdentity(assignment.subject)
      const known = holds.get(identity)
      if (known && !holdOutlasts(assignment.effectiveTo, known.heldUntil)) continue
      holds.set(identity, {
        subject: assignment.subject,
        programId: bundle.program.id,
        programName: bundle.program.name,
        targetValue: targetAt(bundle, assignment, from),
        heldUntil: assignment.effectiveTo,
        goalEnded: bundle.program.status === 'ended',
      })
    }
  }
  return [...holds.values()]
}
