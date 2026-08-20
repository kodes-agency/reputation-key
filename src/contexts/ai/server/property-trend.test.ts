// AI context — `getPropertyAiTrendFn` server function contract tests.
//
// SEAM. The module exports only the wrapped `createServerFn` value, and invoking
// that value directly (the seam in google-performance.test.ts) cannot observe the
// handler's return value: without the Start vite transform, `.handler(fn)` receives
// one argument, so the framework stores `fn` as `extractedFn` and leaves `serverFn`
// undefined — the client middleware branch discards the resolved value and yields
// `undefined`. Return-value contracts are exactly what this module owes the UI, so
// `@tanstack/react-start` is mocked with a minimal builder that reproduces the
// production order read off createServerFn.js: standard-schema validation first,
// then the handler, then the handler's value returned. `tracedHandler`,
// `catchUntagged` and the real zod DTO all stay unmocked.
//
// Pure unit tests — no database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import type { AiTrendReportRead } from '#/contexts/ai/application/ports/ai-output-store.port'
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
  readPropertyAiTrend: vi.fn(),
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
      inputValidator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        seam.method = options?.method ?? 'GET'
        return async (opts: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no inputValidator')
          // Mirrors execValidator: validation precedes the handler, and a failure
          // surfaces as a plain Error the handler never sees.
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
    useCases: { readPropertyAiTrend: mocks.readPropertyAiTrend },
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

import { getPropertyAiTrendFn } from './property-trend'
import { ServerFunctionError } from '#/shared/auth/server-errors'

// ── Sourced fixtures ────────────────────────────────────────────────
// The report profile version is read off the compiled operation catalogue, never
// pasted: a catalogue repin must not silently diverge from this fixture.
const TREND_PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === 'property-trend-v1',
)!

/** Compile-time sourced: a typo no longer type-checks against the union. */
const TRENDS_READ: Permission = 'ai.trends.read'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000011'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000012'

const ACTOR = {
  organizationId: ORGANIZATION_ID,
  userId: 'user-trend-1',
  role: 'AccountAdmin',
} as unknown as AuthContext

/** A never-generated trend on a never-edited property: every epoch sits at 0. */
const NEVER_EDITED_EPOCHS = {
  sourceEpoch: 0,
  reviewAnalysisEpoch: 0,
  propertyTrendsEpoch: 0,
  propertyProfileVersion: 0,
} as const

const call = (propertyId: string = PROPERTY_ID) =>
  getPropertyAiTrendFn({ data: { propertyId } })

/** Deliberately malformed payloads bypass the input type to reach the DTO. */
const callUnchecked = (data: unknown) =>
  getPropertyAiTrendFn({ data } as Parameters<typeof getPropertyAiTrendFn>[0])

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
  mocks.readPropertyAiTrend.mockResolvedValue({ status: 'disabled' })
})

describe('getPropertyAiTrendFn — tenant + gate wiring', () => {
  it('is declared as a GET read', () => {
    expect(seam.method).toBe('GET')
  })

  it('reads the trend for exactly the resolved tenant, never the client payload', async () => {
    await call()

    // organizationId and actorUserId come from resolveTenantContext — the caller
    // cannot name another tenant, and propertyId is the only client-supplied input.
    expect(mocks.readPropertyAiTrend).toHaveBeenCalledTimes(1)
    expect(mocks.readPropertyAiTrend).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: ACTOR.userId,
    })
  })

  it('gates on the ai.trends.read permission scoped to the requested property', async () => {
    await call()

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: TRENDS_READ,
      propertyId: PROPERTY_ID,
    })
  })

  it('never reaches the read model when the execution policy denies', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        'Authorization denied: permission_denied',
        'permission_denied',
        403,
      ),
    )

    await expect(call()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'permission_denied',
      status: 403,
    })
    expect(mocks.readPropertyAiTrend).not.toHaveBeenCalled()
  })
})

describe('getPropertyAiTrendFn — read-model states reach the client intact', () => {
  it('returns the ready report verbatim, including the catalogued profile version', async () => {
    const read: AiTrendReportRead = {
      status: 'ready',
      ...NEVER_EDITED_EPOCHS,
      dueLocalDate: '2026-08-20',
      terminalAnalysisSequence: 1,
      aggregateRevision: 1,
      reportProfileVersion: TREND_PROFILE.profileVersion,
      report: {
        signalKey: 'sentiment.negative',
        direction: 'declining',
        confidenceBasisPoints: 0,
        supportingReviewCount: 3,
        headline: 'Review signals need attention',
        sentences: [],
      },
      generatedAtEpochMillis: 0,
    }
    mocks.readPropertyAiTrend.mockResolvedValue(read)

    const result = await call()

    // The server function is a pass-through: it must not reshape, re-key or
    // default any field of the read model.
    expect(result).toEqual(read)
    expect(result).toMatchObject({
      reportProfileVersion: TREND_PROFILE.profileVersion,
      report: { confidenceBasisPoints: 0, sentences: [] },
    })
  })

  it.each<[string, AiTrendReportRead]>([
    ['disabled', { status: 'disabled' }],
    ['preparing', { status: 'preparing', ...NEVER_EDITED_EPOCHS }],
    [
      'snapshot_superseded',
      {
        status: 'snapshot_superseded',
        ...NEVER_EDITED_EPOCHS,
        terminalAnalysisSequence: 0,
        aggregateRevision: 0,
      },
    ],
    [
      'insufficient_data',
      {
        status: 'insufficient_data',
        ...NEVER_EDITED_EPOCHS,
        dueLocalDate: '2026-08-20',
        terminalAnalysisSequence: 0,
        aggregateRevision: 0,
      },
    ],
    [
      'no_material_change',
      {
        status: 'no_material_change',
        ...NEVER_EDITED_EPOCHS,
        dueLocalDate: '2026-08-20',
        terminalAnalysisSequence: 0,
        aggregateRevision: 0,
      },
    ],
  ])(
    'surfaces the %s state as a resolved value, not an error, with epoch 0 preserved',
    async (_name, read) => {
      mocks.readPropertyAiTrend.mockResolvedValue(read)

      const result = await call()

      // These are degradations, not failures: turning any of them into a thrown
      // 4xx/5xx would leave the property page with an error instead of a state.
      expect(result).toEqual(read)
      if ('sourceEpoch' in read) {
        expect(result).toMatchObject(NEVER_EDITED_EPOCHS)
      }
    },
  )
})

describe('getPropertyAiTrendFn — failure surfaces', () => {
  it('masks an untagged read failure as a generic 500 and leaks no detail', async () => {
    mocks.readPropertyAiTrend.mockRejectedValue(
      new Error('select * from ai_trend_reports failed: connection terminated'),
    )

    const error = await rejection(call())

    expect(error).toBeInstanceOf(ServerFunctionError)
    expect(error).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
    expect((error as Error).message).not.toContain('ai_trend_reports')
  })

  it('preserves a tagged read-model error instead of collapsing it to 500', async () => {
    mocks.readPropertyAiTrend.mockRejectedValue(
      new ServerFunctionError('AiError', 'Trend lease expired', 'lease_expired', 409),
    )

    await expect(call()).rejects.toMatchObject({
      name: 'AiError',
      code: 'lease_expired',
      status: 409,
    })
  })

  it('masks a tenant-resolution failure before the gate or read model runs', async () => {
    mocks.resolveTenantContext.mockRejectedValue(new Error('session store offline'))

    await expect(call()).rejects.toMatchObject({
      name: 'InternalError',
      status: 500,
    })
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
    expect(mocks.readPropertyAiTrend).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-UUID propertyId', { propertyId: 'nope' }],
    ['a missing propertyId', {}],
    ['a numeric propertyId', { propertyId: 1 }],
  ])('rejects %s before any tenant or policy work', async (_name, data) => {
    // Message pattern, not a bare toThrow: the DTO must reject on the propertyId
    // path specifically, so a validator that started passing malformed ids while
    // failing for some other reason would not satisfy this.
    await expect(callUnchecked(data)).rejects.toThrow(/"path":\["propertyId"\]/)

    // Malformed input must not reach session resolution, the policy gate or the
    // read model — the DTO is the outermost fence.
    expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
    expect(mocks.readPropertyAiTrend).not.toHaveBeenCalled()
  })
})
