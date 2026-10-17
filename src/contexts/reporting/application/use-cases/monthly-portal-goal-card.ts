// Reporting — the Monthly portal goal's card on the Goals page (ADR 0068,
// PLAN PG-08).
//
// One composed read: it asks the policy for `goal.create` (under `goal.use` and
// the Property grant) before anything is read, since whoever sees the card is
// whoever may set the goal; then reads the clock once, and the Property's
// Programs (scoped by what the actor may see) and the recommendation together.
// With a Monthly portal goal (`monthlyPortalGoalOf`) the card names it by
// Program; without one it is the recommendation's state, worded by the card:
// the gates (no Portal, draft Portals only), the first weeks with each Portal's
// steps, nothing counted, or a recommendation that cannot be read. A number
// that is ready is drawn with the first weeks until the card can offer it. It
// writes nothing.
import type { PortalFacts } from '../../domain/goal-recommendation-types'
import { localDateOf } from '../../domain/local-days'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalCardView,
  PortalGoalFirstWeeks,
  PortalReadinessRow,
} from '../dto/monthly-portal-goal.types'
import { monthlyPortalGoalOf } from '../monthly-portal-goal-identity'
import type { GoalActor, GoalExecutionPolicy, GoalProgramService } from './goal-programs'
import {
  gatherPortalGoalRecommendation,
  type PortalGoalRecommendationReads,
} from './goal-recommendation-read'

export type MonthlyPortalGoalCardDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** The Programs the actor may see (`withGoalProgramVisibility`). */
  reads: Pick<GoalProgramService, 'list'>
  recommendation: PortalGoalRecommendationReads
  now: () => Date
}>

/** A published Portal's steps; a disabled one takes no row (its counts are elsewhere). */
const readinessRow = (portal: PortalFacts): PortalReadinessRow => ({
  portalId: portal.portalId,
  name: portal.name,
  live: portal.liveSince !== null,
  codeMade: portal.codeMadeOn !== null,
  firstScan: portal.firstScan,
  noScanSinceCodeDays: portal.noScanSinceCodeDays,
})

function firstWeeksOf(
  recommendation: PortalGoalRecommendation,
  now: Date,
): PortalGoalFirstWeeks {
  return {
    today: localDateOf(now, recommendation.timezone),
    month: recommendation.months.current.key,
    soFar: {
      ratings: recommendation.monthToDate.portal_rating_count,
      scans: recommendation.monthToDate.qualified_scans,
    },
    portals: recommendation.portals
      .filter(({ publicationState }) => publicationState === 'published')
      .map(readinessRow),
  }
}

/** The card before a goal: the recommendation's state, as the card draws it. */
function beforeGoal(
  recommendation: PortalGoalRecommendation,
  now: Date,
): PortalGoalCardView {
  switch (recommendation.state) {
    case 'no_live_portal':
      return recommendation.drafts.length > 0
        ? { state: 'drafts_only', drafts: recommendation.drafts }
        : { state: 'no_portal' }
    case 'getting_ready':
      return {
        state: 'getting_ready',
        ...firstWeeksOf(recommendation, now),
        readyOn: recommendation.readyOn,
      }
    case 'ready':
    case 'scans_only':
      return { state: recommendation.state, ...firstWeeksOf(recommendation, now) }
    case 'nothing_counted':
      return { state: 'nothing_counted', weeks: recommendation.basis?.weeks ?? 2 }
    case 'unreadable':
      return { state: 'recommendation_unreadable' }
  }
}

export async function readMonthlyPortalGoalCard(
  deps: MonthlyPortalGoalCardDeps,
  input: Readonly<{ propertyId: string }>,
  actor: GoalActor,
): Promise<PortalGoalCardView> {
  const { organizationId } = actor
  const { propertyId } = input
  await deps.policy.authorize({
    actor,
    organizationId,
    propertyId,
    action: 'goal.create',
  })
  const now = deps.now()
  const [programs, recommendation] = await Promise.all([
    deps.reads.list(propertyId, actor),
    gatherPortalGoalRecommendation(deps.recommendation, {
      organizationId,
      propertyId,
      now,
    }),
  ])
  const goal = monthlyPortalGoalOf(programs, now)
  if (goal !== null) return { state: 'goal', goal: { programId: goal.program.id } }
  return beforeGoal(recommendation, now)
}

/** Request-facing: each invocation receives its scoped policy, like the Program reads. */
export type MonthlyPortalGoalRequestApi = Readonly<{
  monthlyPortalGoal: Readonly<{
    card: (
      policy: GoalExecutionPolicy,
      input: Readonly<{ propertyId: string }>,
      actor: GoalActor,
    ) => Promise<PortalGoalCardView>
  }>
}>
