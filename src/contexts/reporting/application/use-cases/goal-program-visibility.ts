// Goal creators see every Program at the Property. Other readers see only
// Property assignments and their responsible Portals/groups, matching results
// and target changes. No visible assignments means the Program is not found.

import { canForContext } from '#/shared/domain/permissions'
import type { GoalSubject } from '../../domain/goal-program'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import {
  GoalProgramError,
  type GoalActor,
  type GoalProgramService,
} from '../../monthly-goals/goal-programs.server'

/** The Portals an actor is responsible for at a Property, and their Portal Groups. */
export type GoalProgramVisibilityPort = (
  input: Readonly<{ actor: GoalActor; propertyId: string }>,
) => Promise<Readonly<{ portalIds: readonly string[]; groupIds: readonly string[] }>>

export function scopeGoalProgramsForMember<
  Assignment extends Readonly<{ id: string; subject: GoalSubject }>,
  Result extends Readonly<{ id: string; assignmentId: string }>,
  TargetChange extends Readonly<{ monthlyResultId: string }>,
  Program extends Readonly<{
    assignments: readonly Assignment[]
    results: readonly Result[]
    targetChanges?: readonly TargetChange[]
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
    const results = bundle.results.filter(({ assignmentId }) =>
      assignmentIds.has(assignmentId),
    )
    const resultIds = new Set(results.map(({ id }) => id))
    return [
      {
        ...bundle,
        assignments,
        results,
        // A change to a month's target is read with its month, or not at all.
        ...(bundle.targetChanges
          ? {
              targetChanges: bundle.targetChanges.filter(({ monthlyResultId }) =>
                resultIds.has(monthlyResultId),
              ),
            }
          : {}),
      },
    ]
  })
}

type GoalProgramReads = Pick<GoalProgramService, 'get' | 'list'> &
  Partial<Pick<GoalProgramService, 'history'>>

/**
 * Scope Goal Program reads to what the actor may see. The wrapped reads
 * authorize `goal.read` and load first, exactly as before scoping.
 */
export function withGoalProgramVisibility(
  reads: GoalProgramReads,
  visibility: GoalProgramVisibilityPort,
  staffTargetPaused?: (
    bundle: GoalProgramBundle,
    actor: GoalActor,
    propertyId: string,
  ) => Promise<boolean>,
): GoalProgramReads {
  const visibleTo = async (
    programs: readonly GoalProgramBundle[],
    actor: GoalActor,
    propertyId: string,
  ): Promise<readonly GoalProgramBundle[]> => {
    const shown = staffTargetPaused
      ? await Promise.all(
          programs.map(async (bundle) =>
            bundle.program.status !== 'ended' &&
            (await staffTargetPaused(bundle, actor, propertyId))
              ? { ...bundle, program: { ...bundle.program, status: 'paused' as const } }
              : bundle,
          ),
        )
      : programs
    if (canForContext(actor, 'goal.create')) return shown
    const { portalIds, groupIds } = await visibility({ actor, propertyId })
    return scopeGoalProgramsForMember(shown, portalIds, groupIds)
  }

  return {
    ...(reads.history
      ? {
          history: async (...args: Parameters<GoalProgramService['history']>) => {
            const [input, actor] = args
            if (canForContext(actor, 'goal.create')) return reads.history!(...args)
            const program = await reads.get(input, actor)
            const { portalIds, groupIds } = await visibility({
              actor,
              propertyId: input.propertyId,
            })
            const [visibleProgram] = scopeGoalProgramsForMember(
              [program],
              portalIds,
              groupIds,
            )
            if (!visibleProgram) throw new GoalProgramError('not_found')
            // Scope the database page before its limit and continuation are chosen.
            const page = await reads.history!(
              {
                ...input,
                subjects: visibleProgram.assignments.map(({ subject }) => subject),
              },
              actor,
            )
            const [visible] = scopeGoalProgramsForMember([page], portalIds, groupIds)
            if (!visible)
              return {
                ...page,
                assignments: [],
                results: [],
                versions: [],
                targetChanges: [],
                targetProvenance: {},
                next: null,
              }
            const versionIds = new Set(
              visible.assignments.map((assignment) => assignment.programVersionId),
            )
            return {
              ...visible,
              versions: page.versions.filter((version) => versionIds.has(version.id)),
              ...(page.targetProvenance
                ? {
                    targetProvenance: Object.fromEntries(
                      Object.entries(page.targetProvenance).filter(([id]) =>
                        versionIds.has(id),
                      ),
                    ),
                  }
                : {}),
            }
          },
        }
      : {}),
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
