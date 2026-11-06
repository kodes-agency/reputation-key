import { and, eq, ne } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import {
  goalPrograms,
  goalProgramVersions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import { isPropertyCountGoal } from '../../application/monthly-portal-goal-identity'
import type {
  GoalProgramVersion,
  GoalSubjectAssignment,
} from '../../application/ports/goal-program.repository'
import { GoalProgramError } from '../../application/use-cases/goal-program-shared'
import { mapAssignment, mapVersion } from './goal-program.rows'

/** The caller holds the Property definition lock before reading or writing a Program. */
export async function assertPropertyCountGoalAvailable(
  tx: Tx,
  version: GoalProgramVersion,
  assignments: readonly GoalSubjectAssignment[],
): Promise<void> {
  if (!isPropertyCountGoal({ version, assignments })) return
  const rows = await tx
    .select({ version: goalProgramVersions, assignment: goalSubjectAssignments })
    .from(goalPrograms)
    .innerJoin(
      goalProgramVersions,
      and(
        eq(goalProgramVersions.organizationId, goalPrograms.organizationId),
        eq(goalProgramVersions.propertyId, goalPrograms.propertyId),
        eq(goalProgramVersions.programId, goalPrograms.id),
        eq(goalProgramVersions.version, goalPrograms.currentVersion),
      ),
    )
    .leftJoin(
      goalSubjectAssignments,
      and(
        eq(goalSubjectAssignments.organizationId, goalPrograms.organizationId),
        eq(goalSubjectAssignments.propertyId, goalPrograms.propertyId),
        eq(goalSubjectAssignments.programVersionId, goalProgramVersions.id),
      ),
    )
    .where(
      and(
        eq(goalPrograms.organizationId, version.organizationId),
        eq(goalPrograms.propertyId, version.propertyId),
        ne(goalPrograms.id, version.programId),
        ne(goalPrograms.status, 'ended'),
      ),
    )
  const definitions = new Map<
    string,
    {
      version: GoalProgramVersion
      assignments: GoalSubjectAssignment[]
    }
  >()
  for (const row of rows) {
    let definition = definitions.get(row.version.id)
    if (!definition) {
      definition = { version: mapVersion(row.version), assignments: [] }
      definitions.set(row.version.id, definition)
    }
    if (row.assignment) definition.assignments.push(mapAssignment(row.assignment))
  }
  if ([...definitions.values()].some(isPropertyCountGoal)) {
    throw new GoalProgramError('subject_has_goal')
  }
}
