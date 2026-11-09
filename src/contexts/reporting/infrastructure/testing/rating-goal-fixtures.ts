// The Property Google rating goal use-case tests: the goal repository is the
// real one over PostgreSQL; the Property facts, Google reads and policy are
// doubles for the ports of other contexts.
import {
  databaseRepository,
  nextScenarioId,
  RATING_GOAL_ORGANIZATION,
  RATING_GOAL_PROPERTY,
} from './rating-goal-database'

export { holdOrganization, useRatingGoalDatabase } from './rating-goal-database'

import type {
  GoogleRatingDayCount,
  GoogleRatingHistory,
  GoogleRatingLowReview,
  GoogleRatingMonthTotals,
  GoogleRatingStarCount,
  GoogleRatingSummary,
  GoogleRatingSummaryRequest,
  GoogleRatingTotals,
  GoogleRatingYearTotals,
  GoogleShownNumber,
  ReviewGoogleRatingReads,
} from '#/contexts/review/application/public-api'
import type { PropertyRatingGoal, RatingGoalChange } from '../../domain/rating-goal'
import type { RatingGoalNotice } from '../../domain/rating-goal-notices'
import type {
  RatingGoalNotNow,
  RatingGoalPropertyFacts,
} from '../../application/ports/property-rating-goal.repository'
import type {
  GoalActor,
  GoalExecutionPolicy,
} from '../../application/use-cases/goal-program-shared'
import type { RatingGoalDependencies } from '../../rating-goals/rating-goal-shared.server'

const ORG = RATING_GOAL_ORGANIZATION
export const PROPERTY = RATING_GOAL_PROPERTY
export const NOW = new Date('2026-10-14T12:00:00.000Z')
export const DAY = 24 * 60 * 60 * 1000

export const actor: GoalActor = {
  organizationId: ORG,
  userId: 'manager-1',
  role: 'AccountAdmin',
}

export type FakeWorld = {
  facts: RatingGoalPropertyFacts | null
  snapshot: { reviewCount: number; averageRating: number | null; verifiedAt: Date } | null
  /**
   * Cache totals, the mix inputs, one count per window, and the reviews since
   * a goal was set (answered only when a read asks for them).
   */
  summary: Omit<GoogleRatingSummary, 'countsSince' | 'totalsSince' | 'rangeTotals'> & {
    counts: readonly number[]
    sinceSet: GoogleRatingTotals
    /** The reviews of last Property-local week (the range a card read asks for). */
    lastWeek: GoogleRatingTotals
  }
  /** Each calendar year's totals, oldest first. */
  years: GoogleRatingYearTotals[]
  /** Each calendar month's totals with enough reviews, oldest first. */
  months: GoogleRatingMonthTotals[]
  /** Reviews per Property-local date, oldest first. */
  days: GoogleRatingDayCount[]
  /** The exact average at each week's end from the detail's chart start. */
  history: GoogleRatingHistory
  /** Google's shown number in force at the chart start, then each change. */
  shown: GoogleShownNumber[]
  /** Every review a low-review read may name, newest first (the read filters and limits). */
  lowReviews: GoogleRatingLowReview[]
  /** The star split a star-distribution read answers. */
  stars: GoogleRatingStarCount[]
  goals: PropertyRatingGoal[]
  changes: RatingGoalChange[]
  /** The notices each stored evaluation wrote as facts, in order. */
  notices: Array<RatingGoalNotice & Readonly<{ goalId: string }>>
  /** "Not now" choices, one per Property. */
  notNow: RatingGoalNotNow[]
  authorizations: string[]
  deny: boolean
  summaryRequests: GoogleRatingSummaryRequest[]
  /** The bounds each month, day, history, shown-number, low-review and star read was asked with. */
  evidenceRequests: Array<
    | Readonly<{ read: 'months'; since: Date; minimumCount: number }>
    | Readonly<{ read: 'days' | 'history' | 'shown' | 'stars'; since: Date }>
    | Readonly<{ read: 'low'; since: Date; belowThousandths: number; limit: number }>
  >
  /** Every port call, in order: `policy.authorize`, `repository.findActive`, ... */
  calls: string[]
}

/** Near the owner's worked example: 812 reviews at about 4.31, a 4.70 mix, 7 a week. */
export function exampleWorld(): FakeWorld {
  return {
    facts: {
      timezone: 'Europe/Sofia',
      lifecycleState: 'active',
      sourceEpoch: 2,
      googleBindingActive: true,
    },
    snapshot: {
      reviewCount: 812,
      averageRating: 4.300000190734863,
      verifiedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    },
    summary: {
      // 3500 / 812 = 4.3103: the exact average, Google showing 4.3.
      all: { count: 812, sum: 3500 },
      mixWindow: { count: 30, sum: 141 },
      mostRecent: { count: 25, sum: 118 },
      counts: [28, 0, 0, 0],
      // Nine reviews since a goal was set: no verdict on their stars yet.
      sinceSet: { count: 9, sum: 41 },
      // Eight reviews last week: a count, and no star sum under ten.
      lastWeek: { count: 8, sum: 37 },
    },
    years: [],
    months: [],
    days: [],
    history: { startAverageThousandths: 4302, weeks: [] },
    shown: [],
    lowReviews: [],
    stars: [1, 2, 3, 4, 5].map((stars) => ({ stars, count: 0 })),
    goals: [],
    changes: [],
    notices: [],
    notNow: [],
    authorizations: [],
    deny: false,
    summaryRequests: [],
    evidenceRequests: [],
    calls: [],
  }
}

type AnyPortFunction = (...args: never[]) => unknown

/** The same port, each call logged in `world.calls` as `<port>.<method>`. */
function recording<T extends Readonly<Record<string, AnyPortFunction>>>(
  world: FakeWorld,
  port: string,
  target: T,
): T {
  const entries = Object.entries(target).map(([method, call]) => [
    method,
    (...args: never[]) => {
      world.calls = [...world.calls, `${port}.${method}`]
      return call(...args)
    },
  ])
  return Object.fromEntries(entries) as T
}

function fakeReviews(world: FakeWorld): ReviewGoogleRatingReads {
  return {
    getRatingSummary: async (_org, _property, request) => {
      world.summaryRequests = [...world.summaryRequests, request]
      const { counts, sinceSet, lastWeek, ...totals } = world.summary
      return {
        ...totals,
        countsSince: request.countSince.map((_, i) => counts[i] ?? 0),
        totalsSince: request.totalsSince === undefined ? null : sinceSet,
        rangeTotals:
          request.rangeTotals === undefined
            ? null
            : {
                count: lastWeek.count,
                sum:
                  lastWeek.count >= request.rangeTotals.minimumCount
                    ? lastWeek.sum
                    : null,
              },
      }
    },
    getYearlyTotals: async () => world.years,
    getMonthlyTotals: async (_org, _property, since, minimumCount) => {
      world.evidenceRequests = [
        ...world.evidenceRequests,
        { read: 'months', since, minimumCount },
      ]
      return world.months
    },
    getDailyCounts: async (_org, _property, since) => {
      world.evidenceRequests = [...world.evidenceRequests, { read: 'days', since }]
      return world.days
    },
    getWeeklyHistory: async (_org, _property, since) => {
      world.evidenceRequests = [...world.evidenceRequests, { read: 'history', since }]
      return world.history
    },
    getShownNumberChanges: async (_org, _property, since) => {
      world.evidenceRequests = [...world.evidenceRequests, { read: 'shown', since }]
      return world.shown
    },
    getLowReviews: async (_org, _property, since, belowThousandths, limit) => {
      world.evidenceRequests = [
        ...world.evidenceRequests,
        { read: 'low', since, belowThousandths, limit },
      ]
      return world.lowReviews
        .filter((review) => review.stars * 1000 < belowThousandths && review.stars <= 4)
        .slice(0, limit)
    },
    getStarDistribution: async (_org, _property, since) => {
      world.evidenceRequests = [...world.evidenceRequests, { read: 'stars', since }]
      return world.stars
    },
  }
}

const fakePolicy = (world: FakeWorld): GoalExecutionPolicy => ({
  authorize: async (request) => {
    world.authorizations = [
      ...world.authorizations,
      `${request.action}:${request.propertyId}`,
    ]
    if (world.deny) throw new Error('denied by policy')
  },
})

export function dependencies(world: FakeWorld): RatingGoalDependencies {
  return {
    repository: recording(world, 'repository', databaseRepository(world)),
    properties: recording(world, 'properties', {
      findPropertyFacts: async () => world.facts,
    }),
    google: recording(world, 'google', {
      getCurrentOnGoogle: async (organizationId, propertyId) =>
        world.snapshot
          ? {
              semantics: 'current_on_google' as const,
              organizationId,
              propertyId,
              ...world.snapshot,
            }
          : null,
    }),
    reviews: recording(world, 'reviews', fakeReviews(world)),
    policy: recording(world, 'policy', fakePolicy(world)),
    id: () => nextScenarioId(),
    now: () => NOW,
  }
}

export function activeGoal(
  overrides: Partial<PropertyRatingGoal> = {},
): PropertyRatingGoal {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceEpoch: 2,
    mode: 'climb',
    targetTenths: 45,
    qualityTenths: 47,
    paceTenthsPerWeek: 110,
    state: 'active',
    endedReason: null,
    baseline: { reviewCount: 790, googleAverage: 4.3, exactAverage: 4.29 },
    lastEvaluation: {
      displayedTenths: 43,
      status: 'on_pace',
      evaluatedAt: null,
      knownStatus: 'on_pace',
      belowPaceNoticedAt: null,
      tooLowNoticedAt: null,
    },
    reachedAt: null,
    endedAt: null,
    createdBy: 'manager-1',
    createdAt: new Date(NOW.getTime() - 40 * DAY),
    updatedAt: new Date(NOW.getTime() - 40 * DAY),
    paceSince: overrides.createdAt ?? new Date(NOW.getTime() - 40 * DAY),
    recapAnsweredWeek: null,
    version: 1,
    ...overrides,
  }
}
