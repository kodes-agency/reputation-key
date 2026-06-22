// Goal context — create-goal use case
// Validates input, builds domain object, persists, computes initial progress.
// Per architecture: "Dependencies are passed as function arguments."
import { assertNever } from '#/shared/domain/assert'

import type { GoalRepository } from '../ports/goal.repository'
import type {
  MetricReadingsQuery,
  MetricReadingsAggregate,
  MetricPublicApi,
} from '../../../metric/application/public-api'
import type {
  Goal,
  GoalProgress,
  GoalType,
  RecurrenceRule,
  ComputedSource,
} from '../../domain/types'
import type {
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
  UserId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'
import type { Role } from '#/shared/domain/roles'
import { buildGoal } from '../../domain/constructors'
import type { GoalError } from '../../domain/errors'
import {
  buildProgressQuery,
  buildProgressQueryForInstance,
  type ProgressQuery,
} from '../../domain/progress-strategy'
import { can } from '#/shared/domain/permissions'
import { ok, err, type Result } from 'neverthrow'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import {
  goalId as toGoalId,
  goalProgressId as toGoalProgressId,
} from '#/shared/domain/ids'

// ── Input type ──────────────────────────────────────────────────────────

type CreateGoalInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  portalGroupId: PortalGroupId | null
  name: string
  description: string | null
  createdBy: UserId
  goalType: GoalType
  aggregationFunction: AggregationFunction
  metricKey: MetricKey
  targetValue: number
  periodStart?: Date | null
  periodEnd?: Date | null
  recurrenceRule?: RecurrenceRule | null
  rollingWindowDays?: number | null
  role: Role
}>

// ── Error types ─────────────────────────────────────────────────────────

export type CreateGoalError =
  | { tag: 'forbidden' }
  | { tag: 'construction_error'; error: GoalError }
  | { tag: 'instance_construction_error'; error: GoalError }
  | { tag: 'progress_query_error'; errorTag: string }

// ── Output type ─────────────────────────────────────────────────────────

export type CreateGoalOutput = Readonly<{
  goal: Goal
  /** Non-null for one-shot/open/rolling goals. Null for recurring templates
   *  — the template itself has no progress; instances carry their own. */
  progress: GoalProgress | null
}>

// ── Deps ────────────────────────────────────────────────────────────────

export type CreateGoalDeps = Readonly<{
  goalRepo: GoalRepository
  metricRepo: MetricPublicApi
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

// ── Use case ────────────────────────────────────────────────────────────

export const createGoal =
  (deps: CreateGoalDeps) =>
  async (input: CreateGoalInput): Promise<Result<CreateGoalOutput, CreateGoalError>> => {
    if (!can(input.role, 'goal.create')) {
      return err({ tag: 'forbidden' })
    }

    // D6-001: PropertyManager/Staff must be assigned to the target property.
    // Runs before buildGoal and the recurring branch so no work is done when forbidden.
    const accessible = await isPropertyAccessible(
      (orgId, uId, role) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, role),
      input.organizationId,
      input.createdBy,
      input.role,
      input.propertyId,
    )
    if (!accessible) {
      return err({ tag: 'forbidden' })
    }

    const now = deps.clock()
    const goalId = toGoalId(deps.idGen())

    // 1. Build the goal via domain constructor
    const buildResult = buildGoal({
      id: goalId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      portalGroupId: input.portalGroupId,
      name: input.name,
      description: input.description,
      createdBy: input.createdBy,
      goalType: input.goalType,
      aggregationFunction: input.aggregationFunction,
      metricKey: input.metricKey,
      targetValue: input.targetValue,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      recurrenceRule: input.recurrenceRule,
      rollingWindowDays: input.rollingWindowDays,
      now,
    })

    if (buildResult.isErr()) {
      return err({ tag: 'construction_error', error: buildResult.error })
    }

    const goal = buildResult.value

    // 2. Persist the goal + initial progress atomically
    if (goal.goalType === 'recurring') {
      return handleRecurringGoal(deps, goal, now)
    }

    // 3. Compute initial progress
    const metricQueryResult = buildMetricQuery(goal)
    if (metricQueryResult.isErr()) {
      return err(metricQueryResult.error)
    }
    const progressQuery = metricQueryResult.value
    const aggregate = await deps.metricRepo.queryAggregate(progressQuery)
    const progressValue = computeValue(goal.aggregationFunction, aggregate)

    const progress: GoalProgress = {
      id: toGoalProgressId(deps.idGen()),
      goalId: goal.id,
      organizationId: goal.organizationId,
      currentValue: progressValue,
      currentSum: goal.aggregationFunction === 'avg' ? aggregate.sum : null,
      currentCount: goal.aggregationFunction === 'avg' ? aggregate.count : null,
      lastComputedAt: now,
      computedSource: 'reconciliation' as ComputedSource,
    }

    await deps.goalRepo.createGoalAndProgress(goal, progress)

    return ok({ goal, progress })
  }

// ── Recurring helper ────────────────────────────────────────────────────

async function handleRecurringGoal(
  deps: CreateGoalDeps,
  template: Goal,
  now: Date,
): Promise<Result<CreateGoalOutput, CreateGoalError>> {
  // Build the first instance before any DB writes so we can persist
  // template + instance + progress atomically in one transaction.
  const rule = template.recurrenceRule!
  const period = computeCalendarPeriod(now, rule.frequency)
  const instanceId = toGoalId(deps.idGen())

  // Build the instance as a child of the template
  const instanceResult = buildGoal({
    id: instanceId,
    organizationId: template.organizationId,
    propertyId: template.propertyId,
    portalId: template.portalId,
    portalGroupId: template.portalGroupId,
    name: template.name,
    description: template.description,
    createdBy: template.createdBy,
    goalType: 'recurring',
    aggregationFunction: template.aggregationFunction,
    metricKey: template.metricKey,
    targetValue: template.targetValue,
    periodStart: period.start,
    periodEnd: period.end,
    recurrenceRule: template.recurrenceRule,
    parentGoalId: template.id,
    now,
  })

  if (instanceResult.isErr()) {
    return err({
      tag: 'instance_construction_error',
      error: instanceResult.error,
    })
  }

  const instance = instanceResult.value

  // Compute the instance's initial progress before the transactional insert
  const progressQueryResult = buildProgressQueryForInstance(
    template,
    period.start,
    period.end,
  )
  if (progressQueryResult.isErr()) {
    return err({ tag: 'progress_query_error', errorTag: progressQueryResult.error.tag })
  }
  const progressQuery = progressQueryResult.value
  const metricQuery = progressQueryToMetricReadingsQuery(progressQuery, template)
  const aggregate = await deps.metricRepo.queryAggregate(metricQuery)
  const progressValue = computeValue(template.aggregationFunction, aggregate)

  const progress: GoalProgress = {
    id: toGoalProgressId(deps.idGen()),
    goalId: instance.id,
    organizationId: instance.organizationId,
    currentValue: progressValue,
    currentSum: template.aggregationFunction === 'avg' ? aggregate.sum : null,
    currentCount: template.aggregationFunction === 'avg' ? aggregate.count : null,
    lastComputedAt: now,
    computedSource: 'reconciliation' as ComputedSource,
  }

  // Persist template + instance + progress in a single transaction (GOAL-02)
  await deps.goalRepo.createRecurringGoalWithInstance(template, instance, progress)

  // The template has no direct progress — only instances do (GOAL-09)
  return ok({ goal: template, progress: null })
}

// ── Calendar period computation ─────────────────────────────────────────

function computeCalendarPeriod(
  now: Date,
  frequency: 'weekly' | 'monthly' | 'quarterly',
): Readonly<{ start: Date; end: Date }> {
  switch (frequency) {
    case 'monthly': {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
      )
      const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      )
      return { start, end }
    }
    case 'weekly': {
      // ISO 8601: Monday to Sunday
      const day = now.getUTCDay() // 0 = Sunday, 1 = Monday, ...
      const mondayOffset = day === 0 ? -6 : 1 - day
      const monday = new Date(now)
      monday.setUTCDate(now.getUTCDate() + mondayOffset)
      monday.setUTCHours(0, 0, 0, 0)

      const sunday = new Date(monday)
      sunday.setUTCDate(monday.getUTCDate() + 6)
      sunday.setUTCHours(23, 59, 59, 999)

      return { start: monday, end: sunday }
    }
    case 'quarterly': {
      const month = now.getUTCMonth()
      const quarterStartMonth = Math.floor(month / 3) * 3
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1, 0, 0, 0, 0),
      )
      const end = new Date(
        Date.UTC(now.getUTCFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999),
      )
      return { start, end }
    }
  }
}

// ── Progress query helpers ──────────────────────────────────────────────

function buildMetricQuery(goal: Goal): Result<MetricReadingsQuery, CreateGoalError> {
  const pqResult = buildProgressQuery(goal)
  if (pqResult.isErr()) {
    return err({ tag: 'progress_query_error', errorTag: pqResult.error.tag })
  }
  const pq = pqResult.value
  return ok(progressQueryToMetricReadingsQuery(pq, goal))
}

function progressQueryToMetricReadingsQuery(
  pq: ProgressQuery,
  goal: Goal,
): MetricReadingsQuery {
  const base: MetricReadingsQuery = {
    organizationId: goal.organizationId,
    propertyId: pq.scopeFilter.propertyId,
    portalId: pq.scopeFilter.portalId,
    groupId: pq.scopeFilter.portalGroupId,
    metricKey: pq.metricKey,
  }

  switch (pq.timeFilter.tag) {
    case 'bounded':
      return {
        ...base,
        periodStart: pq.timeFilter.start,
        periodEnd: pq.timeFilter.end,
      }
    case 'sliding_window':
      return {
        ...base,
        rollingWindowDays: pq.timeFilter.days,
      }
    case 'none':
      return base
  }
}

function computeValue(
  agg: AggregationFunction,
  aggregate: MetricReadingsAggregate,
): number {
  switch (agg) {
    case 'sum':
      return aggregate.sum
    case 'count':
      return aggregate.count
    case 'max':
      return aggregate.max
    case 'avg':
      return aggregate.count > 0 ? aggregate.sum / aggregate.count : 0
    default:
      assertNever('aggregation', agg)
  }
}
