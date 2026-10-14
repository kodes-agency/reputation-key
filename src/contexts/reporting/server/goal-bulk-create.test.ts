import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalExecutionPolicy } from '../application/use-cases/goal-programs'

const mocks = vi.hoisted(() => ({
  createForSubjects: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: { programs: { createForSubjects: mocks.createForSubjects } },
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

import { GoalProgramError } from '../application/use-cases/goal-programs'
import { createGoalsForSubjects } from './goal-bulk-create'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const lobby = {
  kind: 'portal' as const,
  portalId: '00000000-0000-4000-8000-000000000003',
}
const northWing = {
  kind: 'portal_group' as const,
  portalGroupId: '00000000-0000-4000-8000-000000000004',
}
const actor = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
} as const
const save = {
  propertyId: PROPERTY_ID,
  metric: 'portal_rating_count' as const,
  startMonth: '2026-10',
  items: [
    { subject: lobby, targetValue: 40 },
    { subject: northWing, targetValue: 120 },
  ],
}

describe('the server function that sets goals for several subjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('forwards the save to the command with the request’s policy and actor', async () => {
    mocks.createForSubjects.mockResolvedValue({
      outcomes: [
        { subject: lobby, code: 'created', programId: 'program-1' },
        { subject: northWing, code: 'subject_has_goal' },
      ],
    })

    // A row that got no goal is an outcome: the call does not throw for it.
    await withStartContext(() => createGoalsForSubjects({ data: save }))

    expect(mocks.createForSubjects).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      save,
      actor,
    )
  })

  it('binds goal.use and the interactive permission to the resolved request', async () => {
    mocks.createForSubjects.mockResolvedValue({ outcomes: [] })
    await withStartContext(() => createGoalsForSubjects({ data: save }))
    const policy = mocks.createForSubjects.mock.calls[0]?.[0] as GoalExecutionPolicy

    await policy.authorize({
      actor,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'goal.create',
      capability: 'goal.use',
      propertyId: PROPERTY_ID,
    })

    await expect(
      policy.authorize({
        actor,
        organizationId: 'another-organization',
        propertyId: PROPERTY_ID,
        action: 'goal.create',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it.each([
    ['start_month_changed', 409],
    ['organization_closing', 409],
    ['duplicate_subject', 400],
    ['assignment_limit_exceeded', 400],
    ['invalid_subject', 400],
    ['forbidden', 403],
    ['not_found', 404],
  ] as const)('answers a save refused as a whole with %s as %i', async (code, status) => {
    mocks.createForSubjects.mockRejectedValue(new GoalProgramError(code))

    await expect(
      withStartContext(() => createGoalsForSubjects({ data: save })),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code, status })
  })
})
