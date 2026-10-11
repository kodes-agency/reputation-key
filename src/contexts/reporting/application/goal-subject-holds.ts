// Reporting — which subjects a goal already holds for a measure.
//
// One subject carries one goal per measure at a time. This is the rule the
// database's no-overlap constraint enforces and the create command checks
// before it writes, stated once for a form that has the goal list in hand: it
// can say which goal holds a subject, and until when, without another request.
import {
  goalSubjectIdentity,
  type GoalMetric,
  type GoalSubject,
} from '../domain/goal-program'
import type {
  GoalProgramBundle,
  GoalSubjectAssignment,
} from './ports/goal-program.repository'

export type GoalSubjectHold = Readonly<{
  subject: GoalSubject
  programId: string
  programName: string
  /** The target of the version the holding assignment belongs to. */
  targetValue: number
  /** Null while the goal is live; otherwise the instant the subject is free again. */
  heldUntil: Date | null
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
 * The subjects held for `metric` from `from`, one entry per subject: the hold
 * that lasts longest. A goal ended this month still holds its subject until
 * the month it had open ends.
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
      const version =
        bundle.versions.find(
          (candidate) => candidate.id === assignment.programVersionId,
        ) ?? bundle.version
      holds.set(identity, {
        subject: assignment.subject,
        programId: bundle.program.id,
        programName: bundle.program.name,
        targetValue: version.targetValue,
        heldUntil: assignment.effectiveTo,
      })
    }
  }
  return [...holds.values()]
}
