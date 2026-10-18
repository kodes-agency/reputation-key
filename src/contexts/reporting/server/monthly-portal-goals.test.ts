import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataScope } from '#/shared/domain/data-scope'
import type { Permission } from '#/shared/domain/permissions'
import type {
  GoalActor,
  GoalExecutionPolicy,
} from '../application/use-cases/goal-programs'

const mocks = vi.hoisted(() => ({
  card: vi.fn(),
  page: vi.fn(),
  set: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: {
      programs: {
        monthlyPortalGoal: { card: mocks.card, page: mocks.page, set: mocks.set },
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

import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { monthlyPortalGoalPropertySchema } from '../application/dto/monthly-portal-goal.dto'
import { GoalProgramError } from '../application/use-cases/goal-programs'
import {
  getMonthlyPortalGoalCard,
  getMonthlyPortalGoalPage,
  setMonthlyPortalGoal,
} from './monthly-portal-goals'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const manager: GoalActor = {
  organizationId: ORG_ID,
  userId: 'elena',
  role: 'PropertyManager',
  effectivePermissions: new Set<Permission>([
    'goal.read',
    'goal.create',
    'goal.update',
    'goal.cancel',
  ]),
  scopeByPermission: new Map<Permission, DataScope>([
    ['goal.create', 'assigned-properties'],
  ]),
}
const input = { propertyId: PROPERTY_ID }

/** The card as the use case reads it: `goal.create` first, then nothing to show. */
const cardAskingGoalCreate = async (
  policy: GoalExecutionPolicy,
  data: typeof input,
  actor: GoalActor,
) => {
  await policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId: data.propertyId,
    action: 'goal.create',
  })
  return { state: 'no_portal' }
}

describe('Monthly portal goal server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(manager)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('authorizes through the execution policy', async () => {
    mocks.card.mockImplementation(cardAskingGoalCreate)

    await withStartContext(() => getMonthlyPortalGoalCard({ data: input }))

    expect(mocks.card).toHaveBeenCalledWith(expect.any(Object), input, manager)
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: manager,
      action: 'goal.create',
      capability: 'goal.use',
      propertyId: PROPERTY_ID,
    })
  })

  it.each(['scope_denied', 'beta_role_inactive'])(
    'passes the execution policy refusal %s on unchanged',
    async (reason) => {
      mocks.requireExecutionAllowed.mockRejectedValue(
        new ServerFunctionError(
          'AuthError',
          `Authorization denied: ${reason}`,
          reason,
          403,
        ),
      )
      mocks.card.mockImplementation(cardAskingGoalCreate)

      await expect(
        withStartContext(() => getMonthlyPortalGoalCard({ data: input })),
      ).rejects.toMatchObject({ name: 'AuthError', code: reason, status: 403 })
    },
  )

  it('refuses a request made for another person', async () => {
    mocks.card.mockResolvedValue({ state: 'no_portal' })
    await withStartContext(() => getMonthlyPortalGoalCard({ data: input }))
    const policy = mocks.card.mock.calls[0]?.[0] as GoalExecutionPolicy

    await expect(
      policy.authorize({
        actor: { ...manager, userId: 'someone-else' },
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        action: 'goal.create',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })

  it.each([
    ['not_found', 404],
    ['forbidden', 403],
  ] as const)('answers %s with HTTP %i', async (code, status) => {
    mocks.card.mockRejectedValue(new GoalProgramError(code))

    await expect(
      withStartContext(() => getMonthlyPortalGoalCard({ data: input })),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code, status })
  })

  it('reads one Property by its id', () => {
    expect(monthlyPortalGoalPropertySchema.safeParse(input).success).toBe(true)
    expect(monthlyPortalGoalPropertySchema.safeParse({ propertyId: 'p1' }).success).toBe(
      false,
    )
  })
})

describe('getMonthlyPortalGoalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(manager)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('authorizes through the execution policy, as the card does', async () => {
    mocks.page.mockImplementation(cardAskingGoalCreate)

    await withStartContext(() => getMonthlyPortalGoalPage({ data: input }))

    expect(mocks.page).toHaveBeenCalledWith(expect.any(Object), input, manager)
    expect(mocks.card).not.toHaveBeenCalled()
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: manager,
      action: 'goal.create',
      capability: 'goal.use',
      propertyId: PROPERTY_ID,
    })
  })

  it('passes the execution policy refusal scope_denied on unchanged', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        'Authorization denied: scope_denied',
        'scope_denied',
        403,
      ),
    )
    mocks.page.mockImplementation(cardAskingGoalCreate)

    await expect(
      withStartContext(() => getMonthlyPortalGoalPage({ data: input })),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })
  })
})

describe('setMonthlyPortalGoal', () => {
  const use = {
    propertyId: PROPERTY_ID,
    metric: 'portal_rating_count',
    targetValue: 40,
    startMonth: '2026-11',
    targetSource: 'recommended',
  } as const

  /** The set as the use case runs it: `goal.create` first, then the new Program. */
  const setAskingGoalCreate = async (
    policy: GoalExecutionPolicy,
    data: typeof use,
    actor: GoalActor,
  ) => {
    await policy.authorize({
      actor,
      organizationId: actor.organizationId,
      propertyId: data.propertyId,
      action: 'goal.create',
    })
    return { program: { id: 'program-monthly', name: 'Monthly portal goal' } }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(manager)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('authorizes through the execution policy', async () => {
    mocks.set.mockImplementation(setAskingGoalCreate)

    // Outside the server runtime the answer itself does not come back.
    await withStartContext(() => setMonthlyPortalGoal({ data: use }))

    expect(mocks.set).toHaveBeenCalledWith(expect.any(Object), use, manager)
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: manager,
      action: 'goal.create',
      capability: 'goal.use',
      propertyId: PROPERTY_ID,
    })
  })

  it.each(['scope_denied', 'beta_role_inactive'])(
    'passes the execution policy refusal %s on unchanged',
    async (reason) => {
      mocks.requireExecutionAllowed.mockRejectedValue(
        new ServerFunctionError(
          'AuthError',
          `Authorization denied: ${reason}`,
          reason,
          403,
        ),
      )
      mocks.set.mockImplementation(setAskingGoalCreate)

      await expect(
        withStartContext(() => setMonthlyPortalGoal({ data: use })),
      ).rejects.toMatchObject({ name: 'AuthError', code: reason, status: 403 })
    },
  )

  it.each([
    ['subject_has_goal', 409],
    ['start_month_changed', 409],
    ['organization_closing', 409],
    ['invalid_target', 400],
  ] as const)('answers %s with HTTP %i', async (code, status) => {
    mocks.set.mockRejectedValue(new GoalProgramError(code))

    await expect(
      withStartContext(() => setMonthlyPortalGoal({ data: use })),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code, status })
  })
})
