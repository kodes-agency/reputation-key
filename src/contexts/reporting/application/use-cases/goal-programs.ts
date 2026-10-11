// Goal Program use cases — read, revise and change the status of a Program,
// composed with the create, assignment-change and maintenance commands.
import type {
  GoalProgramBundle,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import {
  canTransitionGoalProgram,
  firstFullMonthlyPeriodAtOrAfter,
  type GoalMetric,
  type GoalProgramStatus,
  type GoalSubject,
} from '../../domain/goal-program'
import {
  changeAssignments,
  type GoalAssignmentChangeResult,
} from './goal-program-assignment-changes'
import { createGoal } from './goal-program-create'
import {
  GoalProgramMaintenanceError,
  maintain,
  reconcileClosedResult,
  reconcileResult,
  type GoalProgramMaintenanceStats,
} from './goal-program-maintenance'
import {
  assignmentFor,
  earliestRevisionStart,
  GoalProgramError,
  isMetricSourceInactive,
  loadChangeableProgram,
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

    revise: async (
      input: Readonly<{
        propertyId: string
        programId: string
        metric: GoalMetric
        targetValue: number
        subjects: readonly GoalSubject[]
        reason: string
      }>,
      actor: GoalActor,
    ): Promise<GoalProgramBundle> => {
      await deps.policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.update',
      })
      const current = await loadChangeableProgram(deps, actor, input)
      const now = deps.now()
      // A future Program head is already the one pending revision that the
      // maintenance runtime will activate. Stacking another future head would
      // either create a zero-length version or skip the pending version.
      if (current.version.effectiveFrom > now) {
        throw new GoalProgramError('revision_conflict')
      }
      const { target, timezone, governed, readinessSubject } =
        await resolveGoalDefinition(deps, actor.organizationId, input)
      // When the Property's timezone moved east, the next local month begins
      // before the open month ends, so the revision starts one local month
      // later and the skipped local month is not evaluated under either
      // version. The caller shows the returned start date.
      const period = firstFullMonthlyPeriodAtOrAfter(
        earliestRevisionStart(current.results, now),
        timezone,
      )
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
        changeReason: input.reason.trim() || 'revised',
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
      const revised = await deps.repository.revise({
        expectedVersion: current.version,
        version,
        assignments,
        actorId: actor.userId,
        at: now,
      })
      if (!revised) throw new GoalProgramError('revision_conflict')
      return {
        program: { ...current.program, currentVersion: version.version, updatedAt: now },
        version,
        versions: [...current.versions, version],
        assignments: [...current.assignments, ...assignments],
        results: current.results,
      }
    },

    changeAssignments: (
      input: Parameters<typeof changeAssignments>[1],
      actor: GoalActor,
    ) => changeAssignments(deps, input, actor),

    changeStatus: async (
      input: Readonly<{
        propertyId: string
        programId: string
        status: GoalProgramStatus
        reason: string
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
        reason: input.reason.trim() || 'status_changed',
        actorId: actor.userId,
        at: deps.now(),
      })
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
  get: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['get']>
  ) => ReturnType<GoalProgramService['get']>
  list: (
    policy: GoalExecutionPolicy,
    ...args: Parameters<GoalProgramService['list']>
  ) => ReturnType<GoalProgramService['list']>
}>
