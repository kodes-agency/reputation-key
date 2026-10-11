// Goal Program use cases — changing the target of a month that is still running.
//
// A month opens on its version's target and can take one of its own while it
// runs; once its period ends the target is locked. The change never touches a
// version: versions keep the target they were written with, so the months that
// closed under them keep theirs. When the manager also wants the new target for
// the months after, that is a new version from the next month, written in the
// same transaction as the month, the log of the change and the audit row. What
// happened to the months after is decided before anything is written and stored
// with the change. The service composes `changeMonthTarget` (goal-programs.ts).
import {
  firstFullMonthlyPeriodAtOrAfter,
  monthKeyOf,
  type GoalMonthlyPeriod,
} from '../../domain/goal-start'
import {
  validateGoalTarget,
  type GoalMetric,
  type GoalSubject,
} from '../../domain/goal-program'
import type { GovernedMetricVersion } from '../../domain/metric-registry'
import { effectiveMonthTarget } from '../goal-effective-month-target'
import { monthTargetPlan, type GoalMonthTargetPlan } from '../goal-month-target-plan'
import type {
  GoalMonthTargetFollowingOutcome,
  GoalMonthTargetFollowingReason,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import { loadCaughtUpProgram } from './goal-program-maintenance'
import {
  assignmentFor,
  GoalProgramError,
  isMetricSourceInactive,
  noteOf,
  resolveMetricVersion,
  type GoalActor,
  type GoalProgramDependencies,
} from './goal-program-shared'

export type ChangeMonthTargetInput = Readonly<{
  propertyId: string
  programId: string
  /**
   * The month whose target is to change, `YYYY-MM` on the calendar the month
   * was cut in (the plan's `monthKey`). A form left open over the end of that
   * month is refused; it never changes the month that began meanwhile.
   */
  month: string
  targetValue: number
  /** The target the form showed for the month. */
  expectedTarget: number
  /** The version the form was opened on. */
  expectedVersion: number
  /** Whether the months after are to take the new target too. */
  applyToFollowing: boolean
  /** The manager's optional note, stored with the change. */
  note?: string
}>

export type GoalMonthTargetChangeResult = Readonly<{
  /** `unchanged` when the month already had the target: a save sent twice. */
  month: Readonly<{ previous: number; next: number }> | 'unchanged'
  following: Readonly<{
    outcome: GoalMonthTargetFollowingOutcome
    /** Why the months after were not changed; with `not_applied` only. */
    reason?: GoalMonthTargetFollowingReason
    /** The first instant the months after carry the target; with the two applied outcomes. */
    startsAt?: Date
  }>
}>

type Following = GoalMonthTargetChangeResult['following']
type FollowingRevision = NonNullable<
  Parameters<GoalProgramRepository['changeMonthTarget']>[0]['following']['revision']
>

/**
 * What the months after need, read from the plan alone: nothing to write, or
 * a version built on `basis` (the version whose measure and subjects it keeps).
 */
type FollowingIntent =
  | Readonly<{ write: false; following: Following }>
  | Readonly<{
      write: true
      outcome: 'applied' | 'replaced_scheduled_change'
      basis: GoalProgramVersion
      supersedeRowlessHead: boolean
    }>

/**
 * The plan for the month the form named. `month_locked` when that month has
 * ended (the running month, if any, is a later one); `no_open_month` when it
 * has not opened: a goal that has not started, or a month its job has yet to open.
 */
function planForMonth(
  current: GoalProgramBundle,
  month: string,
  now: Date,
  timezone: string,
): GoalMonthTargetPlan {
  const plan = monthTargetPlan(current, now, timezone)
  if (plan?.monthKey === month) return plan
  // The cheap test first: only a month that is over is asked for its key.
  const ended = current.results.some(
    (result) =>
      (result.status !== 'open' || result.periodEnd <= now) &&
      monthKeyOf(result.periodStart, result.propertyTimezone) === month,
  )
  throw new GoalProgramError(ended ? 'month_locked' : 'no_open_month')
}

function followingIntent(
  plan: GoalMonthTargetPlan,
  target: number,
  applyToFollowing: boolean,
): FollowingIntent {
  if (!applyToFollowing) return { write: false, following: { outcome: 'not_requested' } }
  // A change waiting for its month with another measure keeps its own target:
  // a number for one measure says nothing about another.
  if (!plan.canApplyFollowing) {
    return { write: false, following: { outcome: 'kept_scheduled_change' } }
  }
  // The version that governs the months after: the change waiting for its
  // month, else the version in force, which simply goes on.
  const governing = plan.pendingHead ?? plan.inForceVersion
  if (governing.targetValue === target) {
    return {
      write: false,
      following: {
        outcome: 'applied',
        startsAt: plan.pendingHead?.effectiveFrom ?? plan.period.end,
      },
    }
  }
  return {
    write: true,
    outcome: plan.pendingHead ? 'replaced_scheduled_change' : 'applied',
    basis: governing,
    supersedeRowlessHead: plan.pendingHead !== null,
  }
}

type RevisionFacts = Readonly<{
  current: GoalProgramBundle
  plan: GoalMonthTargetPlan
  basis: GoalProgramVersion
  supersedeRowlessHead: boolean
  target: number
  timezone: string
  now: Date
}>

/**
 * The version that carries the target into the months after, or the reason it
 * cannot be written. It keeps the measure and every subject of `basis`: a
 * subject that is no longer part of the Property (an archived Portal) refuses
 * the version rather than being dropped from the goal without a word.
 */
async function followingRevision(
  deps: GoalProgramDependencies,
  actor: GoalActor,
  facts: RevisionFacts,
): Promise<
  | Readonly<{ revision: FollowingRevision }>
  | Readonly<{ reason: GoalMonthTargetFollowingReason }>
> {
  const { current, plan, basis, timezone, now } = facts
  const { organizationId, propertyId } = current.program
  const subjects: readonly GoalSubject[] = current.assignments
    .filter(
      (assignment) =>
        assignment.programVersionId === basis.id && assignment.effectiveTo === null,
    )
    .map((assignment) => assignment.subject)
  const [readinessSubject] = subjects
  const owned = await Promise.all(
    subjects.map((subject) =>
      deps.subjects.subjectBelongsToProperty(organizationId, propertyId, subject),
    ),
  )
  if (!readinessSubject || owned.some((belongs) => !belongs)) {
    return { reason: 'subject_unavailable' }
  }

  const period = firstFullMonthlyPeriodAtOrAfter(plan.followingStart, timezone)
  const governed = await usableMeasure(deps, {
    organizationId,
    propertyId,
    metric: basis.metric,
    subject: readinessSubject,
    period,
  })
  if (!governed) return { reason: 'metric_unavailable' }

  const versionId = deps.id()
  const version: GoalProgramVersion = {
    id: versionId,
    programId: current.program.id,
    organizationId,
    propertyId,
    version: current.version.version + 1,
    metricDefinitionId: governed.definition.id,
    metricDefinitionVersionId: governed.version.id,
    metric: basis.metric,
    metricMinimumSample: governed.version.minimumSample,
    targetValue: facts.target,
    propertyTimezone: timezone,
    effectiveFrom: period.start,
    effectiveTo: null,
    changeReason: 'target_changed',
    createdBy: actor.userId,
    createdAt: now,
  }
  const assignments = subjects.map((subject) =>
    assignmentFor({
      id: deps.id(),
      programId: current.program.id,
      programVersionId: versionId,
      organizationId,
      propertyId,
      metric: basis.metric,
      subject,
      effectiveFrom: period.start,
      effectiveTo: null,
      actorId: actor.userId,
      at: now,
    }),
  )
  return {
    revision: { version, assignments, supersedeRowlessHead: facts.supersedeRowlessHead },
  }
}

/**
 * The governed version a new version of the goal would be read under, or null
 * when the measure cannot carry one right now: it is no longer approved, or
 * its source is not active, cannot be read or is quarantined. Each of these
 * refuses a revision of a goal that has started, so each refuses this one.
 */
async function usableMeasure(
  deps: GoalProgramDependencies,
  query: Readonly<{
    organizationId: string
    propertyId: string
    metric: GoalMetric
    subject: GoalSubject
    period: GoalMonthlyPeriod
  }>,
): Promise<GovernedMetricVersion | null> {
  try {
    const governed = await resolveMetricVersion(deps, query.metric)
    const sourceInactive = await isMetricSourceInactive(deps, { ...query, governed })
    return sourceInactive ? null : governed
  } catch (error) {
    if (error instanceof GoalProgramError && error.code === 'metric_unavailable') {
      return null
    }
    throw error
  }
}

/**
 * What became of the months after, with the version to write for them when
 * one is needed and can be written.
 */
async function decideFollowing(
  deps: GoalProgramDependencies,
  actor: GoalActor,
  intent: FollowingIntent,
  facts: Omit<RevisionFacts, 'basis' | 'supersedeRowlessHead'>,
): Promise<Readonly<{ following: Following; revision: FollowingRevision | null }>> {
  if (!intent.write) return { following: intent.following, revision: null }
  const prepared = await followingRevision(deps, actor, {
    ...facts,
    basis: intent.basis,
    supersedeRowlessHead: intent.supersedeRowlessHead,
  })
  if ('reason' in prepared) {
    return {
      following: { outcome: 'not_applied', reason: prepared.reason },
      revision: null,
    }
  }
  return {
    following: { outcome: intent.outcome, startsAt: facts.plan.followingStart },
    revision: prepared.revision,
  }
}

/**
 * Change the target of the month that is running, and, when asked, of the
 * months after it. Paused goals may; ended goals may not.
 *
 * The form says which month, which target and which version it showed. A goal
 * that moved on under the form is refused with `revision_conflict`, except for
 * a save sent twice: when the month already has the target and nothing else
 * would be written, the command answers `unchanged` and writes nothing.
 */
export async function changeMonthTarget(
  deps: GoalProgramDependencies,
  input: ChangeMonthTargetInput,
  actor: GoalActor,
): Promise<GoalMonthTargetChangeResult> {
  await deps.policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    action: 'goal.update',
  })
  const now = deps.now()
  const current = await loadCaughtUpProgram(deps, actor, input, now)
  const timezone = await deps.subjects.getTimezone(actor.organizationId, input.propertyId)
  if (!timezone) throw new GoalProgramError('not_found')
  const plan = planForMonth(current, input.month, now, timezone)
  // The measure of the month, not of a change still waiting for its month.
  const target = validateGoalTarget(plan.inForceVersion.metric, input.targetValue)
  if (!target.ok) throw new GoalProgramError('invalid_target')
  const next = target.normalizedTarget

  const months = plan.runningRows.map((row) => ({
    row,
    previous: effectiveMonthTarget(row, plan.inForceVersion),
  }))
  const alreadySet = months.every((month) => month.previous === next)
  const stale =
    input.expectedVersion !== current.program.currentVersion ||
    months.some((month) => month.previous !== input.expectedTarget)
  const intent = followingIntent(plan, next, input.applyToFollowing)
  if (alreadySet && !intent.write) {
    return { month: 'unchanged', following: intent.following }
  }
  if (stale) throw new GoalProgramError('revision_conflict')

  const { following, revision } = await decideFollowing(deps, actor, intent, {
    current,
    plan,
    target: next,
    timezone,
    now,
  })
  if (alreadySet) {
    // Only the months after change: an ordinary revision, with no month to log.
    const written =
      revision === null ||
      (await deps.repository.revise({
        expectedVersion: current.version,
        ...revision,
        actorId: actor.userId,
        at: now,
      }))
    if (!written) throw new GoalProgramError('revision_conflict')
    return { month: 'unchanged', following }
  }

  const answer = await deps.repository.changeMonthTarget({
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    programId: current.program.id,
    expectedVersion: current.version,
    changeId: deps.id(),
    months: months.map(({ row, previous }) => ({
      monthlyResultId: row.id,
      changeRowId: deps.id(),
      storedTargetValue: row.targetValue,
      previousTargetValue: previous,
    })),
    targetValue: next,
    // A month back on its version's target stores none of its own again.
    storedTargetValue: next === plan.inForceVersion.targetValue ? null : next,
    following: {
      outcome: following.outcome,
      reason: following.reason ?? null,
      revision,
    },
    note: noteOf(input.note),
    actorId: actor.userId,
    at: now,
  })
  if (answer !== 'changed') throw new GoalProgramError(answer)
  return { month: { previous: input.expectedTarget, next }, following }
}
