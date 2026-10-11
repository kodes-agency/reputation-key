// Goal Program use cases — changing the subjects of a Program.
//
// One command: it adds and removes subjects and writes a new version that
// starts at the next full local month. The service composes it
// (goal-programs.ts) and re-exports its result type.
import {
  firstFullMonthlyPeriodAtOrAfter,
  goalSubjectIdentity,
  MAX_GOAL_ASSIGNMENT_SELECTIONS,
  type GoalSubject,
} from '../../domain/goal-program'
import type { GoalProgramVersion } from '../ports/goal-program.repository'
import {
  classifySelections,
  resolveAssignmentOutcomes,
  type GoalAssignmentChangeOutcome,
} from '../goal-assignment-selection'
import {
  assignmentFor,
  GoalProgramError,
  loadChangeableProgram,
  type GoalActor,
  type GoalProgramDependencies,
} from './goal-program-shared'

export type GoalAssignmentChangeResult = Readonly<{
  programId: string
  previousVersion: number
  currentVersion: number
  effectiveFrom: Date | null
  selectedAt: Date
  selectedCurrentPortalCount: number
  outcomes: readonly GoalAssignmentChangeOutcome[]
}>

export async function changeAssignments(
  deps: GoalProgramDependencies,
  input: Readonly<{
    propertyId: string
    programId: string
    expectedVersion: number
    add: readonly GoalSubject[]
    remove: readonly GoalSubject[]
    selectAllCurrentPortals: boolean
    reason: string
  }>,
  actor: GoalActor,
): Promise<GoalAssignmentChangeResult> {
  await deps.policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    action: 'goal.update',
  })
  if (input.add.length + input.remove.length > MAX_GOAL_ASSIGNMENT_SELECTIONS) {
    throw new GoalProgramError('assignment_limit_exceeded')
  }
  if (
    input.add.length === 0 &&
    input.remove.length === 0 &&
    !input.selectAllCurrentPortals
  ) {
    throw new GoalProgramError('invalid_subject')
  }
  const reason = input.reason.trim()
  if (!reason || reason.length > 500) throw new GoalProgramError('invalid_reason')

  const current = await loadChangeableProgram(deps, actor, input)
  if (current.version.version !== input.expectedVersion) {
    throw new GoalProgramError('revision_conflict')
  }

  const selectedAt = deps.now()
  if (current.version.effectiveFrom > selectedAt) {
    throw new GoalProgramError('revision_conflict')
  }
  const currentPortalIds = input.selectAllCurrentPortals
    ? await deps.subjects.listCurrentPortalIds(
        actor.organizationId,
        input.propertyId,
        MAX_GOAL_ASSIGNMENT_SELECTIONS + 1,
      )
    : []
  if (
    currentPortalIds.length > MAX_GOAL_ASSIGNMENT_SELECTIONS ||
    input.add.length + input.remove.length + currentPortalIds.length >
      MAX_GOAL_ASSIGNMENT_SELECTIONS
  ) {
    throw new GoalProgramError('assignment_limit_exceeded')
  }

  const preliminary = classifySelections({
    add: input.add,
    remove: input.remove,
    currentPortalIds,
  })
  const ownership = await Promise.all(
    preliminary.map((selection) =>
      selection.outcome
        ? Promise.resolve(true)
        : deps.subjects.subjectBelongsToProperty(
            actor.organizationId,
            input.propertyId,
            selection.subject,
          ),
    ),
  )
  const currentAssignments = current.assignments.filter(
    (assignment) => assignment.programVersionId === current.version.id,
  )
  if (currentAssignments.length === 0) {
    throw new GoalProgramError('invalid_subject')
  }
  const currentByIdentity = new Map(
    currentAssignments.map((assignment) => [
      goalSubjectIdentity(assignment.subject),
      assignment.subject,
    ]),
  )
  const effectiveFrom = firstFullMonthlyPeriodAtOrAfter(
    new Date(selectedAt.getTime() + 1),
    current.version.propertyTimezone,
  ).start
  const additionsToCheck = preliminary.flatMap((selection, index) => {
    if (
      selection.outcome ||
      !ownership[index] ||
      selection.operation !== 'add' ||
      currentByIdentity.has(selection.identity)
    ) {
      return []
    }
    return [selection.subject]
  })
  const conflictingSubjects =
    additionsToCheck.length === 0
      ? []
      : await deps.repository.findAssignmentConflicts({
          organizationId: actor.organizationId,
          propertyId: input.propertyId,
          excludeProgramId: current.program.id,
          metric: current.version.metric,
          effectiveFrom,
          subjects: additionsToCheck,
        })
  const overlapping = new Set(
    conflictingSubjects.map((conflict) => goalSubjectIdentity(conflict.subject)),
  )
  const { outcomes, nextByIdentity, changed } = resolveAssignmentOutcomes({
    selections: preliminary,
    ownership,
    currentByIdentity,
    overlapping,
  })
  if (nextByIdentity.size > MAX_GOAL_ASSIGNMENT_SELECTIONS) {
    throw new GoalProgramError('assignment_limit_exceeded')
  }
  if (!changed) {
    return {
      programId: current.program.id,
      previousVersion: current.version.version,
      currentVersion: current.version.version,
      effectiveFrom: null,
      selectedAt,
      selectedCurrentPortalCount: currentPortalIds.length,
      outcomes,
    }
  }

  const versionId = deps.id()
  const version: GoalProgramVersion = {
    ...current.version,
    id: versionId,
    version: current.version.version + 1,
    effectiveFrom,
    effectiveTo: null,
    changeReason: reason,
    createdBy: actor.userId,
    createdAt: selectedAt,
  }
  const assignments = [...nextByIdentity.values()].map((subject) =>
    assignmentFor({
      id: deps.id(),
      programId: current.program.id,
      programVersionId: versionId,
      organizationId: actor.organizationId,
      propertyId: input.propertyId,
      metric: current.version.metric,
      subject,
      effectiveFrom,
      effectiveTo: null,
      actorId: actor.userId,
      at: selectedAt,
    }),
  )
  const revised = await deps.repository.revise({
    expectedVersion: current.version,
    version,
    assignments,
    actorId: actor.userId,
    at: selectedAt,
  })
  if (!revised) throw new GoalProgramError('revision_conflict')
  return {
    programId: current.program.id,
    previousVersion: current.version.version,
    currentVersion: version.version,
    effectiveFrom,
    selectedAt,
    selectedCurrentPortalCount: currentPortalIds.length,
    outcomes,
  }
}
