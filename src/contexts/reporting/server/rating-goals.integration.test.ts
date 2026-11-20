// The Property Google rating goal server functions, called as signed-in members
// over PostgreSQL with the real tenant resolution, execution policy (goal.use and
// the goal permissions on the Property), Reporting use cases and Inbox links.
// The clock sits on Wednesday 14 Oct 2026, mid-week in Sofia.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  GOAL_CLEANUP_TABLES,
  GOAL_CLEANUP_TRIGGERS,
} from '#/shared/testing/server-function-goal-seeds'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { ratingGoalError } from '../domain/rating-goal'
import { withRatingGoals } from './rating-goal-request.server'
import {
  changeRatingGoal,
  deferRatingGoal,
  endRatingGoal,
  getRatingGoalCard,
  getRatingGoalDetail,
  getRatingGoalHistory,
  getRatingGoalSetup,
  keepRatingGoalPace,
  setRatingGoal,
} from './rating-goals'

const NOW = new Date('2026-10-14T09:00:00.000Z')
const DAY_MS = 86_400_000

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  cleanupTables: [
    ...REVIEW_SEED_TABLES,
    ...GOAL_CLEANUP_TABLES,
    'property_rating_goal_deferrals',
  ],
  disabledTriggers: GOAL_CLEANUP_TRIGGERS,
})

const climb = (propertyId: string) => ({
  propertyId,
  mode: 'climb' as const,
  targetTenths: 45,
  qualityTenths: 47,
  paceTenthsPerWeek: 110,
})

async function hotel(options: { numbers?: boolean } = {}) {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization, { google: true })
  if (options.numbers ?? true) {
    await harness.seedGoogleNumbers(property)
    // The review cache the setup is worked out from: none, and the reading waits.
    for (const [index, rating] of ([5, 4, 5, 4, 4] as const).entries()) {
      await harness.seedReview(property, {
        rating,
        reviewedAt: new Date(NOW.getTime() - (100 + index) * DAY_MS),
      })
    }
  }
  return { organization, admin, manager, property }
}

async function goalRows(propertyId: string) {
  const { rows } = await harness.pool().query<{
    id: string
    status: string
    version: number
  }>('SELECT id, status, version FROM property_rating_goals WHERE property_id = $1 ORDER BY created_at', [propertyId])
  return rows
}

async function changeCount(propertyId: string): Promise<number> {
  const { rows } = await harness
    .pool()
    .query<{ count: string }>(
      'SELECT count(*) FROM property_rating_goal_changes WHERE property_id = $1',
      [propertyId],
    )
  return Number(rows[0]?.count)
}

describe('reading a Property with no goal', () => {
  it('shows an AccountAdmin the setup, no card, no detail and no history', async () => {
    const { admin, property } = await hotel({ numbers: false })
    const data = { propertyId: property.id }

    const setup = await harness.callAs(admin, () => getRatingGoalSetup({ data }))
    expect(setup).toMatchObject({ hasActiveGoal: false })
    expect(setup.eligibility).not.toMatchObject({ eligible: true })
    await expect(
      harness.callAs(admin, () => getRatingGoalCard({ data })),
    ).resolves.toBeNull()
    await expect(
      harness.callAs(admin, () => getRatingGoalDetail({ data })),
    ).resolves.toBeNull()
    await expect(
      harness.callAs(admin, () => getRatingGoalHistory({ data })),
    ).resolves.toEqual([])
  })

  it("shows Google's numbers and an eligible setup from ten reviews", async () => {
    const { admin, property } = await hotel()

    const setup = await harness.callAs(admin, () =>
      getRatingGoalSetup({ data: { propertyId: property.id } }),
    )

    expect(setup).toMatchObject({ hasActiveGoal: false })
    expect(JSON.stringify(setup)).toContain('4.3')
  })
})

describe('deciding "Not now"', () => {
  it('records who decided and when', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () => deferRatingGoal({ data: { propertyId: property.id } })),
    ).resolves.toEqual({ propertyId: property.id })

    const { rows } = await harness
      .pool()
      .query('SELECT * FROM property_rating_goal_deferrals WHERE property_id = $1', [
        property.id,
      ])
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0])).toContain(admin.userId)
  })
})

describe('setting, changing, keeping and ending a goal', () => {
  it('sets a goal, raises its pace, keeps the check-in and ends it', async () => {
    const { admin, property } = await hotel()

    const set = await harness.callAs(admin, () =>
      setRatingGoal({ data: climb(property.id) }),
    )
    expect(set).toMatchObject({ version: 1 })
    expect(await goalRows(property.id)).toEqual([
      { id: set.goalId, status: 'active', version: 1 },
    ])

    const changed = await harness.callAs(admin, () =>
      changeRatingGoal({
        data: {
          propertyId: property.id,
          goalId: set.goalId,
          expectedVersion: 1,
          paceTenthsPerWeek: 140,
        },
      }),
    )
    expect(changed).toMatchObject({ goalId: set.goalId, version: 2 })
    expect(await changeCount(property.id)).toBeGreaterThan(0)

    const ended = await harness.callAs(admin, () =>
      endRatingGoal({
        data: { propertyId: property.id, goalId: set.goalId, expectedVersion: 2 },
      }),
    )
    expect(ended).toMatchObject({ goalId: set.goalId })
    expect((await goalRows(property.id))[0]).toMatchObject({ status: 'ended' })
    await expect(
      harness.callAs(admin, () =>
        getRatingGoalCard({ data: { propertyId: property.id } }),
      ),
    ).resolves.toBeNull()
  })

  it('answers the Monday check-in with no version move, once and only for last week', async () => {
    const { admin, property } = await hotel()
    const goal = await harness.seedRatingGoal(property, {
      createdBy: admin,
      createdAt: new Date(NOW.getTime() - 21 * DAY_MS),
    })
    const keep = (weekStart: string) => () =>
      keepRatingGoalPace({
        data: { propertyId: property.id, goalId: goal.id, weekStart },
      })

    await expect(harness.callAs(admin, keep('2026-09-28'))).rejects.toMatchObject({
      code: 'recap_closed',
      status: 409,
    })
    await expect(harness.callAs(admin, keep('2026-10-05'))).resolves.toEqual({
      goalId: goal.id,
      weekStart: '2026-10-05',
    })
    expect((await goalRows(property.id))[0]).toMatchObject({ version: 1 })
    expect(await changeCount(property.id)).toBe(0)
  })

  it('refuses a second goal, a stale version and a change of nothing', async () => {
    const { admin, property } = await hotel()
    const set = await harness.callAs(admin, () =>
      setRatingGoal({ data: climb(property.id) }),
    )
    const identity = { propertyId: property.id, goalId: set.goalId }

    await expect(
      harness.callAs(admin, () => setRatingGoal({ data: climb(property.id) })),
    ).rejects.toMatchObject({ name: 'RatingGoalError', code: 'goal_exists', status: 409 })
    await expect(
      harness.callAs(admin, () =>
        changeRatingGoal({
          data: { ...identity, expectedVersion: 5, paceTenthsPerWeek: 140 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'version_conflict', status: 409 })
    await expect(
      harness.callAs(admin, () =>
        changeRatingGoal({
          data: { ...identity, expectedVersion: 1, paceTenthsPerWeek: 110 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'no_change', status: 400 })
    expect(await goalRows(property.id)).toHaveLength(1)
  })

  it('refuses an invalid target and an invalid pace', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        setRatingGoal({ data: { ...climb(property.id), targetTenths: 42 } }),
      ),
    ).rejects.toMatchObject({ name: 'RatingGoalError', status: 400 })
    expect(await goalRows(property.id)).toEqual([])
  })

  it('refuses a validator failure before anything changes', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        setRatingGoal({ data: { ...climb(property.id), paceTenthsPerWeek: null } }),
      ),
    ).rejects.toThrow(/paceTenthsPerWeek/)
    expect(await goalRows(property.id)).toEqual([])
  })

  it('refuses a Property without Google numbers', async () => {
    const { admin, property } = await hotel({ numbers: false })

    await expect(
      harness.callAs(admin, () => setRatingGoal({ data: climb(property.id) })),
    ).rejects.toMatchObject({ code: 'not_eligible', status: 409 })
    expect(await goalRows(property.id)).toEqual([])
  })

  it('refuses ending and keeping a goal that is not active', async () => {
    const { admin, property } = await hotel()
    const set = await harness.callAs(admin, () =>
      setRatingGoal({ data: climb(property.id) }),
    )
    await harness.callAs(admin, () =>
      endRatingGoal({
        data: { propertyId: property.id, goalId: set.goalId, expectedVersion: 1 },
      }),
    )

    await expect(
      harness.callAs(admin, () =>
        endRatingGoal({
          data: { propertyId: property.id, goalId: set.goalId, expectedVersion: 1 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_active', status: 409 })
  })
})

describe('who may use the goal functions', () => {
  it('refuses a PropertyManager without a grant on every function', async () => {
    const { manager, property } = await hotel()
    const goalId = randomUUID()
    const data = { propertyId: property.id }
    const calls: Array<() => Promise<unknown>> = [
      () => getRatingGoalSetup({ data }),
      () => getRatingGoalCard({ data }),
      () => getRatingGoalDetail({ data }),
      () => getRatingGoalHistory({ data }),
      () => setRatingGoal({ data: climb(property.id) }),
      () =>
        changeRatingGoal({
          data: { ...data, goalId, expectedVersion: 1, paceTenthsPerWeek: 140 },
        }),
      () => endRatingGoal({ data: { ...data, goalId, expectedVersion: 1 } }),
      () => keepRatingGoalPace({ data: { ...data, goalId, weekStart: '2026-10-05' } }),
      () => deferRatingGoal({ data }),
    ]

    for (const call of calls) {
      await expect(harness.callAs(manager, call)).rejects.toMatchObject({
        status: 403,
      })
    }
    expect(await goalRows(property.id)).toEqual([])
  })

  it('lets a granted PropertyManager read and set', async () => {
    const { manager, property } = await hotel()
    await harness.grantProperty(manager, property)

    const set = await harness.callAs(manager, () =>
      setRatingGoal({ data: climb(property.id) }),
    )

    expect(set).toMatchObject({ version: 1 })
  })

  it("answers another Organization's Property and an unknown one with not found", async () => {
    const { admin } = await hotel()
    const elsewhere = await hotel()

    for (const propertyId of [elsewhere.property.id, randomUUID()]) {
      await expect(
        harness.callAs(admin, () => getRatingGoalSetup({ data: { propertyId } })),
      ).rejects.toMatchObject({ status: expect.any(Number) })
    }
    expect(await goalRows(elsewhere.property.id)).toEqual([])
  })

  it('refuses a request with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () =>
        getRatingGoalCard({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})

describe('the status of a goal refusal', () => {
  it.each([
    ['goal_exists', 409],
    ['not_eligible', 409],
    ['version_conflict', 409],
    ['not_active', 409],
    ['recap_closed', 409],
    ['not_found', 404],
    ['forbidden', 403],
    ['invalid_target', 400],
    ['invalid_quality', 400],
    ['invalid_pace', 400],
    ['no_change', 400],
  ] as const)('answers %s with HTTP %i', async (code, status) => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        withRatingGoals(async () => {
          throw ratingGoalError(code, code)
        }),
      ),
    ).rejects.toMatchObject({ name: 'RatingGoalError', code, status })
  })
})

describe("the detail's low reviews, opened in the Inbox", () => {
  async function climbing() {
    const base = await hotel()
    const goal = await harness.seedRatingGoal(base.property, {
      createdBy: base.admin,
      createdAt: new Date(NOW.getTime() - 7 * DAY_MS),
    })
    return { ...base, goal }
  }
  const lowReview = (hoursAgo: number) => ({
    rating: 1 as const,
    reviewedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
  })

  it('links each low review to the Inbox item that opens it, or to none', async () => {
    const { admin, property } = await climbing()
    const linked = await harness.seedReview(property, lowReview(5))
    const unlinked = await harness.seedReview(property, lowReview(10))
    const item = await harness.seedInboxItem({ review: linked }, { rating: 1 })

    const detail = await harness.callAs(admin, () =>
      getRatingGoalDetail({ data: { propertyId: property.id } }),
    )

    const rows = detail!.moved.lowReviews
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.inboxItemId).sort()).toEqual([item.id, null].sort())
    const answer = JSON.stringify(detail)
    expect(answer).not.toContain(linked.id)
    expect(answer).not.toContain(unlinked.id)
    expect(answer).not.toContain('reviewId')
  })

  it('answers no low reviews when there are none', async () => {
    const { admin, property } = await climbing()

    const detail = await harness.callAs(admin, () =>
      getRatingGoalDetail({ data: { propertyId: property.id } }),
    )

    expect(detail!.moved.lowReviews).toEqual([])
  })
})
