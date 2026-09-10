import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecutionPolicyModule from '#/shared/auth/execution-policy'
import type * as LoggerModule from '#/shared/observability/logger'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

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
  readPropertyInsights: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  headersFromContext: vi.fn(),
}))
const seam = vi.hoisted(() => ({ method: null as string | null }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (context: { data: unknown }) => Promise<unknown>) {
        seam.method = options?.method ?? 'GET'
        return async (options: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(options.data)
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
    aiPublicApi: { readPropertyInsights: mocks.readPropertyInsights },
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

import { getPropertyInsightsFn } from './property-insights'

const DASHBOARD_READ: Permission = 'dashboard.read'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000021'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000022'
const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-insights-1',
  role: 'AccountAdmin',
} as unknown as AuthContext

const call = () => getPropertyInsightsFn({ data: { propertyId: PROPERTY_ID, range: 90 } })

const callUnchecked = (data: unknown) =>
  getPropertyInsightsFn({ data } as Parameters<typeof getPropertyInsightsFn>[0])

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  const outcome = await promise.then(
    (value) => ({ rejected: false as const, value }),
    (error: unknown) => ({ rejected: true as const, error }),
  )
  if (!outcome.rejected) {
    throw new Error(`expected rejection, received ${JSON.stringify(outcome.value)}`)
  }
  return outcome.error
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.readPropertyInsights.mockResolvedValue({ status: 'preparing' })
})

describe('getPropertyInsightsFn tenant and gate wiring', () => {
  it('is a GET read scoped to the session tenant and one requested property', async () => {
    expect(seam.method).toBe('GET')

    await call()

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: DASHBOARD_READ,
      propertyId: PROPERTY_ID,
    })
    expect(mocks.readPropertyInsights).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: ACTOR.userId,
      range: 90,
    })
  })

  it('authorizes before touching the AI read', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('denied'))

    await rejection(call())

    expect(mocks.readPropertyInsights).not.toHaveBeenCalled()
  })
})

describe('getPropertyInsightsFn single-property payload', () => {
  it('rejects a property list so cross-property reads are structurally impossible', async () => {
    await rejection(
      callUnchecked({
        propertyId: PROPERTY_ID,
        propertyIds: [PROPERTY_ID],
        range: 90,
      }),
    )

    expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
    expect(mocks.readPropertyInsights).not.toHaveBeenCalled()
  })

  it.each([30, 90, 180, 'all'] as const)(
    'accepts the supported %s range',
    async (range) => {
      await getPropertyInsightsFn({ data: { propertyId: PROPERTY_ID, range } })

      expect(mocks.readPropertyInsights).toHaveBeenCalledWith(
        expect.objectContaining({ range }),
      )
    },
  )

  it('rejects an unbounded or malformed range before resolving the tenant', async () => {
    await rejection(callUnchecked({ propertyId: PROPERTY_ID, range: 365 }))

    expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
  })
})

describe('getPropertyInsightsFn return contract', () => {
  it('returns the use-case state unchanged', async () => {
    const disabled = { status: 'disabled' }
    mocks.readPropertyInsights.mockResolvedValue(disabled)

    await expect(call()).resolves.toBe(disabled)
  })
})
