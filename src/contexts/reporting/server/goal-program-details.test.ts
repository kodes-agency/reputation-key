import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalExecutionPolicy } from '../application/use-cases/goal-programs'

const mocks = vi.hoisted(() => ({
  rename: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({ goalPublicApi: { programs: { rename: mocks.rename } } }),
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

import { GoalProgramError } from '../application/use-cases/goal-programs'
import { renameGoalProgram } from './goal-program-details'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const actor = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'manager-1',
  role: 'AccountAdmin',
} as const
const input = {
  propertyId: PROPERTY_ID,
  programId: '00000000-0000-4000-8000-000000000004',
  name: 'Lobby scans',
}

describe('Goal Program details server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('forwards a rename to Reporting under the request policy of the Goal commands', async () => {
    mocks.rename.mockResolvedValue({ id: input.programId, name: 'Lobby scans' })

    await withStartContext(() => renameGoalProgram({ data: input }))

    expect(mocks.rename).toHaveBeenCalledWith(expect.any(Object), input, actor)
    const policy = mocks.rename.mock.calls[0]?.[0] as GoalExecutionPolicy
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
    ['invalid_name', 400],
    ['not_found', 404],
    ['invalid_transition', 409],
    ['revision_conflict', 409],
  ] as const)('answers a rename refused with %s as %i', async (code, status) => {
    mocks.rename.mockRejectedValue(new GoalProgramError(code))

    await expect(
      withStartContext(() => renameGoalProgram({ data: input })),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code, status })
  })
})
