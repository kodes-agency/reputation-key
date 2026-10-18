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
  addOptions: vi.fn(),
  addOne: vi.fn(),
  addEach: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: {
      programs: {
        monthlyPortalGoal: { card: mocks.card, page: mocks.page, set: mocks.set },
        portalGoalAdd: {
          options: mocks.addOptions,
          one: mocks.addOne,
          each: mocks.addEach,
        },
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
import {
  addPortalGoalSchema,
  addPortalGoalsSchema,
  monthlyPortalGoalPropertySchema,
} from '../application/dto/monthly-portal-goal.dto'
import { GoalProgramError } from '../application/use-cases/goal-programs'
import {
  addPortalGoal,
  addPortalGoals,
  getMonthlyPortalGoalCard,
  getMonthlyPortalGoalPage,
  getPortalGoalAddOptions,
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

describe('Add a portal goal (PG-20)', () => {
  const PORTAL_ID = '00000000-0000-4000-8000-000000000003'
  const one = {
    propertyId: PROPERTY_ID,
    subject: { kind: 'portal' as const, portalId: PORTAL_ID },
    metric: 'portal_rating_count' as const,
    targetValue: 22,
    startMonth: '2026-12',
    targetSource: 'recommended' as const,
  }
  const each = {
    propertyId: PROPERTY_ID,
    metric: 'portal_rating_count' as const,
    startMonth: '2026-12',
    items: [
      { portalId: PORTAL_ID, targetValue: 22, targetSource: 'recommended' as const },
    ],
  }

  /** Each command and the read ask `goal.create` first, as the use cases do. */
  const askingGoalCreate =
    <T>(answer: T) =>
    async (
      policy: GoalExecutionPolicy,
      data: Readonly<{ propertyId: string }>,
      actor: GoalActor,
    ) => {
      await policy.authorize({
        actor,
        organizationId: actor.organizationId,
        propertyId: data.propertyId,
        action: 'goal.create',
      })
      return answer
    }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(manager)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.addOptions.mockImplementation(askingGoalCreate({ onePortal: [] }))
    mocks.addOne.mockImplementation(askingGoalCreate({ program: { id: 'program-1' } }))
    mocks.addEach.mockImplementation(askingGoalCreate({ outcomes: [] }))
  })

  it.each<[string, () => Promise<unknown>, typeof mocks.addOne, object]>([
    [
      'getPortalGoalAddOptions',
      () => getPortalGoalAddOptions({ data: input }),
      mocks.addOptions,
      input,
    ],
    ['addPortalGoal', () => addPortalGoal({ data: one }), mocks.addOne, one],
    ['addPortalGoals', () => addPortalGoals({ data: each }), mocks.addEach, each],
  ])('%s authorizes through the execution policy', async (_name, call, use, data) => {
    await withStartContext(call)

    expect(use).toHaveBeenCalledWith(expect.any(Object), data, manager)
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

      await expect(
        withStartContext(() => addPortalGoals({ data: each })),
      ).rejects.toMatchObject({ name: 'AuthError', code: reason, status: 403 })
    },
  )

  it('takes a portal, a group or the average, and no more than 100 portals at once', () => {
    expect(addPortalGoalSchema.safeParse(one).success).toBe(true)
    expect(
      addPortalGoalSchema.safeParse({
        ...one,
        subject: { kind: 'property' },
        metric: 'portal_rating_average',
        targetValue: 4.5,
      }).success,
    ).toBe(true)
    expect(
      addPortalGoalSchema.safeParse({ ...one, subject: { kind: 'staff', staffId: 'x' } })
        .success,
    ).toBe(false)
    expect(
      addPortalGoalsSchema.safeParse({
        ...each,
        items: Array.from({ length: 101 }, () => each.items[0]),
      }).success,
    ).toBe(false)
    expect(
      addPortalGoalsSchema.safeParse({ ...each, metric: 'portal_rating_average' })
        .success,
    ).toBe(false)
  })
})
