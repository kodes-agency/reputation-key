// Portal context — server function handler invocation tests (B5)
// Imports and invokes the actual createServerFn handler (not just error-mapping helpers).
// Verifies the full chain: input → auth resolution → use case → return.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'

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
  listPortals: vi.fn(),
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
      listPortals: mocks.listPortals,
    },
  })),
}))

import { listPortals } from '#/contexts/portal/server/portals'

const TEST_CTX = {
  userId: 'user-test-1',
  organizationId: 'org-test-aaaa',
  role: 'AccountAdmin',
} as const

describe('listPortals handler (executable)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(TEST_CTX)
  })

  it('resolves auth context and invokes the listPortals use case with caller context', async () => {
    const fakePortals = [
      { id: 'p1', name: 'Portal 1' },
      { id: 'p2', name: 'Portal 2' },
    ]
    mocks.listPortals.mockResolvedValue(fakePortals)

    await withStartContext(() => listPortals({ data: {} }))

    // The handler resolves auth from request headers
    expect(mocks.resolveTenantContext).toHaveBeenCalledTimes(1)

    // The handler passes the validated data + resolved auth context to the use case
    expect(mocks.listPortals).toHaveBeenCalledTimes(1)
    const [dataArg, ctxArg] = mocks.listPortals.mock.calls[0]!
    expect(dataArg).toEqual({})
    expect(ctxArg.organizationId).toBe('org-test-aaaa')
    expect(ctxArg.role).toBe('AccountAdmin')
  })

  it('passes the propertyId filter through to the use case', async () => {
    mocks.listPortals.mockResolvedValue([])

    await withStartContext(() => listPortals({ data: { propertyId: 'prop-test-1' } }))

    const [dataArg] = mocks.listPortals.mock.calls[0]!
    expect(dataArg).toEqual({ propertyId: 'prop-test-1' })
  })
})
