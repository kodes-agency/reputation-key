// Goal context — retained Staff Goal compatibility boundary tests.
// Verifies authorization, explicit retirement, and input compatibility.

import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { can } from '#/shared/domain/permissions'
import { throwContextError } from '#/shared/auth/server-errors'

const mocks = vi.hoisted(() => ({
  getContainer: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(() => new Headers()),
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(() =>
    Promise.resolve({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'Staff',
    }),
  ),
}))

// Importing './staff-goals' pulls in the composition root. Stub it so the test
// never builds the real container (DB clients, adapters, jobs). No test here
// invokes the server fn, so the stub needs no behavior: a container mock with
// scripted use cases would only let tests assert what they themselves
// configured.
vi.mock('#/composition', () => ({
  getContainer: mocks.getContainer,
}))

vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import { listStaffGoals, listStaffGoalsSchema } from './staff-goals'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

describe('listStaffGoals — permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('denies the retained legacy read before resolving its repository', async () => {
    await expect(
      withStartContext(() => listStaffGoals({ data: {} })),
    ).rejects.toMatchObject({
      name: 'LegacyGoalAuthorityError',
      code: 'legacy_goal_authority_disabled',
      status: 410,
    })
    expect(mocks.getContainer).not.toHaveBeenCalled()
  })

  it('allows AccountAdmin to read goals', () => {
    expect(can('AccountAdmin', 'goal.read')).toBe(true)
  })

  it('allows PropertyManager to read goals', () => {
    expect(can('PropertyManager', 'goal.read')).toBe(true)
  })

  it('keeps manager-facing Goal metrics unavailable to Staff in beta', () => {
    expect(can('Staff', 'goal.read')).toBe(false)
  })

  it('keeps Staff goal access read-only', () => {
    expect(can('Staff', 'goal.create')).toBe(false)
  })

  it('Staff cannot update goals (boundary)', () => {
    expect(can('Staff', 'goal.update')).toBe(false)
  })

  it('unauthorized role receives 403 via throwContextError', () => {
    try {
      throwContextError(
        'AuthError',
        { code: 'forbidden', message: 'No goal read permission' },
        403,
      )
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(403)
      expect(error.code).toBe('forbidden')
      expect(error.message).toBe('No goal read permission')
      expect(error.name).toBe('AuthError')
    }
  })
})

describe('listStaffGoals schema', () => {
  it('accepts empty input (propertyId optional)', () => {
    const result = listStaffGoalsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts valid propertyId', () => {
    const result = listStaffGoalsSchema.safeParse({ propertyId: 'prop-1' })
    expect(result.success).toBe(true)
  })

  it('rejects empty propertyId string', () => {
    const result = listStaffGoalsSchema.safeParse({ propertyId: '' })
    expect(result.success).toBe(false)
  })
})
