import type { PortalRatingFact } from '#/contexts/portal/application/public-api'
import type { GoalSubject } from '../domain/goal-program'
import type { GoalProgramBundle } from './ports/goal-program.repository'

export type PortalRatingGoalBlock = 'portal' | 'last_collector'

/** A coming scans version does not end the private-rating month already running. */
function ratingSubjects(
  programs: readonly GoalProgramBundle[],
  now: Date,
): readonly GoalSubject[] {
  return programs.flatMap(({ program, versions, assignments }) =>
    program.status === 'ended'
      ? []
      : assignments
          .filter(
            (assignment) =>
              (assignment.effectiveTo === null || assignment.effectiveTo > now) &&
              versions.some(
                (version) =>
                  version.id === assignment.programVersionId &&
                  version.metric !== 'qualified_scans' &&
                  (version.effectiveTo === null || version.effectiveTo > now),
              ),
          )
          .map((assignment) => assignment.subject),
  )
}

/** Refuse losing a direct subject or the last rating collector in a wider running goal. */
export async function findPortalRatingGoalBlock(
  programs: readonly GoalProgramBundle[],
  portalId: string,
  now: Date,
  readPortals: (subject: GoalSubject) => Promise<readonly PortalRatingFact[]>,
): Promise<PortalRatingGoalBlock | null> {
  const subjects = ratingSubjects(programs, now)
  if (
    subjects.some((subject) => subject.kind === 'portal' && subject.portalId === portalId)
  )
    return 'portal'
  for (const subject of subjects) {
    if (subject.kind === 'portal') continue
    const members = await readPortals(subject)
    const collectors =
      subject.kind === 'property'
        ? members.filter((portal) => portal.publicationState === 'published')
        : members
    if (
      collectors.some((portal) => portal.portalId === portalId) &&
      collectors.every(
        (portal) => portal.portalId === portalId || portal.skipPrivateRating,
      )
    ) {
      return 'last_collector'
    }
  }
  return null
}
