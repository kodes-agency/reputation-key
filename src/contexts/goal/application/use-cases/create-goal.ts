// Goal context — create-goal use case
// Validates input, builds domain object, persists, computes initial progress.
// Per architecture: "Dependencies are passed as function arguments."

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
  TeamId,
  StaffId,
  GoalId,
  UserId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'
import type { Role } from '#/shared/domain/roles'
import { buildGoal, type GoalConstructionError } from '../../domain/constructors'
import {
  buildProgressQuery,
  buildProgressQueryForInstance,
  type ProgressQuery,
} from '../../domain/progress-strategy'
import { can } from '#/shared/domain/permissions'
import { ok, err, type Result } from 'neverthrow'

// ── Input type ──────────────────────────────────────────────────────────

export type CreateGoalInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  teamId: TeamId | null
  staffId: StaffId | null
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
  | { tag: 'construction_error'; error: GoalConstructionError }
  | { tag: 'instance_construction_error'; error: GoalConstructionError }

// ── Output type ─────────────────────────────────────────────────────────

export type CreateGoalOutput = Readonly<{
  goal: Goal
  progress: GoalProgress
}>

// ── Deps ────────────────────────────────────────────────────────────────

export type CreateGoalDeps = Readonly<{
  goalRepo: GoalRepository
  metricRepo: MetricPublicApi
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

    const now = deps.clock()
    const goalId = deps.idGen() as GoalId

    // 1. Build the goal via domain constructor
    const buildResult = buildGoal({
      id: goalId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      teamId: input.teamId,
      staffId: input.staffId,
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

    // 2. Persist the goal
    const inserted = await deps.goalRepo.insert(goal)

    // 3. For recurring goals, also create the first instance
    if (goal.goalType === 'recurring') {
      return handleRecurringGoal(deps, inserted, now)
    }

    // 4. Compute initial progress
    const progressQuery = buildMetricQuery(goal)
    const aggregate = await deps.metricRepo.queryAggregate(progressQuery)
    const progressValue = computeValue(goal.aggregationFunction, aggregate)

    const progress = await deps.goalRepo.insertProgress({
      goalId: inserted.id,
      currentValue: progressValue,
      currentSum: goal.aggregationFunction === 'avg' ? aggregate.sum : null,
      currentCount: goal.aggregationFunction === 'avg' ? aggregate.count : null,
      lastComputedAt: now,
      computedSource: 'reconciliation' as ComputedSource,
    })

    return ok({ goal: inserted, progress })
  }

// ── Recurring helper ────────────────────────────────────────────────────

async function handleRecurringGoal(
  deps: CreateGoalDeps,
  template: Goal,
  now: Date,
): Promise<Result<CreateGoalOutput, CreateGoalError>> {
  const rule = template.recurrenceRule!
  const period = computeCalendarPeriod(now, rule.frequency)
  const instanceId = deps.idGen() as GoalId

  // Build the instance as a child of the template
  const instanceResult = buildGoal({
    id: instanceId,
    organizationId: template.organizationId,
    propertyId: template.propertyId,
    portalId: template.portalId,
    teamId: template.teamId,
    staffId: template.staffId,
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

  // Persist the instance
  const insertedInstance = await deps.goalRepo.insert(instance)

  // Compute progress for the instance
  const progressQueryResult = buildProgressQueryForInstance(
    template,
    period.start,
    period.end,
  )
  if (progressQueryResult.isErr()) {
    // Should not happen — we know this is a recurring template
    throw new Error(`Unexpected progress query error: ${progressQueryResult.error.tag}`)
  }
  const progressQuery = progressQueryResult.value
  const metricQuery = progressQueryToMetricReadingsQuery(progressQuery, template)
  const aggregate = await deps.metricRepo.queryAggregate(metricQuery)
  const progressValue = computeValue(template.aggregationFunction, aggregate)

  const progress = await deps.goalRepo.insertProgress({
    goalId: insertedInstance.id,
    currentValue: progressValue,
    currentSum: template.aggregationFunction === 'avg' ? aggregate.sum : null,
    currentCount: template.aggregationFunction === 'avg' ? aggregate.count : null,
    lastComputedAt: now,
    computedSource: 'reconciliation' as ComputedSource,
  })

  return ok({ goal: template, progress })
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

function buildMetricQuery(goal: Goal): MetricReadingsQuery {
  const pqResult = buildProgressQuery(goal)
  if (pqResult.isErr()) {
    // Should not happen — goals with valid types always resolve
    throw new Error(`Unexpected progress query error: ${pqResult.error.tag}`)
  }
  const pq = pqResult.value
  return progressQueryToMetricReadingsQuery(pq, goal)
}

function progressQueryToMetricReadingsQuery(
  pq: ProgressQuery,
  goal: Goal,
): MetricReadingsQuery {
  const base: MetricReadingsQuery = {
    organizationId: goal.organizationId,
    propertyId: pq.scopeFilter.propertyId,
    portalId: pq.scopeFilter.portalId,
    staffId: pq.scopeFilter.staffId,
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
  }
}
