// Goal context — server function handler invocation tests (B5)
// Imports and invokes the actual createServerFn handler (not just error-mapping helpers).
// Verifies the full chain: input → auth resolution → permission gate → use case → return / error mapping.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ok, err } from '#/shared/domain'

// ── TanStack Start context setup ──────────────────────────────────
// createServerFn's middleware chain reads startOptions from a global ALS.
// In tests (no server runtime), we must seed it before invoking handlers.
const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function ensureStartALS(): AsyncLocalStorage<unknown> {
  const g = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  if (!g[START_KEY]) g[START_KEY] = new AsyncLocalStorage()
  return g[START_KEY]!
}
/** Wraps a server-fn call so the TanStack Start middleware chain can read startOptions. */
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  return ensureStartALS().run({ startOptions: {} }, fn)
}

// Stable mock functions so we can control return values per-test.
const mocks = vi.hoisted(() => ({
  getGoal: vi.fn(),
  resolveTenantContext: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
  clearTenantCache: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    useCases: {
      getGoal: mocks.getGoal,
    },
  })),
}))

import { getGoal } from '#/contexts/goal/server/goals'

const TEST_CTX = {
  userId: 'user-test-1',
  organizationId: 'org-test-aaaa',
  role: 'AccountAdmin',
} as const

describe('getGoal handler (executable)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(TEST_CTX)
  })

  it('invokes the getGoal use case with the caller organizationId and role', async () => {
    const fakeGoalDetail = {
      goal: { id: 'goal-1', name: 'Test Goal' },
      progress: null,
    }
    mocks.getGoal.mockResolvedValue(ok(fakeGoalDetail))

    await withStartContext(() => getGoal({ data: { goalId: 'goal-1' } }))

    // The handler converts the raw string goalId to a branded ID and
    // passes the caller's organizationId + role to the use case
    expect(mocks.getGoal).toHaveBeenCalledTimes(1)
    const [input, ctx] = mocks.getGoal.mock.calls[0]!
    expect(input.goalId).toBeTruthy()
    expect(ctx.organizationId).toBe('org-test-aaaa')
    expect(ctx.role).toBe('AccountAdmin')
  })

  it('throws a 404 ServerFunctionError when the use case returns goal_not_found', async () => {
    mocks.getGoal.mockResolvedValue(err({ tag: 'goal_not_found' }))

    await expect(
      withStartContext(() => getGoal({ data: { goalId: 'missing' } })),
    ).rejects.toMatchObject({
      name: 'GoalError',
      code: 'not_found',
      status: 404,
    })
  })

  it('throws a 403 ServerFunctionError when the use case returns forbidden', async () => {
    mocks.getGoal.mockResolvedValue(err({ tag: 'forbidden' }))

    await expect(
      withStartContext(() => getGoal({ data: { goalId: 'goal-1' } })),
    ).rejects.toMatchObject({
      name: 'GoalError',
      code: 'forbidden',
      status: 403,
    })
  })

  it('throws 403 before reaching the use case when the role lacks goal.read', async () => {
    // Guest does not have goal.read permission
    mocks.resolveTenantContext.mockResolvedValue({
      ...TEST_CTX,
      role: 'Guest' as never,
    })

    await expect(
      withStartContext(() => getGoal({ data: { goalId: 'goal-1' } })),
    ).rejects.toMatchObject({
      name: 'GoalError',
      code: 'forbidden',
      status: 403,
    })

    // The use case must never be called — the permission gate short-circuits
    expect(mocks.getGoal).not.toHaveBeenCalled()
  })
})
