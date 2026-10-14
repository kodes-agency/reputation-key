// In-memory doubles for the Property Google rating goal use-case tests.
import type {
  GoogleRatingSummary,
  GoogleRatingSummaryRequest,
  ReviewGoogleRatingReads,
} from '#/contexts/review/application/public-api'
import type { PropertyRatingGoal, RatingGoalChange } from '../../domain/rating-goal'
import type {
  PropertyRatingGoalRepository,
  RatingGoalPropertyFacts,
} from '../ports/property-rating-goal.repository'
import type { GoalActor, GoalExecutionPolicy } from './goal-program-shared'
import type { RatingGoalDependencies } from './rating-goal-shared'

const ORG = 'org-rating-goal'
export const PROPERTY = '30000000-0000-4000-8000-000000000001'
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
  /** Cache totals, the mix inputs and one count per window. */
  summary: Omit<GoogleRatingSummary, 'countsSince'> & { counts: readonly number[] }
  held: boolean
  goals: PropertyRatingGoal[]
  changes: RatingGoalChange[]
  authorizations: string[]
  deny: boolean
  summaryRequests: GoogleRatingSummaryRequest[]
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
    },
    held: false,
    goals: [],
    changes: [],
    authorizations: [],
    deny: false,
    summaryRequests: [],
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

function fakeRepository(world: FakeWorld): PropertyRatingGoalRepository {
  const find = (predicate: (goal: PropertyRatingGoal) => boolean) =>
    world.goals.find(predicate) ?? null
  const replace = (goal: PropertyRatingGoal) => {
    world.goals = world.goals.map((known) => (known.id === goal.id ? goal : known))
  }
  return {
    isOrganizationHeld: async () => world.held,
    findActive: async (org, property) =>
      find(
        (g) =>
          g.organizationId === org && g.propertyId === property && g.state === 'active',
      ),
    findById: async (org, property, id) =>
      find((g) => g.organizationId === org && g.propertyId === property && g.id === id),
    listHistory: async (org, property) =>
      world.goals.filter(
        (g) =>
          g.organizationId === org && g.propertyId === property && g.state !== 'active',
      ),
    listChanges: async (_org, _property, goalId) =>
      world.changes.filter((change) => change.goalId === goalId).reverse(),
    insert: async (goal) => {
      if (
        world.goals.some((g) => g.propertyId === goal.propertyId && g.state === 'active')
      ) {
        return 'active_exists'
      }
      world.goals = [
        ...world.goals,
        {
          ...goal,
          state: 'active',
          endedReason: null,
          reachedAt: null,
          endedAt: null,
          version: 1,
        },
      ]
      return 'inserted'
    },
    changePlan: async (change) => {
      const goal = find((g) => g.id === change.goalId)
      if (!goal || goal.state !== 'active') return 'not_active'
      if (goal.version !== change.expectedVersion) return 'version_conflict'
      replace({ ...goal, ...change.plan, version: goal.version + 1 })
      world.changes = [...world.changes, ...change.changes]
      return 'written'
    },
    endByManager: async (end) => {
      const goal = find((g) => g.id === end.goalId)
      if (!goal || goal.state !== 'active') return 'not_active'
      if (goal.version !== end.expectedVersion) return 'version_conflict'
      replace({
        ...goal,
        state: 'ended',
        endedReason: 'manager',
        endedAt: end.endedAt,
        version: goal.version + 1,
      })
      return 'written'
    },
    recordEvaluation: async (write) => {
      const goal = find((g) => g.id === write.goalId)
      if (!goal || goal.state !== 'active' || goal.version !== write.expectedVersion) {
        return false
      }
      const storedAt = goal.lastEvaluation.evaluatedAt
      if (storedAt !== null && storedAt.getTime() > write.evaluatedAt.getTime()) {
        return false
      }
      const terminal = write.outcome.kind !== 'continues'
      const changed =
        terminal ||
        goal.lastEvaluation.status !== write.status ||
        (write.displayedTenths !== null &&
          goal.lastEvaluation.displayedTenths !== write.displayedTenths)
      if (!changed) return false
      replace({
        ...goal,
        lastEvaluation: {
          status: write.status,
          displayedTenths: write.displayedTenths ?? goal.lastEvaluation.displayedTenths,
          evaluatedAt: write.evaluatedAt,
        },
        ...(write.outcome.kind === 'reached'
          ? { state: 'reached' as const, reachedAt: write.evaluatedAt }
          : {}),
        ...(write.outcome.kind === 'ended'
          ? {
              state: 'ended' as const,
              endedReason: write.outcome.reason,
              endedAt: write.evaluatedAt,
            }
          : {}),
      })
      return true
    },
    endForArchivedProperty: async (archive) => {
      const goal = find(
        (g) =>
          g.organizationId === archive.organizationId &&
          g.propertyId === archive.propertyId &&
          g.state === 'active' &&
          g.sourceEpoch < archive.archivedEpoch,
      )
      if (!goal) return false
      replace({
        ...goal,
        state: 'ended',
        endedReason: 'property_archived',
        endedAt: archive.endedAt,
      })
      return true
    },
  }
}

function fakeReviews(world: FakeWorld): ReviewGoogleRatingReads {
  return {
    getRatingSummary: async (_org, _property, request) => {
      world.summaryRequests = [...world.summaryRequests, request]
      const { counts, ...totals } = world.summary
      return { ...totals, countsSince: request.countSince.map((_, i) => counts[i] ?? 0) }
    },
    getWeeklyCounts: async () => [{ weekStart: '2026-10-12', count: 3 }],
    getStarDistribution: async () =>
      [1, 2, 3, 4, 5].map((stars) => ({ stars, count: stars === 5 ? 3 : 0 })),
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
  let next = 0
  return {
    repository: recording(world, 'repository', fakeRepository(world)),
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
    id: () => `40000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
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
    pacePerWeek: 11,
    state: 'active',
    endedReason: null,
    baseline: { reviewCount: 790, googleAverage: 4.3, exactAverage: 4.29 },
    lastEvaluation: { displayedTenths: 43, status: 'on_pace', evaluatedAt: null },
    reachedAt: null,
    endedAt: null,
    createdBy: 'manager-1',
    createdAt: new Date(NOW.getTime() - 40 * DAY),
    updatedAt: new Date(NOW.getTime() - 40 * DAY),
    version: 1,
    ...overrides,
  }
}
