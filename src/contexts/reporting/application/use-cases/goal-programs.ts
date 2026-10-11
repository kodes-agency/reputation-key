// Goal Program use cases — read, revise and change the status of a Program,
// composed with the create, rename, assignment-change, month-target and
// maintenance commands.
import type {
  GoalProgramBundle,
  GoalProgramVersion,
  GoalScheduledStatusReason,
  GoalSubjectAssignment,
} from '../ports/goal-program.repository'
import {
  canTransitionGoalProgram,
  type GoalMetric,
  type GoalProgramStatus,
  type GoalSubject,
} from '../../domain/goal-program'
import { nextRevisionStart } from '../goal-revision-start'
import {
  changeAssignments,
  type GoalAssignmentChangeResult,
} from './goal-program-assignment-changes'
import { changeMonthTarget } from './goal-month-target'
import { createGoal } from './goal-program-create'
import { renameGoal } from './goal-program-details'
import {
  GoalProgramMaintenanceError,
  loadCaughtUpProgram,
  maintain,
  reconcileClosedResult,
  reconcileResult,
  type GoalProgramMaintenanceStats,
} from './goal-program-maintenance'
import {
  assertSubjectsAreFree,
  assignmentFor,
  GoalProgramError,
  isMetricSourceInactive,
  noteOf,
  resolveGoalDefinition,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalMetricReadPort,
  type GoalProgramDependencies,
  type GoalProgramSubjectReader,
} from './goal-program-shared'

// The command families live in flat sibling modules and the shared pieces in a
// leaf; this module composes them behind the one service and keeps re-exporting
// every name its importers already use.
export { MAX_GOAL_ASSIGNMENT_SELECTIONS } from '../../domain/goal-program'
export { GoalProgramError, GoalProgramMaintenanceError }
export type {
  GoalActor,
  GoalAssignmentChangeResult,
  GoalExecutionPolicy,
  GoalMetricReadPort,
  GoalProgramDependencies,
  GoalProgramMaintenanceStats,
  GoalProgramSubjectReader,
}

type ReviseGoalInput = Readonly<{
  propertyId: string
  programId: string
  metric: GoalMetric
  targetValue: number
  subjects: readonly GoalSubject[]
  /** The manager's optional note. Without one the version records `revised`. */
  reason?: string
  /**
   * The version the form was opened on. A form that sends it is refused once
   * the head has moved, instead of changing a goal it never showed.
   */
  expectedVersion?: number
}>

/**
 * The bundle as a revision leaves it. The head it follows closes where the new
 * version starts; a head it replaces keeps the empty window [from, from). A
 * goal that has not started takes the reason its new plan waits for.
 */
function revisedBundle(
  current: GoalProgramBundle,
  version: GoalProgramVersion,
  assignments: readonly GoalSubjectAssignment[],
  change: Readonly<{
    supersedeRowlessHead: boolean
    scheduledStatusReason: GoalScheduledStatusReason | undefined
  }>,
): GoalProgramBundle {
  const closedAt = (window: Readonly<{ effectiveFrom: Date }>) =>
    change.supersedeRowlessHead ? window.effectiveFrom : version.effectiveFrom
  return {
    program: {
      ...current.program,
      currentVersion: version.version,
      statusReason: change.scheduledStatusReason ?? current.program.statusReason,
      updatedAt: version.createdAt,
    },
    version,
    versions: [
      ...current.versions.map((known) =>
        known.id === current.version.id
          ? { ...known, effectiveTo: closedAt(known) }
          : known,
      ),
      version,
    ],
    assignments: [
      ...current.assignments.map((known) =>
        known.programVersionId === current.version.id && known.effectiveTo === null
          ? { ...known, effectiveTo: closedAt(known) }
          : known,
      ),
      ...assignments,
    ],
    results: current.results,
    // A revision changes no month's own target: the log stays as it was read.
    ...(current.targetChanges ? { targetChanges: current.targetChanges } : {}),
  }
}

/**
 * Change a Program's measure, target and subjects from a coming month. A
 * month already open keeps the version it opened under.
 */
async function reviseGoal(
  deps: GoalProgramDependencies,
  input: ReviseGoalInput,
  actor: GoalActor,
): Promise<GoalProgramBundle> {
  await deps.policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    action: 'goal.update',
  })
  const now = deps.now()
  const current = await loadCaughtUpProgram(deps, actor, input, now)
  if (
    input.expectedVersion !== undefined &&
    current.version.version !== input.expectedVersion
  ) {
    throw new GoalProgramError('revision_conflict')
  }
  const { target, timezone, governed, readinessSubject } = await resolveGoalDefinition(
    deps,
    actor.organizationId,
    input,
  )
  // A head with no month yet (a goal that has not started, or an earlier
  // change still waiting for its month) is replaced rather than followed.
  // When the Property's timezone moved east, the next local month begins
  // before the open month ends, so the revision starts one local month
  // later and the skipped local month is not evaluated under either
  // version. The caller shows the returned start date.
  const { head, period } = nextRevisionStart(current, now, timezone)
  await assertSubjectsAreFree(deps, {
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    excludeProgramId: current.program.id,
    metric: input.metric,
    effectiveFrom: period.start,
    subjects: input.subjects,
  })
  const sourceInactive = await isMetricSourceInactive(deps, {
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    governed,
    subject: readinessSubject,
    period,
  })
  if (sourceInactive && current.program.status !== 'scheduled') {
    throw new GoalProgramError('metric_unavailable')
  }

  const versionId = deps.id()
  const version: GoalProgramVersion = {
    id: versionId,
    programId: current.program.id,
    organizationId: current.program.organizationId,
    propertyId: current.program.propertyId,
    version: current.version.version + 1,
    metricDefinitionId: governed.definition.id,
    metricDefinitionVersionId: governed.version.id,
    metric: input.metric,
    metricMinimumSample: governed.version.minimumSample,
    targetValue: target.normalizedTarget,
    propertyTimezone: timezone,
    effectiveFrom: period.start,
    effectiveTo: null,
    changeReason: noteOf(input.reason) ?? 'revised',
    createdBy: actor.userId,
    createdAt: now,
  }
  const assignments = input.subjects.map((subject) =>
    assignmentFor({
      id: deps.id(),
      programId: current.program.id,
      programVersionId: versionId,
      organizationId: current.program.organizationId,
      propertyId: current.program.propertyId,
      metric: input.metric,
      subject,
      effectiveFrom: period.start,
      effectiveTo: null,
      actorId: actor.userId,
      at: now,
    }),
  )
  const change = {
    supersedeRowlessHead: head !== 'in_force',
    // What a goal that has not started waits for was decided from the plan it
    // was created with. This plan may have another measure, so it is decided
    // again, by the rule creation uses: the source first, else the month.
    scheduledStatusReason:
      head !== 'never_started'
        ? undefined
        : sourceInactive
          ? ('metric_source_not_active' as const)
          : ('awaiting_first_full_month' as const),
  }
  const revised = await deps.repository.revise({
    expectedVersion: current.version,
    version,
    assignments,
    ...change,
    actorId: actor.userId,
    at: now,
  })
  // The head moved, or a month opened under it, since this command read it.
  if (!revised) throw new GoalProgramError('revision_conflict')
  return revisedBundle(current, version, assignments, change)
}

export function createGoalProgramService(deps: GoalProgramDependencies) {
  return {
    create: (input: Parameters<typeof createGoal>[1], actor: GoalActor) =>
      createGoal(deps, input, actor),

    get: async (
      input: Readonly<{ propertyId: string; programId: string }>,
      actor: GoalActor,
    ) => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.read',
      })
      const bundle = await deps.repository.get(
        actor.organizationId,
        input.propertyId,
        input.programId,
      )
      if (!bundle) throw new GoalProgramError('not_found')
      return bundle
    },

    list: async (propertyId: string, actor: GoalActor) => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId,
        action: 'goal.read',
      })
      return deps.repository.list(actor.organizationId, propertyId)
    },

    revise: (input: ReviseGoalInput, actor: GoalActor) => reviseGoal(deps, input, actor),

    rename: (input: Parameters<typeof renameGoal>[1], actor: GoalActor) =>
      renameGoal(deps, input, actor),

    changeAssignments: (
      input: Parameters<typeof changeAssignments>[1],
      actor: GoalActor,
    ) => changeAssignments(deps, input, actor),

    changeMonthTarget: (
      input: Parameters<typeof changeMonthTarget>[1],
      actor: GoalActor,
    ) => changeMonthTarget(deps, input, actor),

    changeStatus: async (
      input: Readonly<{
        propertyId: string
        programId: string
        status: GoalProgramStatus
        /** The manager's optional note. Without one no status reason is stored. */
        reason?: string
      }>,
      actor: GoalActor,
    ) => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: input.status === 'ended' ? 'goal.cancel' : 'goal.update',
      })
      const current = await deps.repository.get(
        actor.organizationId,
        input.propertyId,
        input.programId,
      )
      if (!current) throw new GoalProgramError('not_found')
      if (!canTransitionGoalProgram(current.program.status, input.status)) {
        throw new GoalProgramError('invalid_transition')
      }
      if (
        current.program.status === 'scheduled' &&
        input.status === 'active' &&
        (deps.now() < current.version.effectiveFrom || current.results.length === 0)
      ) {
        throw new GoalProgramError('metric_unavailable')
      }
      const updated = await deps.repository.changeStatus({
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        programId: input.programId,
        expectedStatus: current.program.status,
        status: input.status,
        reason: noteOf(input.reason),
        actorId: actor.userId,
        at: deps.now(),
      })
      // The status moved, or the version history did, since this command read it.
      if (!updated) throw new GoalProgramError('revision_conflict')
      return updated
    },

    reconcileResult: (input: Parameters<typeof reconcileResult>[1]) =>
      reconcileResult(deps, input),

    reconcileClosedResult: (input: Parameters<typeof reconcileClosedResult>[1]) =>
      reconcileClosedResult(deps, input),

    maintain: () => maintain(deps),
  }
}

export type GoalProgramService = ReturnType<typeof createGoalProgramService>

/** Request-facing Goal Program commands. Each invocation receives its scoped policy. */
export type GoalProgramRequestApi = Readonly<{
  create: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['create']>
  ) => ReturnType<GoalProgramService['create']>
  revise: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['revise']>
  ) => ReturnType<GoalProgramService['revise']>
  changeAssignments: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['changeAssignments']>
  ) => ReturnType<GoalProgramService['changeAssignments']>
  changeStatus: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['changeStatus']>
  ) => ReturnType<GoalProgramService['changeStatus']>
  rename: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['rename']>
  ) => ReturnType<GoalProgramService['rename']>
  changeMonthTarget: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['changeMonthTarget']>
  ) => ReturnType<GoalProgramService['changeMonthTarget']>
  get: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['get']>
  ) => ReturnType<GoalProgramService['get']>
  list: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['list']>
  ) => ReturnType<GoalProgramService['list']>
}>
