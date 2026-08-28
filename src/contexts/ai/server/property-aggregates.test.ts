// AI context — `getPropertyAiAggregatesFn` server function contract tests.
//
// SEAM. Same seam as property-trend.test.ts, for the same reason: the module
// exports only the wrapped `createServerFn` value, and invoking it directly
// cannot observe the handler's return value without the Start vite transform. So
// `@tanstack/react-start` is mocked with a minimal builder reproducing the
// production order — standard-schema validation first, then the handler, then the
// handler's value returned. `tracedHandler`, `catchUntagged` and the real zod DTO
// stay unmocked.
//
// Pure unit tests — no database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecutionPolicyModule from '#/shared/auth/execution-policy'
import type * as LoggerModule from '#/shared/observability/logger'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

/** The `~standard` surface createServerFn's execValidator prefers. */
type StandardValidator = Readonly<{
  '~standard': Readonly<{
    validate: (
      input: unknown,
    ) =>
      | Promise<{ value?: unknown; issues?: ReadonlyArray<unknown> }>
      | { value?: unknown; issues?: ReadonlyArray<unknown> }
  }>
}>

const mocks = vi.hoisted(() => ({
  readPropertyAiAggregates: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  headersFromContext: vi.fn(),
}))

/** Declared HTTP method, captured from the module's own createServerFn call. */
const seam = vi.hoisted(() => ({ method: null as string | null }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        seam.method = options?.method ?? 'GET'
        return async (opts: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(opts.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
      },
    }
    return builder
  },
}))

vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>()
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return { ...actual, getLogger: () => logger }
})

vi.mock('#/composition', () => ({
  getContainer: () => ({
    aiPublicApi: { readPropertyAggregates: mocks.readPropertyAiAggregates },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headersFromContext,
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionPolicyModule>()
  return { ...actual, requireExecutionAllowed: mocks.requireExecutionAllowed }
})

import { getPropertyAiAggregatesFn } from './property-aggregates'

/**
 * Compile-time sourced, so a typo stops type-checking. This is `dashboard.read`
 * and NOT `ai.trends.read` deliberately: there is no analysis-read permission,
 * and `ai.trends.read` grants on `ai.detect_trends`, a capability unrelated to
 * the data this route returns. The AI capability gate lives in the use case.
 */
const DASHBOARD_READ: Permission = 'dashboard.read'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000021'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000022'

const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-agg-1',
  role: 'AccountAdmin',
} as unknown as AuthContext

const call = (propertyId: string = PROPERTY_ID) =>
  getPropertyAiAggregatesFn({ data: { propertyId } })

/** Deliberately malformed payloads bypass the input type to reach the DTO. */
const callUnchecked = (data: unknown) =>
  getPropertyAiAggregatesFn({ data } as Parameters<typeof getPropertyAiAggregatesFn>[0])

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  const outcome = await promise.then(
    (value) => ({ rejected: false as const, value }),
    (error: unknown) => ({ rejected: true as const, error }),
  )
  if (!outcome.rejected) {
    throw new Error(
      `expected a rejection, resolved with ${JSON.stringify(outcome.value)}`,
    )
  }
  return outcome.error
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.readPropertyAiAggregates.mockResolvedValue({ status: 'disabled' })
})

describe('getPropertyAiAggregatesFn — tenant + gate wiring', () => {
  it('is declared as a GET read', () => {
    expect(seam.method).toBe('GET')
  })

  it('reads for exactly the resolved tenant, never the client payload', async () => {
    await call()

    // The organization comes from the session, not the request body: a client
    // cannot read another org's aggregates by asserting an organizationId.
    expect(mocks.readPropertyAiAggregates).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        actorUserId: ACTOR.userId,
      }),
    )
  })

  it('authorizes dashboard.read scoped to the requested property', async () => {
    await call()

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: DASHBOARD_READ,
        propertyId: PROPERTY_ID,
      }),
    )
  })

  it('authorizes before reading, so a denial never touches the container', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('denied'))

    await rejection(call())

    expect(mocks.readPropertyAiAggregates).not.toHaveBeenCalled()
  })

  it('requests a bounded window rather than an unbounded one', async () => {
    await call()

    // The window is a fixed count of PROPERTY-LOCAL days. An unbounded read
    // would scan every epoch of every day the property has existed.
    const input = mocks.readPropertyAiAggregates.mock.calls[0]?.[0] as {
      days: number
    }
    expect(Number.isSafeInteger(input.days)).toBe(true)
    expect(input.days).toBeGreaterThan(0)
    expect(input.days).toBeLessThanOrEqual(90)
  })
})

describe('getPropertyAiAggregatesFn — payload validation', () => {
  it('rejects a propertyId that is not a uuid before the handler runs', async () => {
    await rejection(callUnchecked({ propertyId: 'not-a-uuid' }))

    expect(mocks.readPropertyAiAggregates).not.toHaveBeenCalled()
    expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
  })

  it('rejects a missing propertyId', async () => {
    await rejection(callUnchecked({}))

    expect(mocks.readPropertyAiAggregates).not.toHaveBeenCalled()
  })
})

describe('getPropertyAiAggregatesFn — return contract', () => {
  it('returns the use case value unchanged', async () => {
    // The section renders straight off this value, so the server fn must not
    // reshape it.
    const ready = {
      status: 'ready',
      startLocalDate: '2026-07-22',
      endLocalDate: '2026-08-20',
      reviewCount: 3,
      categories: [{ category: 'service', count: 2 }],
      sentimentByDay: [
        { localDate: '2026-08-20', positive: 2, neutral: 0, negative: 1, mixed: 0 },
      ],
      sentimentTotals: { positive: 2, neutral: 0, negative: 1, mixed: 0 },
    }
    mocks.readPropertyAiAggregates.mockResolvedValue(ready)

    expect(await call()).toEqual(ready)
  })

  it('passes a disabled read straight through, so the UI can render nothing', async () => {
    expect(await call()).toEqual({ status: 'disabled' })
  })
})
