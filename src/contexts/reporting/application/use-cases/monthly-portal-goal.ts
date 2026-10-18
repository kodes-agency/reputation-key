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
import type { SetMonthlyPortalGoalRequest } from '../dto/monthly-portal-goal.types'
import { isPortalGoalMeasure, isPropertyCountGoal } from '../monthly-portal-goal-identity'
import type {
  GoalProgramBundle,
  GoalProgramRepository,
} from '../ports/goal-program.repository'
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
import { offeredChoices } from './monthly-portal-goal-offer'

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
