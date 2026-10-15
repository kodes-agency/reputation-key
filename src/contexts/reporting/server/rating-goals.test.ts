import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataScope } from '#/shared/domain/data-scope'
import type { Permission } from '#/shared/domain/permissions'
import type {
  GoalActor,
  GoalExecutionPolicy,
} from '../application/use-cases/goal-programs'

const mocks = vi.hoisted(() => ({
  setup: vi.fn(),
  card: vi.fn(),
  detail: vi.fn(),
  history: vi.fn(),
  set: vi.fn(),
  change: vi.fn(),
  end: vi.fn(),
  defer: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: {
      ratingGoals: {
        setup: mocks.setup,
        card: mocks.card,
        detail: mocks.detail,
        history: mocks.history,
        set: mocks.set,
        change: mocks.change,
        end: mocks.end,
        defer: mocks.defer,
      },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import { ratingGoalError } from '../domain/rating-goal'
import {
  changeRatingGoalSchema,
  setRatingGoalSchema,
} from '../application/dto/rating-goal.dto'
import {
  changeRatingGoal,
  deferRatingGoal,
  endRatingGoal,
  getRatingGoalCard,
  getRatingGoalDetail,
  getRatingGoalHistory,
  getRatingGoalSetup,
  setRatingGoal,
} from './rating-goals'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const GOAL_ID = '00000000-0000-4000-8000-000000000003'
const manager: GoalActor = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
  effectivePermissions: new Set<Permission>([
    'goal.read',
    'goal.create',
    'goal.update',
    'goal.cancel',
  ]),
  scopeByPermission: new Map<Permission, DataScope>([
    ['goal.read', 'assigned-properties'],
  ]),
}
const climb = {
  propertyId: PROPERTY_ID,
  mode: 'climb' as const,
  targetTenths: 45,
  qualityTenths: 47,
  pacePerWeek: 11,
}

describe('Property Google rating goal server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(manager)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('forwards each read for one Property with the resolved actor', async () => {
    const input = { propertyId: PROPERTY_ID }
    // In-process, a handler result is merged as middleware context, so the
    // doubles answer with an object rather than the null an empty card is.
    for (const use of [mocks.setup, mocks.card, mocks.detail, mocks.history]) {
      use.mockResolvedValue({ goalId: GOAL_ID })
    }

    await withStartContext(() => getRatingGoalSetup({ data: input }))
    await withStartContext(() => getRatingGoalCard({ data: input }))
    await withStartContext(() => getRatingGoalDetail({ data: input }))
    await withStartContext(() => getRatingGoalHistory({ data: input }))

    for (const use of [mocks.setup, mocks.card, mocks.detail, mocks.history]) {
      expect(use).toHaveBeenCalledWith(expect.any(Object), input, manager)
    }
  })

  it('forwards a set, a change and an end as validated', async () => {
    mocks.set.mockResolvedValue({ goalId: GOAL_ID, version: 1 })
    mocks.change.mockResolvedValue({ goalId: GOAL_ID, version: 2 })
    mocks.end.mockResolvedValue({ goalId: GOAL_ID, ended: true })
    const identity = { propertyId: PROPERTY_ID, goalId: GOAL_ID, expectedVersion: 1 }

    await withStartContext(() => setRatingGoal({ data: climb }))
    await withStartContext(() =>
      changeRatingGoal({ data: { ...identity, pacePerWeek: 14 } }),
    )
    await withStartContext(() => endRatingGoal({ data: identity }))

    expect(mocks.set).toHaveBeenCalledWith(expect.any(Object), climb, manager)
    expect(mocks.change).toHaveBeenCalledWith(
      expect.any(Object),
      { ...identity, pacePerWeek: 14 },
      manager,
    )
    expect(mocks.end).toHaveBeenCalledWith(expect.any(Object), identity, manager)
  })

  it('forwards "Not now" for one Property with the resolved actor', async () => {
    // Arrange
    mocks.defer.mockResolvedValue({ propertyId: PROPERTY_ID })
    const input = { propertyId: PROPERTY_ID }

    // Act
    await withStartContext(() => deferRatingGoal({ data: input }))

    // Assert
    expect(mocks.defer).toHaveBeenCalledWith(expect.any(Object), input, manager)
  })

  it('asks the execution policy for goal.use and the action on the named Property', async () => {
    mocks.set.mockResolvedValue({ goalId: GOAL_ID, version: 1 })
    await withStartContext(() => setRatingGoal({ data: climb }))
    const policy = mocks.set.mock.calls[0]?.[0] as GoalExecutionPolicy

    for (const action of [
      'goal.read',
      'goal.create',
      'goal.update',
      'goal.cancel',
    ] as const) {
      await policy.authorize({
        actor: manager,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        action,
      })
      expect(mocks.requireExecutionAllowed).toHaveBeenLastCalledWith({
        actor: manager,
        action,
        capability: 'goal.use',
        propertyId: PROPERTY_ID,
      })
    }
  })

  it('refuses a request made for another person or another Organization', async () => {
    mocks.card.mockResolvedValue({ goalId: GOAL_ID })
    await withStartContext(() => getRatingGoalCard({ data: { propertyId: PROPERTY_ID } }))
    const policy = mocks.card.mock.calls[0]?.[0] as GoalExecutionPolicy

    await expect(
      policy.authorize({
        actor: { ...manager, userId: 'someone-else' },
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        action: 'goal.read',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      policy.authorize({
        actor: manager,
        organizationId: 'another-organization',
        propertyId: PROPERTY_ID,
        action: 'goal.read',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })

  it('passes a refusal of the execution policy on unchanged', async () => {
    const refusal = Object.assign(new Error('scope_denied'), { status: 403 })
    mocks.requireExecutionAllowed.mockRejectedValue(refusal)
    mocks.card.mockImplementation(async (policy: GoalExecutionPolicy, input, actor) => {
      await policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        action: 'goal.read',
      })
      return null
    })

    await expect(
      withStartContext(() => getRatingGoalCard({ data: { propertyId: PROPERTY_ID } })),
    ).rejects.toMatchObject({ status: expect.any(Number) })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: PROPERTY_ID, capability: 'goal.use' }),
    )
  })

  it.each([
    ['goal_exists', 409],
    ['not_eligible', 409],
    ['version_conflict', 409],
    ['not_active', 409],
    ['organization_closing', 409],
    ['not_found', 404],
    ['forbidden', 403],
    ['invalid_target', 400],
    ['invalid_pace', 400],
    ['no_change', 400],
  ] as const)('answers %s with HTTP %i', async (code, status) => {
    mocks.set.mockRejectedValue(ratingGoalError(code, code))

    await expect(
      withStartContext(() => setRatingGoal({ data: climb })),
    ).rejects.toMatchObject({
      name: 'RatingGoalError',
      code,
      status,
    })
  })
})

describe('Property Google rating goal input', () => {
  it('needs a pace and a planned quality to climb, and neither to keep', () => {
    const keep = { ...climb, mode: 'keep', qualityTenths: null, pacePerWeek: null }

    expect(setRatingGoalSchema.safeParse(climb).success).toBe(true)
    expect(setRatingGoalSchema.safeParse({ ...climb, pacePerWeek: null }).success).toBe(
      false,
    )
    expect(setRatingGoalSchema.safeParse({ ...climb, qualityTenths: null }).success).toBe(
      false,
    )
    expect(setRatingGoalSchema.safeParse(keep).success).toBe(true)
    expect(setRatingGoalSchema.safeParse({ ...keep, pacePerWeek: 11 }).success).toBe(
      false,
    )
    expect(setRatingGoalSchema.safeParse({ ...keep, qualityTenths: 47 }).success).toBe(
      false,
    )
  })

  it('takes a planned quality in tenths up to five stars', () => {
    for (const qualityTenths of [51, 46.5]) {
      expect(setRatingGoalSchema.safeParse({ ...climb, qualityTenths }).success).toBe(
        false,
      )
    }
    expect(setRatingGoalSchema.safeParse({ ...climb, qualityTenths: 50 }).success).toBe(
      true,
    )
  })

  it('takes a target in tenths from 1.0 to 5.0 and a whole pace from 1 to 200', () => {
    for (const targetTenths of [9, 51, 44.5]) {
      expect(setRatingGoalSchema.safeParse({ ...climb, targetTenths }).success).toBe(
        false,
      )
    }
    for (const pacePerWeek of [0, 201, 2.5]) {
      expect(setRatingGoalSchema.safeParse({ ...climb, pacePerWeek }).success).toBe(false)
    }
    expect(
      setRatingGoalSchema.safeParse({ ...climb, propertyId: 'not-a-uuid' }).success,
    ).toBe(false)
  })

  it('refuses a change that names nothing to change', () => {
    const identity = { propertyId: PROPERTY_ID, goalId: GOAL_ID, expectedVersion: 1 }

    expect(changeRatingGoalSchema.safeParse(identity).success).toBe(false)
    expect(changeRatingGoalSchema.safeParse({ ...identity, mode: 'keep' }).success).toBe(
      true,
    )
    expect(
      changeRatingGoalSchema.safeParse({ ...identity, qualityTenths: 48 }).success,
    ).toBe(true)
    expect(
      changeRatingGoalSchema.safeParse({
        ...identity,
        expectedVersion: 0,
        targetTenths: 46,
      }).success,
    ).toBe(false)
  })
})
