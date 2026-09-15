import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { GoogleProviderRouteDescriptor } from '#/shared/google-provider-control/route-catalogue'
import {
  createGetPropertyGooglePerformance,
  type GooglePerformanceAuthorizationSnapshot,
} from '../../application/get-property-google-performance'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderAdmissionCode,
  GoogleProviderExecutionResult,
} from '../../application/ports/google-authorized-provider-executor.port'
import type { GoogleProviderDispatch } from '#/shared/google-provider-control/egress-gateway'
import {
  isGbpApiError,
  type GbpApiDispatch,
  type GbpApiError,
} from '../../domain/gbp-api-error'
import {
  executeGoogleProviderJson,
  executeGoogleProviderRaw,
} from './google-provider-adapter'

const NOW_MS = 1_800_000_000_000
const ORG_ID = organizationId('org-1')
const PROPERTY_ID = propertyId('11111111-1111-4111-8111-111111111111')
const CONNECTION_ID = googleConnectionId('22222222-2222-4222-8222-222222222222')
const ACTOR: AuthContext = Object.freeze({
  userId: userId('user-1'),
  organizationId: ORG_ID,
  role: 'AccountAdmin',
  effectivePermissions: new Set(['property.read'] as const),
  scopeByPermission: new Map(),
})
const AUTHORIZATION: GoogleProviderCallAuthorization = Object.freeze({
  capability: 'property.read_gbp_performance',
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  initiatorUserId: ACTOR.userId,
  expectedCredentialGeneration: 6,
  authorizationVector: Object.freeze({ credentialGeneration: 6 }),
})
const DESCRIPTOR: GoogleProviderRouteDescriptor = Object.freeze({
  routeKey: 'account-management.accounts.list',
  accessToken: 'access-token',
})
const SNAPSHOT: GooglePerformanceAuthorizationSnapshot = Object.freeze({
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  locationId: 'locations/456',
  timezone: 'America/New_York',
  sourceEpoch: 7,
  profileVersion: 8,
  connectionLifecycleVersion: 4,
  connectionAccessVersion: 5,
  credentialGeneration: 6,
  authorizationVector: Object.freeze({ credentialGeneration: 6 }),
  authorizationVectorSha256: 'a'.repeat(64),
  authorizationFenceSha256: 'f'.repeat(64),
  principalHmacKeyVersion: 'v1',
  principalHmac: 'c'.repeat(43),
})

function jsonBody(): Uint8Array {
  return new TextEncoder().encode('{"accounts":[]}')
}

function executorReturning(
  result: GoogleProviderExecutionResult,
): GoogleAuthorizedProviderExecutor {
  return { execute: async () => result }
}

function providerResponse(
  status: number,
  retryAfter: string | null,
): GoogleProviderExecutionResult {
  return {
    ok: true,
    status,
    headers: { contentType: 'application/json', cacheControl: null, retryAfter },
    body: jsonBody(),
  }
}

function admissionDenied(
  admissionCode: GoogleProviderAdmissionCode,
  retryAfterMs = 0,
): GoogleProviderExecutionResult {
  return {
    ok: false,
    code: 'admission_denied',
    admissionCode,
    dispatch: 'not_sent',
    retryAfterMs,
  }
}

async function providerError(
  result: GoogleProviderExecutionResult,
): Promise<GbpApiError> {
  try {
    await executeGoogleProviderRaw({
      operation: 'fetchPerformanceReport',
      descriptor: DESCRIPTOR,
      authorization: AUTHORIZATION,
      executor: executorReturning(result),
      nowMs: () => NOW_MS,
    })
  } catch (error) {
    if (isGbpApiError(error)) return error
    throw error
  }
  throw new Error('expected the provider call to reject')
}

/** The exact state the property performance surface renders for that failure. */
async function userVisible(result: GoogleProviderExecutionResult) {
  const error = await providerError(result)
  const getPerformance = createGetPropertyGooglePerformance({
    authorize: async () => ({
      ok: true,
      snapshot: SNAPSHOT,
      accessToken: 'access-token',
    }),
    fetchReport: async () => {
      throw error
    },
    issueLease: async () => {
      throw new Error('no lease is issued for a failed provider call')
    },
    clock: () => new Date('2026-03-09T12:00:00.000Z'),
    monotonicNowMs: () => 0,
  })
  return getPerformance({ propertyId: PROPERTY_ID, preset: '7d', actor: ACTOR })
}

describe('executeGoogleProviderRaw retry hints', () => {
  it('floors a 429 with no Retry-After onto a real wait', async () => {
    const error = await providerError(providerResponse(429, null))

    expect(error.kind).toBe('rate_limited')
    expect(error.retryAfterMs).toBe(5_000)
    await expect(userVisible(providerResponse(429, null))).resolves.toEqual({
      status: 'error',
      errorCode: 'rate_limited',
      retryable: true,
      retryAfterSeconds: 5,
    })
  })

  it('floors a below-minimum provider hint and preserves a longer one', async () => {
    await expect(providerError(providerResponse(429, '2'))).resolves.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 5_000,
    })
    await expect(providerError(providerResponse(429, '120'))).resolves.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 120_000,
    })
    await expect(providerError(providerResponse(429, '600'))).resolves.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 300_000,
    })
  })

  it('gives a transient upstream failure a wait instead of an instant retry', async () => {
    await expect(providerError(providerResponse(503, null))).resolves.toMatchObject({
      kind: 'upstream_error',
      retryAfterMs: 5_000,
    })
    await expect(userVisible(providerResponse(503, null))).resolves.toEqual({
      status: 'error',
      errorCode: 'temporarily_unavailable',
      retryable: true,
      retryAfterSeconds: 5,
    })
  })

  it('leaves a non-retryable rejection without a wait', async () => {
    await expect(providerError(providerResponse(403, null))).resolves.toMatchObject({
      kind: 'permission_denied',
      retryAfterMs: null,
    })
  })
})

describe('executeGoogleProviderRaw admission classification', () => {
  it('keeps real provider quota pressure rate limited with a floored wait', async () => {
    await expect(
      providerError(admissionDenied('quota_exhausted')),
    ).resolves.toMatchObject({ kind: 'rate_limited', retryAfterMs: 5_000 })
    await expect(
      providerError(admissionDenied('in_flight_exhausted', 9_000)),
    ).resolves.toMatchObject({ kind: 'rate_limited', retryAfterMs: 9_000 })
  })

  it('keeps a current authorization denial non-retryable', async () => {
    const error = await providerError(admissionDenied('authorization_denied'))

    expect(error.kind).toBe('permission_denied')
    await expect(userVisible(admissionDenied('authorization_denied'))).resolves.toEqual({
      status: 'error',
      errorCode: 'provider_rejected',
      retryable: false,
      retryAfterSeconds: null,
    })
  })

  it.each([
    ['credential_unavailable'],
    ['runtime_unavailable'],
    ['authorization_changed'],
  ] as const)(
    'preserves the own-side %s denial for a fresh authorization request',
    async (admissionCode) => {
      const error = await providerError(admissionDenied(admissionCode))

      expect(error.executionAdmissionCode).toBe(admissionCode)
      await expect(userVisible(admissionDenied(admissionCode))).resolves.toEqual({
        status: 'error',
        errorCode: 'authorization_stale',
        retryable: true,
        retryAfterSeconds: null,
      })
    },
  )

  it('retains no provider content in a classified failure', async () => {
    const error = await providerError(admissionDenied('authorization_changed'))

    expect(JSON.stringify(error)).not.toContain('access-token')
    expect(JSON.stringify(error)).not.toContain(CONNECTION_ID)
  })
})

// The reply publication workflow decides whether a failed write is safe to
// repeat from this evidence alone (CONTRACT-REPLY D2), so each path pins what
// the executor actually proved about the request reaching Google.
describe('executeGoogleProviderRaw dispatch evidence', () => {
  it('keeps the domain dispatch union identical to the gateway union', () => {
    // The domain may not import shared/google-provider-control, so it declares
    // its own copy; a drift would let a new gateway value vanish at this seam.
    expectTypeOf<GbpApiDispatch>().toEqualTypeOf<GoogleProviderDispatch>()
  })

  it('carries a not_sent executor rejection with its execution code', async () => {
    const error = await providerError({
      ok: false,
      code: 'malformed_request',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })

    expect(error).toMatchObject({
      kind: 'parse_error',
      dispatch: 'not_sent',
      executionCode: 'malformed_request',
    })
    expect(error.providerStatus).toBeUndefined()
  })

  it('carries an answered executor rejection with the provider status', async () => {
    await expect(
      providerError({
        ok: false,
        code: 'response_too_large',
        dispatch: 'answered',
        providerStatus: 502,
        retryAfterMs: 0,
      }),
    ).resolves.toMatchObject({
      dispatch: 'answered',
      executionCode: 'response_too_large',
      providerStatus: 502,
    })
  })

  it('reports answered with the status for a provider 404', async () => {
    await expect(providerError(providerResponse(404, null))).resolves.toMatchObject({
      kind: 'upstream_error',
      dispatch: 'answered',
      providerStatus: 404,
    })
  })

  it('reports answered with status 200 for a non-JSON success', async () => {
    const error = await providerError({
      ok: true,
      status: 200,
      headers: { contentType: 'text/html', cacheControl: null, retryAfter: null },
      body: new TextEncoder().encode('<html></html>'),
    })

    expect(error).toMatchObject({
      kind: 'parse_error',
      dispatch: 'answered',
      providerStatus: 200,
    })
  })

  it('reports answered with status 200 when a JSON success does not decode', async () => {
    const rejection = executeGoogleProviderJson({
      operation: 'listAccounts',
      descriptor: DESCRIPTOR,
      authorization: AUTHORIZATION,
      executor: executorReturning({
        ok: true,
        status: 200,
        headers: {
          contentType: 'application/json',
          cacheControl: null,
          retryAfter: null,
        },
        body: new TextEncoder().encode('{"accounts":'),
      }),
      nowMs: () => NOW_MS,
    })

    await expect(rejection).rejects.toMatchObject({
      _tag: 'GbpApiError',
      kind: 'parse_error',
      dispatch: 'answered',
      providerStatus: 200,
    })
  })

  it('reports not_sent when validation fails before the executor is called', async () => {
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>()
    const rejection = executeGoogleProviderRaw({
      operation: 'listAccounts',
      descriptor: DESCRIPTOR,
      authorization: AUTHORIZATION,
      executor: { execute },
      nowMs: () => Number.NaN,
    })

    await expect(rejection).rejects.toMatchObject({
      _tag: 'GbpApiError',
      dispatch: 'not_sent',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reports unknown when the executor throws', async () => {
    const rejection = executeGoogleProviderRaw({
      operation: 'listAccounts',
      descriptor: DESCRIPTOR,
      authorization: AUTHORIZATION,
      executor: {
        execute: async () => {
          throw new Error('executor crashed')
        },
      },
      nowMs: () => NOW_MS,
    })

    await expect(rejection).rejects.toMatchObject({
      _tag: 'GbpApiError',
      kind: 'upstream_error',
      dispatch: 'unknown',
    })
  })

  describe('when the adapter deadline elapses', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('reports unknown even though the request is sent after the deadline', async () => {
      // The gateway does not observe the adapter's abort signal, so a request
      // can still leave after the adapter stopped waiting. A late `not_sent`
      // (or no result at all) must never be read as proof.
      const lateFetch = vi.fn()
      const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              lateFetch()
              resolve(providerResponse(200, null))
            }, 20_000)
          }),
      )
      const rejection = executeGoogleProviderRaw({
        operation: 'listAccounts',
        descriptor: DESCRIPTOR,
        authorization: AUTHORIZATION,
        executor: { execute },
        nowMs: () => NOW_MS,
      })
      const settled = rejection.catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(15_000)
      const error = await settled
      await vi.advanceTimersByTimeAsync(5_000)

      expect(lateFetch).toHaveBeenCalledTimes(1)
      expect(isGbpApiError(error)).toBe(true)
      expect(error).toMatchObject({ kind: 'upstream_error', dispatch: 'unknown' })
    })
  })
})
