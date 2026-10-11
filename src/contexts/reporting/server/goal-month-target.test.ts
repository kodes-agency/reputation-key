import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalExecutionPolicy } from '../application/use-cases/goal-programs'

const mocks = vi.hoisted(() => ({
  changeMonthTarget: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: { programs: { changeMonthTarget: mocks.changeMonthTarget } },
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

import { changeGoalMonthTargetSchema } from '../application/dto/goal-month-target.dto'
import { GoalProgramError } from '../application/use-cases/goal-programs'
import { changeGoalMonthTarget } from './goal-month-target'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const actor = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'manager-1',
  role: 'AccountAdmin',
} as const
const input = {
  propertyId: PROPERTY_ID,
  programId: '00000000-0000-4000-8000-000000000004',
  month: '2026-10',
  targetValue: 300,
  expectedTarget: 400,
  expectedVersion: 2,
  applyToFollowing: true,
}

describe('Goal month target server function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('forwards the change to Reporting under the request policy of the Goal commands', async () => {
    mocks.changeMonthTarget.mockResolvedValue({
      month: { previous: 400, next: 300 },
      following: { outcome: 'applied', startsAt: new Date('2026-11-01T00:00:00.000Z') },
    })

    await withStartContext(() => changeGoalMonthTarget({ data: input }))

    expect(mocks.changeMonthTarget).toHaveBeenCalledWith(expect.any(Object), input, actor)
    const policy = mocks.changeMonthTarget.mock.calls[0]?.[0] as GoalExecutionPolicy
    await policy.authorize({
      actor,
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      action: 'goal.update',
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'goal.update',
      capability: 'goal.use',
      propertyId: PROPERTY_ID,
    })
  })

  it.each([
    ['month_locked', 409],
    ['no_open_month', 409],
    ['revision_conflict', 409],
    ['invalid_transition', 409],
    ['invalid_target', 400],
    ['not_found', 404],
    ['forbidden', 403],
  ] as const)('answers a change refused with %s as %i', async (code, status) => {
    mocks.changeMonthTarget.mockRejectedValue(new GoalProgramError(code))

    await expect(
      withStartContext(() => changeGoalMonthTarget({ data: input })),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code, status })
  })

  it('does not leak an unexpected failure', async () => {
    mocks.changeMonthTarget.mockRejectedValue(new Error('connection reset by peer'))

    await expect(
      withStartContext(() => changeGoalMonthTarget({ data: input })),
    ).rejects.not.toThrow('connection reset by peer')
  })
})

describe('changeGoalMonthTargetSchema', () => {
  it('accepts a change with and without a note', () => {
    expect(changeGoalMonthTargetSchema.parse(input)).toEqual(input)
    expect(
      changeGoalMonthTargetSchema.parse({ ...input, note: '  Fewer guests  ' }),
    ).toEqual({ ...input, note: 'Fewer guests' })
    // A blank note is no note; the command stores none.
    expect(changeGoalMonthTargetSchema.parse({ ...input, note: '   ' })).toEqual({
      ...input,
      note: '',
    })
  })

  it.each([
    ['a month that is not a month key', { month: 'October' }],
    ['a month number past twelve', { month: '2026-13' }],
    ['a target that is not a number', { targetValue: Number.NaN }],
    [
      'an expected target that is not a number',
      { expectedTarget: Number.POSITIVE_INFINITY },
    ],
    ['a version that is not a positive whole number', { expectedVersion: 0 }],
    ['a missing answer about the months after', { applyToFollowing: undefined }],
    ['a note over 500 characters', { note: 'x'.repeat(501) }],
    ['a goal id that is not an id', { programId: 'goal-1' }],
  ])('refuses %s', (_label, patch) => {
    expect(changeGoalMonthTargetSchema.safeParse({ ...input, ...patch }).success).toBe(
      false,
    )
  })
})
