// Reporting — which Goal Program assignments and results an actor may read.
//
// An actor who can create Goals reads every Program at the Property. Anyone
// else reads Property-wide assignments plus those for the Portals they are
// responsible for and those Portals' groups, with only the matching results; a
// Program with none of those assignments is not found. Every built-in role that
// reads Goals can also create them (Member lost goal.read in 77a0e1988), so
// today only a custom role would be filtered.

import { canForContext } from '#/shared/domain/permissions'
import type { GoalSubject } from '../../domain/goal-program'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import {
  GoalProgramError,
  type GoalActor,
  type GoalProgramService,
} from './goal-programs'

/** The Portals an actor is responsible for at a Property, and their Portal Groups. */
export type GoalProgramVisibilityPort = (
  input: Readonly<{ actor: GoalActor; propertyId: string }>,
) => Promise<Readonly<{ portalIds: readonly string[]; groupIds: readonly string[] }>>

export function scopeGoalProgramsForMember<
  Assignment extends Readonly<{ id: string; subject: GoalSubject }>,
  Result extends Readonly<{ assignmentId: string }>,
  Program extends Readonly<{
    assignments: readonly Assignment[]
    results: readonly Result[]
  }>,
>(
  programs: readonly Program[],
  visiblePortalIds: readonly string[],
  visibleGroupIds: readonly string[],
): Array<
  Program &
    Readonly<{
      assignments: readonly Assignment[]
      results: readonly Result[]
    }>
> {
  const portalSet = new Set(visiblePortalIds)
  const groupSet = new Set(visibleGroupIds)
  return programs.flatMap((bundle) => {
    const assignments = bundle.assignments.filter(({ subject }) => {
      if (subject.kind === 'property') return true
      if (subject.kind === 'portal') return portalSet.has(subject.portalId)
      return groupSet.has(subject.portalGroupId)
    })
    if (assignments.length === 0) return []
    const assignmentIds = new Set(assignments.map(({ id }) => id))
    return [
      {
        ...bundle,
        assignments,
        results: bundle.results.filter(({ assignmentId }) =>
          assignmentIds.has(assignmentId),
        ),
      },
    ]
  })
}

type GoalProgramReads = Pick<GoalProgramService, 'get' | 'list'>

/**
 * Scope Goal Program reads to what the actor may see. The wrapped reads
 * authorize `goal.read` and load first, exactly as before scoping.
 */
export function withGoalProgramVisibility(
  reads: GoalProgramReads,
  visibility: GoalProgramVisibilityPort,
): GoalProgramReads {
  const visibleTo = async (
    programs: readonly GoalProgramBundle[],
    actor: GoalActor,
    propertyId: string,
  ): Promise<readonly GoalProgramBundle[]> => {
    if (canForContext(actor, 'goal.create')) return programs
    const { portalIds, groupIds } = await visibility({ actor, propertyId })
    return scopeGoalProgramsForMember(programs, portalIds, groupIds)
  }

  return {
    get: async (input, actor) => {
      const program = await reads.get(input, actor)
      const [visible] = await visibleTo([program], actor, input.propertyId)
      if (!visible) throw new GoalProgramError('not_found')
      return visible
    },
    list: async (propertyId, actor) =>
      visibleTo(await reads.list(propertyId, actor), actor, propertyId),
  }
}
