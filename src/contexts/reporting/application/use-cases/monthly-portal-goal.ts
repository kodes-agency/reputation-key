// Reporting — setting the Property's Monthly portal goal (ADR 0068, PLAN PG-09).
//
// The card's Use (and, later, the set sheet) makes an ordinary Goal Program:
// named "Monthly portal goal", with the Property as its one subject, counting
// private ratings or scans, from the month the card named. It asks the policy
// for `goal.create` before anything is read. One per Property is a screen rule
// and this pre-check, not a lock or a database rule: while any Property count
// goal that has not ended exists, on either measure, a set is refused
// `subject_has_goal`. Two sets in the same second on one measure meet the
// database's no-overlap rule instead, which refuses the second the same way
// (when the two inserts deadlock in that check, the repository runs the victim
// once more, and it meets the winner); on two measures both can land, and the
// earliest-created is the monthly goal.
//
// The number's source is stored for learning (decision 11): `recommended` only
// when the number is the one the card would offer for that month and measure
// now, otherwise `own`, whatever the request said. The engine (`createGoal`)
// refuses a target or a month it does not take, an Organization that is
// closing, and decides scheduled or active.
//
// Changing it (PLAN PG-14) is the engine's own commands, each wrapped to work
// on the Monthly portal goal only, and to record the number's source the same
// way: "November, now" changes the running month and the months after it
// (`changeMonthTarget`, `goal.update`); "From Dec 1" and "Count scans instead"
// change it from its next month (`revise`, `goal.update`), the Property still
// its one subject. Stop ends it (`goal.cancel`): the month it is counting
// keeps counting to its last day and keeps its result, and the months after
// are free for a new goal. Each asks the policy first, before anything is read.
//
// The month-start check-in (PLAN PG-15): its "Use 45" is the change now, with
// the number recommended for the whole month, which is recorded as
// recommended while the check-in is open; its Keep (`goal.update`) records the
// month it answered and nothing else: no version, no change row, the same
// again when pressed twice. Keep is taken only on the running month's first
// seven local days (`check_in_closed` otherwise) and only from a goal that
// runs.
import type { GoalMetric } from '../../domain/goal-program'
import { monthKeyOf } from '../../domain/goal-start'
import type { PortalGoalMeasure } from '../../domain/goal-recommendation-types'
import { checkInMonthAt } from '../../domain/portal-goal-check-in'
import type {
  ChangeMonthlyPortalGoalNowRequest,
  KeepMonthlyPortalGoalRequest,
  ReviseMonthlyPortalGoalRequest,
  SetMonthlyPortalGoalRequest,
  StopMonthlyPortalGoalRequest,
} from '../dto/monthly-portal-goal.types'
import {
  isPortalGoalMeasure,
  isPropertyCountGoal,
  monthlyPortalGoalOf,
  type PropertyCountGoal,
} from '../monthly-portal-goal-identity'
import type {
  GoalProgram,
  GoalProgramBundle,
  GoalProgramRepository,
} from '../ports/goal-program.repository'
import type { GoalMonthTargetChangeResult } from './goal-month-target'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramService,
} from './goal-programs'
import {
  gatherPortalGoalRecommendation,
  type PortalGoalRecommendationReads,
} from './goal-recommendation-read'
import { offeredChoices, recommendedNumbersFor } from './monthly-portal-goal-offer'

/** What the goal is called, everywhere it is named. */
export const MONTHLY_PORTAL_GOAL_NAME = 'Monthly portal goal'

export type MonthlyPortalGoalSetDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** Every Program of the Property, for the pre-check: nothing is hidden from it. */
  repository: Pick<GoalProgramRepository, 'list'>
  programs: Pick<GoalProgramService, 'create'>
  recommendation: PortalGoalRecommendationReads
  now: () => Date
}>

const isRunning = (bundle: GoalProgramBundle): boolean =>
  isPropertyCountGoal(bundle) && bundle.program.status !== 'ended'

export async function setMonthlyPortalGoal(
  deps: MonthlyPortalGoalSetDeps,
  input: SetMonthlyPortalGoalRequest,
  actor: GoalActor,
): Promise<GoalProgramBundle> {
  const { organizationId } = actor
  const { propertyId, metric, targetValue, startMonth } = input
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId,
    action: 'goal.create',
  })
  // An average is never the Monthly portal goal: it has no count to aim for.
  if (!isPortalGoalMeasure(metric)) throw new GoalProgramError('invalid_target')
  const claimsRecommended = input.targetSource === 'recommended'
  const [programs, recommendation] = await Promise.all([
    deps.repository.list(organizationId, propertyId),
    claimsRecommended
      ? gatherPortalGoalRecommendation(deps.recommendation, {
          organizationId,
          propertyId,
          now: deps.now(),
        })
      : null,
  ])
  if (programs.some(isRunning)) throw new GoalProgramError('subject_has_goal')
  const recommended =
    recommendation !== null &&
    offeredChoices(recommendation, startMonth, metric)?.aBitMore === targetValue
  return deps.programs.create(
    {
      propertyId,
      name: MONTHLY_PORTAL_GOAL_NAME,
      description: null,
      metric,
      targetValue,
      subjects: [{ kind: 'property', propertyId }],
      startMonth,
      targetSource: recommended ? 'recommended' : 'own',
    },
    actor,
  )
}

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type MonthlyPortalGoalSetRequestApi = Readonly<{
  set: (
    policy: GoalExecutionPolicy,
    input: SetMonthlyPortalGoalRequest,
    actor: GoalActor,
  ) => Promise<GoalProgramBundle>
}>

export type MonthlyPortalGoalChangeDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** Every Program of the Property, to know which is the monthly goal. */
  repository: Pick<GoalProgramRepository, 'list'>
  programs: Pick<GoalProgramService, 'changeMonthTarget' | 'revise' | 'changeStatus'>
  recommendation: PortalGoalRecommendationReads
  now: () => Date
}>

type Action = 'goal.update' | 'goal.cancel'

/** Asks the policy for `action`, then reads every Program of the Property. */
async function authorizedPrograms(
  deps: Pick<MonthlyPortalGoalChangeDeps, 'policy' | 'repository'>,
  input: Readonly<{ propertyId: string }>,
  actor: GoalActor,
  action: Action,
): Promise<readonly GoalProgramBundle[]> {
  const { organizationId } = actor
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId: input.propertyId,
    action,
  })
  return deps.repository.list(organizationId, input.propertyId)
}

/** The Property's Monthly portal goal, when it is the Program asked for. */
function theMonthlyGoal(
  programs: readonly GoalProgramBundle[],
  programId: string,
  now: Date,
): PropertyCountGoal {
  const goal = monthlyPortalGoalOf(programs, now)
  if (goal === null || goal.program.id !== programId) {
    throw new GoalProgramError('invalid_subject')
  }
  return goal
}

/**
 * Whether `targetValue` is a number recommended for the `asked` month and
 * measure (the card's and the sheet's, or the open check-in's), read only when
 * the screen said so (and the month is one of the goal's counts).
 */
async function recordedSource(
  deps: MonthlyPortalGoalChangeDeps,
  claim: Readonly<{
    propertyId: string
    targetValue: number
    targetSource: 'recommended' | 'own'
  }>,
  actor: GoalActor,
  asked: Readonly<{ month: string; metric: GoalMetric }> | null,
): Promise<'recommended' | 'own'> {
  if (claim.targetSource !== 'recommended') return 'own'
  if (asked === null || !isPortalGoalMeasure(asked.metric)) return 'own'
  const recommendation = await gatherPortalGoalRecommendation(deps.recommendation, {
    organizationId: actor.organizationId,
    propertyId: claim.propertyId,
    now: deps.now(),
  })
  const measure: PortalGoalMeasure = asked.metric
  return recommendedNumbersFor(recommendation, asked.month, measure).includes(
    claim.targetValue,
  )
    ? 'recommended'
    : 'own'
}

/** What the month `month` counts: the measure of the version it opened under. */
function measureOfMonth(goal: PropertyCountGoal, month: string): GoalMetric | null {
  const result = goal.results.find(
    ({ periodStart, propertyTimezone }) =>
      monthKeyOf(periodStart, propertyTimezone) === month,
  )
  const version = goal.versions.find(({ id }) => id === result?.programVersionId)
  return version?.metric ?? null
}

/**
 * "November, now": the running month's number, and the months after it, which
 * are always given the new number too. The month locks only once it has ended,
 * so its last day still changes now.
 */
export async function changeMonthlyPortalGoalNow(
  deps: MonthlyPortalGoalChangeDeps,
  input: ChangeMonthlyPortalGoalNowRequest,
  actor: GoalActor,
): Promise<GoalMonthTargetChangeResult> {
  const programs = await authorizedPrograms(deps, input, actor, 'goal.update')
  const goal = theMonthlyGoal(programs, input.programId, deps.now())
  const metric = measureOfMonth(goal, input.month)
  const targetSource = await recordedSource(
    deps,
    input,
    actor,
    metric === null ? null : { month: input.month, metric },
  )
  return deps.programs.changeMonthTarget(
    {
      propertyId: input.propertyId,
      programId: input.programId,
      month: input.month,
      targetValue: input.targetValue,
      expectedTarget: input.expectedTarget,
      expectedVersion: input.expectedVersion,
      expectedFollowingMonth: input.expectedFollowingMonth,
      applyToFollowing: true,
      ...(input.note === undefined ? {} : { note: input.note }),
      targetSource,
    },
    actor,
  )
}

/**
 * "From Dec 1" and "Count scans instead": the goal from its next month, with
 * the Property its one subject; a goal that has not started is changed from
 * its first month. It starts with the month the sheet said, or not at all: a
 * sheet read before the month turned is refused `start_month_changed` by the
 * engine, which works the start out after it has opened the months due.
 */
export async function reviseMonthlyPortalGoal(
  deps: MonthlyPortalGoalChangeDeps,
  input: ReviseMonthlyPortalGoalRequest,
  actor: GoalActor,
): Promise<GoalProgramBundle> {
  const programs = await authorizedPrograms(deps, input, actor, 'goal.update')
  theMonthlyGoal(programs, input.programId, deps.now())
  const targetSource = await recordedSource(deps, input, actor, {
    month: input.startMonth,
    metric: input.metric,
  })
  return deps.programs.revise(
    {
      propertyId: input.propertyId,
      programId: input.programId,
      metric: input.metric,
      targetValue: input.targetValue,
      subjects: [{ kind: 'property', propertyId: input.propertyId }],
      expectedVersion: input.expectedVersion,
      expectedStartMonth: input.startMonth,
      ...(input.note === undefined ? {} : { reason: input.note }),
      targetSource,
    },
    actor,
  )
}

/**
 * Stop: the goal ends. The month it is counting keeps counting to its last day
 * and keeps its result; a goal that has not started frees its month at once.
 * Any Property count goal may be stopped, and no other goal from here. One
 * already stopped is refused `invalid_transition`: the engine takes ended to
 * ended as a status already reached, and would answer a conflict.
 */
export async function stopMonthlyPortalGoal(
  deps: MonthlyPortalGoalChangeDeps,
  input: StopMonthlyPortalGoalRequest,
  actor: GoalActor,
): Promise<GoalProgram> {
  const programs = await authorizedPrograms(deps, input, actor, 'goal.cancel')
  const asked = programs.find(({ program }) => program.id === input.programId)
  if (asked !== undefined && !isPropertyCountGoal(asked)) {
    throw new GoalProgramError('invalid_subject')
  }
  if (asked?.program.status === 'ended') throw new GoalProgramError('invalid_transition')
  return deps.programs.changeStatus(
    { propertyId: input.propertyId, programId: input.programId, status: 'ended' },
    actor,
  )
}

export type MonthlyPortalGoalKeepDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** Every Program of the Property, to know which is the monthly goal, and the answer's write. */
  repository: Pick<GoalProgramRepository, 'list' | 'answerCheckIn'>
  now: () => Date
}>

/**
 * The check-in's Keep: the month keeps its number, and its check-in is
 * answered for every manager. It is taken while the month the check-in asked
 * about runs and is on its first seven local days, cut in the zone the month
 * was cut in; and only from a goal that runs (a goal stopped since, before or
 * while this is written, is `invalid_transition`).
 */
export async function keepMonthlyPortalGoal(
  deps: MonthlyPortalGoalKeepDeps,
  input: KeepMonthlyPortalGoalRequest,
  actor: GoalActor,
): Promise<Readonly<{ month: string }>> {
  const programs = await authorizedPrograms(deps, input, actor, 'goal.update')
  const now = deps.now()
  const goal = theMonthlyGoal(programs, input.programId, now)
  if (goal.program.status !== 'active') throw new GoalProgramError('invalid_transition')
  const running = goal.results.find(
    ({ status, periodStart, periodEnd }) =>
      status === 'open' && periodStart <= now && now < periodEnd,
  )
  if (
    running === undefined ||
    monthKeyOf(running.periodStart, running.propertyTimezone) !== input.month ||
    checkInMonthAt(now, running.propertyTimezone) !== input.month
  ) {
    throw new GoalProgramError('check_in_closed')
  }
  const answered = await deps.repository.answerCheckIn({
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    programId: input.programId,
    month: input.month,
  })
  if (!answered) throw new GoalProgramError('invalid_transition')
  return { month: input.month }
}

/** Request-facing: each invocation receives its scoped policy, like the Program commands. */
export type MonthlyPortalGoalChangeRequestApi = Readonly<{
  changeNow: (
    policy: GoalExecutionPolicy,
    input: ChangeMonthlyPortalGoalNowRequest,
    actor: GoalActor,
  ) => Promise<GoalMonthTargetChangeResult>
  revise: (
    policy: GoalExecutionPolicy,
    input: ReviseMonthlyPortalGoalRequest,
    actor: GoalActor,
  ) => Promise<GoalProgramBundle>
  stop: (
    policy: GoalExecutionPolicy,
    input: StopMonthlyPortalGoalRequest,
    actor: GoalActor,
  ) => Promise<GoalProgram>
  keep: (
    policy: GoalExecutionPolicy,
    input: KeepMonthlyPortalGoalRequest,
    actor: GoalActor,
  ) => Promise<Readonly<{ month: string }>>
}>
