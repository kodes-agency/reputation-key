// Reporting — the Monthly portal goal's card on the Goals page (ADR 0068,
// PLAN PG-08).
//
// One composed read: it asks the policy for `goal.create` (under `goal.use` and
// the Property grant) before anything is read, since whoever sees the card is
// whoever may set the goal; then reads the clock once, and the Property's
// Programs (scoped by what the actor may see) and the recommendation together.
// With a Monthly portal goal (`monthlyPortalGoalOf`) the card shows it: while
// it waits for its first month, the day it starts and this month so far; while
// it runs, the month it is counting with the governed figure (`progressOf`),
// never the recommendation's own count. Without one it is the recommendation's
// state, worded by the card: the gates (no Portal, draft Portals only), the
// first weeks with each Portal's steps, the number ready to use (scans first
// when only scans came in), nothing counted, or a recommendation that cannot be
// read. It writes nothing.
import { goalMonthDays } from '../../domain/goal-pace'
import type { PortalFacts } from '../../domain/goal-recommendation-types'
import { localDateOf } from '../../domain/local-days'
import type { PortalGoalRecommendation } from '../dto/goal-recommendation.types'
import type {
  PortalGoalCardView,
  PortalGoalFirstWeeks,
  PortalGoalOfCard,
  PortalReadinessRow,
} from '../dto/monthly-portal-goal.types'
import {
  monthlyPortalGoalOf,
  type PropertyCountGoal,
} from '../monthly-portal-goal-identity'
import type {
  GoalActor,
  GoalExecutionPolicy,
  GoalMetricReadPort,
  GoalProgramService,
} from './goal-programs'
import { progressOf } from './goal-progress'
import {
  gatherPortalGoalRecommendation,
  type PortalGoalRecommendationReads,
} from './goal-recommendation-read'
import type { MonthlyPortalGoalSetRequestApi } from './monthly-portal-goal'
import { portalGoalOfferOf } from './monthly-portal-goal-offer'

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
    case 'scans_only': {
      const offer = portalGoalOfferOf(recommendation)
      return offer === null
        ? { state: 'recommendation_unreadable' }
        : { state: recommendation.state, offer }
    }
    case 'nothing_counted':
      return { state: 'nothing_counted', weeks: recommendation.basis?.weeks ?? 2 }
    case 'unreadable':
      return { state: 'recommendation_unreadable' }
  }
}

/**
 * The goal as its card shows it. Only an active goal reads a figure, and that
 * is the governed read of the month it is counting.
 */
async function goalOnTheCard(
  deps: MonthlyPortalGoalCardDeps,
  bundle: PropertyCountGoal,
  context: Readonly<{
    recommendation: PortalGoalRecommendation
    now: Date
    actor: GoalActor
  }>,
): Promise<PortalGoalOfCard> {
  const { program, version } = bundle
  const { recommendation, now, actor } = context
  const measure = version.metric
  const goal = {
    programId: program.id,
    version: version.version,
    measure,
    status: program.status,
    target: version.targetValue,
    startsOn: null,
    month: null,
    currentMonthSoFar: null,
  } satisfies PortalGoalOfCard
  if (program.status === 'scheduled') {
    return {
      ...goal,
      startsOn: localDateOf(version.effectiveFrom, version.propertyTimezone),
      currentMonthSoFar: recommendation.monthToDate[measure],
    }
  }
  if (program.status !== 'active') return goal
  const progress = await progressOf(
    deps,
    bundle,
    { kind: 'property', propertyId: program.propertyId },
    'active',
    now,
    actor,
  )
  if (progress === null) return goal
  const { period, timezone, reading } = progress
  return {
    ...goal,
    month: {
      key: localDateOf(period.start, timezone).slice(0, 7),
      target: progress.targetValue,
      value: reading.kind === 'live' ? reading.value : null,
      daysAfterToday: goalMonthDays(period, now, timezone).daysLeft,
    },
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
  if (goal === null) return beforeGoal(recommendation, now)
  return {
    state: 'goal',
    today: localDateOf(now, recommendation.timezone),
    goal: await goalOnTheCard(deps, goal, { recommendation, now, actor }),
  }
}

/** Request-facing: each invocation receives its scoped policy, like the Program reads. */
export type MonthlyPortalGoalRequestApi = Readonly<{
  monthlyPortalGoal: Readonly<{
    card: (
      policy: GoalExecutionPolicy,
      input: Readonly<{ propertyId: string }>,
      actor: GoalActor,
    ) => Promise<PortalGoalCardView>
  }> &
    MonthlyPortalGoalSetRequestApi
}>
