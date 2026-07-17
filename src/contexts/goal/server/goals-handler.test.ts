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

vi.mock('#/shared/observability/logger', () => {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return { getLogger: () => logger }
})

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
  clearTenantCache: vi.fn(),
}))
vi.mock('#/shared/auth/beta-capabilities', () => ({
  assertBetaCapability: vi.fn(),
  checkBetaCapability: vi.fn(() => ({
    allowed: true,
    reason: 'allowed',
    capability: 'goal.use',
  })),
  BetaCapabilityError: class BetaCapabilityError extends Error {},
}))

// BQC-2.6: ExecutionPolicy seam — default allow; permission-deny tests override.
const requireExecutionAllowedMock = vi.hoisted(() => vi.fn())
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/shared/auth/execution-policy')>()
  return {
    ...actual,
    requireExecutionAllowed: requireExecutionAllowedMock,
  }
})

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    useCases: {
      getGoal: mocks.getGoal,
    },
  })),
}))

import { getGoal } from '#/contexts/goal/server/goals'
import { ServerFunctionError } from '#/shared/auth/server-errors'

const TEST_CTX = {
  userId: 'user-test-1',
  organizationId: 'org-test-aaaa',
  role: 'AccountAdmin',
} as const

describe('getGoal handler (executable)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(TEST_CTX)
    requireExecutionAllowedMock.mockImplementation(() => {})
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
    expect(requireExecutionAllowedMock).toHaveBeenCalled()
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

  it('throws 403 before reaching the use case when authorize denies', async () => {
    requireExecutionAllowedMock.mockImplementation(() => {
      throw new ServerFunctionError(
        'AuthError',
        'Authorization denied: permission_denied',
        'permission_denied',
        403,
      )
    })

    await expect(
      withStartContext(() => getGoal({ data: { goalId: 'goal-1' } })),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'permission_denied',
      status: 403,
    })

    // The use case must never be called — the authorize gate short-circuits
    expect(mocks.getGoal).not.toHaveBeenCalled()
  })
})
