// AI context — `getOrganizationAiSpendFn` server function contract tests.
//
// The organization AI overview reads this month's spend against the cap from
// here. It takes no payload on purpose: spend is an account-wide amount, so the
// Organization is the session's and `ai.manage` gates it at Organization level,
// with no Property to scope by. A client that names another Organization must
// still read its own.
//
// SEAM. Same seam as property-aggregates.test.ts, adapted to a server function
// that declares no validator: `@tanstack/react-start` is mocked with a minimal
// builder that runs the handler and returns its value, so the resolved amounts
// are observable. `tracedHandler` and `catchUntagged` stay unmocked, so the
// failure masking asserted below is the production path.
//
// Pure unit tests — no database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiOrganizationMonthSpend } from '#/contexts/ai/application/public-api'
import type * as ExecutionPolicyModule from '#/shared/auth/execution-policy'
import type { PolicyDenyReason } from '#/shared/auth/execution-policy'
import type * as LoggerModule from '#/shared/observability/logger'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

const mocks = vi.hoisted(() => ({
  readOrganizationAiSpend: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  headersFromContext: vi.fn(),
}))

/** What the module declared on its own createServerFn call. */
const seam = vi.hoisted(() => ({
  method: null as string | null,
  declaredValidator: false,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    const builder = {
      validator() {
        seam.declaredValidator = true
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        seam.method = options?.method ?? 'GET'
        return async (opts?: { data?: unknown }) => fn({ data: opts?.data })
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
    aiPublicApi: { readOrganizationAiSpend: mocks.readOrganizationAiSpend },
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

import { getOrganizationAiSpendFn } from './organization-ai-spend'
import { ServerFunctionError } from '#/shared/auth/server-function-error'

/** Compile-time sourced: a typo no longer type-checks against the union. */
const AI_MANAGE: Permission = 'ai.manage'
const PERMISSION_DENIED: PolicyDenyReason = 'permission_denied'

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000031'
const OTHER_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000032'

const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-spend-1',
  role: 'AccountAdmin',
} as unknown as AuthContext

/** Amounts only: micros settled and reserved against the month's cap. */
const SPEND: AiOrganizationMonthSpend = {
  monthStartEpochMillis: Date.UTC(2026, 8, 1),
  settledMicros: 1_250_000,
  reservedMicros: 40_000,
  capMicros: 25_000_000,
}

const call = () => getOrganizationAiSpendFn()

/** A payload the function never declared, sent the way a hostile client could. */
const callWithPayload = (data: unknown) =>
  getOrganizationAiSpendFn({ data } as unknown as Parameters<
    typeof getOrganizationAiSpendFn
  >[0])

/** Capture a rejection without letting a resolved call silently pass. */
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
  mocks.readOrganizationAiSpend.mockResolvedValue(SPEND)
})

describe('getOrganizationAiSpendFn — tenant and gate wiring', () => {
  it('is a GET read that declares no client payload', () => {
    expect(seam.method).toBe('GET')
    expect(seam.declaredValidator).toBe(false)
  })

  it('gates on ai.manage for the whole Organization, with no Property scope', async () => {
    await call()

    // Exact arguments: a propertyId here would turn an account-wide amount into
    // a Property-scoped read a PropertyManager grant could satisfy.
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: AI_MANAGE,
    })
  })

  it('reads the session Organization even when the client names another', async () => {
    await callWithPayload({ organizationId: OTHER_ORGANIZATION_ID })

    expect(mocks.readOrganizationAiSpend).toHaveBeenCalledTimes(1)
    expect(mocks.readOrganizationAiSpend).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
    })
  })

  it('resolves the tenant, then authorizes, then reads', async () => {
    await call()

    const [resolved] = mocks.resolveTenantContext.mock.invocationCallOrder
    const [authorized] = mocks.requireExecutionAllowed.mock.invocationCallOrder
    const [read] = mocks.readOrganizationAiSpend.mock.invocationCallOrder
    expect(resolved).toBeLessThan(authorized!)
    expect(authorized).toBeLessThan(read!)
  })

  it('surfaces a policy denial as 403 and never reaches the spend read', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        `Authorization denied: ${PERMISSION_DENIED}`,
        PERMISSION_DENIED,
        403,
      ),
    )

    await expect(call()).rejects.toMatchObject({
      name: 'AuthError',
      code: PERMISSION_DENIED,
      status: 403,
    })
    expect(mocks.readOrganizationAiSpend).not.toHaveBeenCalled()
  })
})

describe('getOrganizationAiSpendFn — return contract', () => {
  it('returns the month window unchanged, amounts only', async () => {
    const result = await call()

    // The overview renders straight off this value, so the server function must
    // not reshape, round or relabel it.
    expect(result).toBe(SPEND)
    expect(Object.keys(result).sort()).toEqual([
      'capMicros',
      'monthStartEpochMillis',
      'reservedMicros',
      'settledMicros',
    ])
  })
})

describe('getOrganizationAiSpendFn — failure surfaces', () => {
  it('masks an untagged store failure as a generic 500 and leaks no detail', async () => {
    mocks.readOrganizationAiSpend.mockRejectedValue(
      new Error('select * from ai_organization_cost_windows failed: connection reset'),
    )

    const error = await rejection(call())

    expect(error).toBeInstanceOf(ServerFunctionError)
    expect(error).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
    expect((error as Error).message).not.toContain('ai_organization_cost_windows')
  })

  it('preserves a tagged error from the read instead of collapsing it to 500', async () => {
    mocks.readOrganizationAiSpend.mockRejectedValue(
      new ServerFunctionError(
        'AiError',
        'AI spend is unavailable right now',
        'policy_unavailable',
        503,
      ),
    )

    await expect(call()).rejects.toMatchObject({
      name: 'AiError',
      code: 'policy_unavailable',
      status: 503,
    })
  })
})
