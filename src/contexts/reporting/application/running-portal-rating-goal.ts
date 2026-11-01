import type { GoalProgramBundle } from './ports/goal-program.repository'

/** A coming scans version does not end the private-rating month already running. */
export function hasRunningPortalRatingGoal(
  programs: readonly GoalProgramBundle[],
  portalId: string,
  now: Date,
): boolean {
  return programs.some(
    ({ program, versions, assignments }) =>
      program.status !== 'ended' &&
      assignments.some(
        (assignment) =>
          assignment.subject.kind === 'portal' &&
          assignment.subject.portalId === portalId &&
          (assignment.effectiveTo === null || assignment.effectiveTo > now) &&
          versions.some(
            (version) =>
              version.id === assignment.programVersionId &&
              version.metric !== 'qualified_scans' &&
              (version.effectiveTo === null || version.effectiveTo > now),
          ),
      ),
  )
}
