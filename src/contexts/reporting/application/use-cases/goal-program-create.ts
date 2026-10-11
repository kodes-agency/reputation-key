// Goal Program use cases — creating a Program.
//
// `createGoal` is the request command: it authorises, resolves the month the
// goal starts in on the Property's calendar, and hands over to
// `createGoalCore`. The core validates the definition, checks that no subject
// already holds the metric, and writes the Program. It takes the start period
// from its caller, so a save of several goals resolves the month once for all
// of them. The service composes `createGoal` (goal-programs.ts).
import type { GovernedMetricVersion } from '../../domain/metric-registry'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import {
  isCompleteMonthlyPeriod,
  type GoalMetric,
  type GoalProgramStatus,
  type GoalSubject,
} from '../../domain/goal-program'
import { resolveGoalStart, type GoalMonthlyPeriod } from '../../domain/goal-start'
import {
  assignmentFor,
  GoalProgramError,
  isMetricSourceInactive,
  openResultFor,
  resolveGoalDefinition,
  type GoalActor,
  type GoalProgramDependencies,
} from './goal-program-shared'

export type CreateGoalDefinition = Readonly<{
  propertyId: string
  name: string
  description?: string | null
  metric: GoalMetric
  targetValue: number
  subjects: readonly GoalSubject[]
}>

export type CreateGoalInput = CreateGoalDefinition &
  Readonly<{
    /**
     * `YYYY-MM` on the Property's calendar: the current local month or the
     * next one. Omitted keeps the first full month that has not begun.
     */
    startMonth?: string
  }>

/** What the core has resolved about a new Program before it builds its rows. */
type NewProgramFacts = Readonly<{
  now: Date
  period: GoalMonthlyPeriod
  timezone: string
  governed: GovernedMetricVersion
  targetValue: number
  sourceInactive: boolean
}>

/**
 * The rows of a new Program: the Program, its first version, one assignment
 * per subject and, when it starts active, the first month of each. Active
 * means the month has begun and the metric's source is active; a month that
 * has not begun keeps the goal scheduled. That includes "this month" during a
 * repeated midnight hour, whose first instant is still ahead.
 */
function newProgramBundle(
  nextId: () => string,
  input: CreateGoalDefinition,
  actor: GoalActor,
  facts: NewProgramFacts,
): GoalProgramBundle {
  const { now, period, timezone, governed, sourceInactive } = facts
  const programId = nextId()
  const versionId = nextId()
  const status: GoalProgramStatus =
    sourceInactive || period.start > now ? 'scheduled' : 'active'
  const program = {
    id: programId,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    status,
    statusReason: sourceInactive
      ? 'metric_source_not_active'
      : status === 'scheduled'
        ? 'awaiting_first_full_month'
        : null,
    currentVersion: 1,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  } as const
  const version: GoalProgramVersion = {
    id: versionId,
    programId,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    version: 1,
    metricDefinitionId: governed.definition.id,
    metricDefinitionVersionId: governed.version.id,
    metric: input.metric,
    metricMinimumSample: governed.version.minimumSample,
    targetValue: facts.targetValue,
    propertyTimezone: timezone,
    effectiveFrom: period.start,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: actor.userId,
    createdAt: now,
  }
  const assignments = input.subjects.map((subject) =>
    assignmentFor({
      id: nextId(),
      programId,
      programVersionId: versionId,
      organizationId: actor.organizationId,
      propertyId: input.propertyId,
      metric: input.metric,
      subject,
      effectiveFrom: period.start,
      effectiveTo: null,
      actorId: actor.userId,
      at: now,
    }),
  )
  const results =
    status === 'active'
      ? assignments.map((assignment) =>
          openResultFor(assignment, period, timezone, nextId(), now),
        )
      : []
  return { program, version, versions: [version], assignments, results }
}

/**
 * Write one Program that starts at `start.period`, which its caller resolved
 * as of `start.now`. Refuses a subject that already holds the metric from the
 * period's first instant (`subject_has_goal`), and a period that is not a
 * complete month in the Property's time zone (`start_month_changed`): the
 * month was resolved under a time zone the Property no longer has.
 */
export async function createGoalCore(
  deps: GoalProgramDependencies,
  input: CreateGoalDefinition,
  actor: GoalActor,
  start: Readonly<{ now: Date; period: GoalMonthlyPeriod }>,
): Promise<GoalProgramBundle> {
  if (!input.name.trim()) throw new GoalProgramError('invalid_name')
  const { target, timezone, governed, readinessSubject } = await resolveGoalDefinition(
    deps,
    actor.organizationId,
    input,
  )
  const { now, period } = start
  if (!isCompleteMonthlyPeriod(period, timezone)) {
    throw new GoalProgramError('start_month_changed')
  }

  const conflicts = await deps.repository.findAssignmentConflicts({
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    metric: input.metric,
    effectiveFrom: period.start,
    subjects: input.subjects,
  })
  if (conflicts.length > 0) throw new GoalProgramError('subject_has_goal')

  const sourceInactive = await isMetricSourceInactive(deps, {
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    governed,
    subject: readinessSubject,
    period,
  })
  const bundle = newProgramBundle(deps.id, input, actor, {
    now,
    period,
    timezone,
    governed,
    targetValue: target.normalizedTarget,
    sourceInactive,
  })
  const outcome = await deps.repository.create({
    bundle,
    auditAction: 'goal.program.created',
  })
  if (outcome === 'subject_has_goal') throw new GoalProgramError('subject_has_goal')
  return bundle
}

/**
 * Create a Program from a request. The start month is read against the
 * Property's own calendar at the moment of the command: a key that is no
 * longer the current or the next local month is refused, never moved.
 */
export async function createGoal(
  deps: GoalProgramDependencies,
  input: CreateGoalInput,
  actor: GoalActor,
): Promise<GoalProgramBundle> {
  await deps.policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    action: 'goal.create',
  })
  const timezone = await deps.subjects.getTimezone(actor.organizationId, input.propertyId)
  if (!timezone) throw new GoalProgramError('not_found')
  const now = deps.now()
  const start = resolveGoalStart(now, timezone, input.startMonth)
  if (!start.ok) throw new GoalProgramError('start_month_changed')
  return createGoalCore(deps, input, actor, { now, period: start.period })
}
