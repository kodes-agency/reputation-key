// Reporting — the Monthly portal goal's card on the Goals page (ADR 0068,
// PLAN PG-08).
//
// One composed read: it asks the policy for `goal.create` (under `goal.use` and
// the Property grant) before anything is read, since whoever sees the card is
// whoever may set the goal; then reads the clock once, and the Property's
// Programs (scoped by what the actor may see) and the recommendation together.
// With a Monthly portal goal (`monthlyPortalGoalOf`) the card shows it
// (`monthly-portal-goal-running.ts`): while it waits for its first month, the
// day it starts and this month so far; while it runs, or after it was stopped
// to the end of that month, the month it is counting with the governed figure,
// never the recommendation's own count, its pace, each Portal's count and the
// month before. Without one it is the recommendation's state, worded by the
// card: the gates (no Portal, draft Portals only), the first weeks with each
// Portal's steps, the number ready to use (scans first when only scans came
// in), nothing counted, or a recommendation that cannot be read. It writes
// nothing.
import type { PortalFacts } from '../../domain/goal-recommendation-types'
import { localDateOf } from '../../domain/local-days'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalCardView,
  PortalGoalFirstWeeks,
  PortalReadinessRow,
} from '../dto/monthly-portal-goal.types'
import {
  monthlyPortalGoalOf,
  type PropertyCountGoal,
} from '../monthly-portal-goal-identity'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import type {
  GoalActor,
  GoalExecutionPolicy,
  GoalMetricReadPort,
  GoalProgramService,
} from './goal-programs'
import {
  gatherPortalGoalRecommendation,
  type PortalGoalRecommendationReads,
} from './goal-recommendation-read'
import { portalGoalOfferOf, portalGoalSheetFactsOf } from './monthly-portal-goal-offer'
import { monthlyPortalGoalOnCard } from './monthly-portal-goal-running'

export type MonthlyPortalGoalCardDeps = Readonly<{
  policy: GoalExecutionPolicy
  /** The Programs the actor may see (`withGoalProgramVisibility`). */
  reads: Pick<GoalProgramService, 'list'>
  /** The governed read of a running month so far. */
  metrics: Pick<GoalMetricReadPort, 'queryGoalMetric'>
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

/**
 * The card before a goal: the recommendation's state, as the card draws it.
 * Once a Portal is live, the set sheet opens from it with what it works from.
 */
function beforeGoal(
  recommendation: PortalGoalRecommendation,
  now: Date,
): PortalGoalCardView {
  if (recommendation.state === 'no_live_portal') {
    return recommendation.drafts.length > 0
      ? { state: 'drafts_only', drafts: recommendation.drafts }
      : { state: 'no_portal' }
  }
  const sheet = portalGoalSheetFactsOf(recommendation)
  switch (recommendation.state) {
    case 'getting_ready':
      return {
        state: 'getting_ready',
        ...firstWeeksOf(recommendation, now),
        readyOn: recommendation.readyOn,
        sheet,
      }
    case 'ready':
    case 'scans_only': {
      const offer = portalGoalOfferOf(recommendation)
      return offer === null
        ? { state: 'recommendation_unreadable', sheet }
        : { state: recommendation.state, offer, sheet }
    }
    case 'nothing_counted':
      return { state: 'nothing_counted', weeks: recommendation.basis?.weeks ?? 2, sheet }
    case 'unreadable':
      return { state: 'recommendation_unreadable', sheet }
  }
}

/** What the card (and the goal's page) is made from, read once. */
export type MonthlyPortalGoalGathered = Readonly<{
  now: Date
  /** The Programs the actor may see. */
  programs: readonly GoalProgramBundle[]
  recommendation: PortalGoalRecommendation
  /** The Property's Monthly portal goal among them, or none. */
  goal: PropertyCountGoal | null
}>

/**
 * Asks the policy for `goal.create` before anything is read, then reads the
 * clock once, and the Programs and the recommendation together.
 */
export async function gatherMonthlyPortalGoal(
  deps: Omit<MonthlyPortalGoalCardDeps, 'metrics'>,
  input: Readonly<{ propertyId: string }>,
  actor: GoalActor,
): Promise<MonthlyPortalGoalGathered> {
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
  return { now, programs, recommendation, goal: monthlyPortalGoalOf(programs, now) }
}

/** The card from what was gathered: the goal, or the state before one. */
export async function monthlyPortalGoalCardOf(
  deps: Pick<MonthlyPortalGoalCardDeps, 'metrics'>,
  gathered: MonthlyPortalGoalGathered,
  actor: GoalActor,
): Promise<PortalGoalCardView> {
  const { goal, recommendation, now } = gathered
  if (goal === null) return beforeGoal(recommendation, now)
  return {
    state: 'goal',
    today: localDateOf(now, recommendation.timezone),
    goal: await monthlyPortalGoalOnCard(deps, goal, { recommendation, now, actor }),
  }
}

export async function readMonthlyPortalGoalCard(
  deps: MonthlyPortalGoalCardDeps,
  input: Readonly<{ propertyId: string }>,
  actor: GoalActor,
): Promise<PortalGoalCardView> {
  return monthlyPortalGoalCardOf(
    deps,
    await gatherMonthlyPortalGoal(deps, input, actor),
    actor,
  )
}

/** Request-facing: each invocation receives its scoped policy, like the Program reads. */
export type MonthlyPortalGoalCardRequestApi = Readonly<{
  card: (
    policy: GoalExecutionPolicy,
    input: Readonly<{ propertyId: string }>,
    actor: GoalActor,
  ) => Promise<PortalGoalCardView>
}>
