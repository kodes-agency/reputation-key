// Goal Program use cases — the details a Program carries outside its versions.
//
// A Program's name and description say what the goal is called. They are not
// part of what is measured, so changing them writes no version and moves no
// month: one update in place, with an audit row. The service composes
// `renameGoal` (goal-programs.ts).
import type { GoalProgram } from '../ports/goal-program.repository'
import {
  GoalProgramError,
  loadChangeableProgram,
  type GoalActor,
  type GoalProgramDependencies,
} from './goal-program-shared'

/** The longest name a Program stores. */
const MAX_GOAL_NAME_LENGTH = 200

export type RenameGoalInput = Readonly<{
  propertyId: string
  programId: string
  name: string
  /** Omitted keeps the description the goal has; null or blank clears it. */
  description?: string | null
}>

/**
 * Rename a Program. An ended Program keeps the name it ended with, like every
 * other part of it. A save that changes nothing writes nothing.
 */
export async function renameGoal(
  deps: GoalProgramDependencies,
  input: RenameGoalInput,
  actor: GoalActor,
): Promise<GoalProgram> {
  await deps.policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    action: 'goal.update',
  })
  const name = input.name.trim()
  if (!name || name.length > MAX_GOAL_NAME_LENGTH) {
    throw new GoalProgramError('invalid_name')
  }
  const { program } = await loadChangeableProgram(deps, actor, input)
  const description =
    input.description === undefined
      ? program.description
      : input.description?.trim() || null
  if (name === program.name && description === program.description) return program

  const renamed = await deps.repository.rename({
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    programId: input.programId,
    name,
    description,
    previousName: program.name,
    previousDescription: program.description,
    actorId: actor.userId,
    at: deps.now(),
  })
  // The Program ended, or was renamed, between the read and the write.
  if (!renamed) throw new GoalProgramError('revision_conflict')
  return renamed
}
