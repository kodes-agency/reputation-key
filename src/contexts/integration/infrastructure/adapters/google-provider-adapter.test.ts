import { describe, expect, it } from 'vitest'
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
import { isGbpApiError, type GbpApiError } from '../../domain/gbp-api-error'
import { executeGoogleProviderRaw } from './google-provider-adapter'

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
  return { ok: false, code: 'admission_denied', admissionCode, retryAfterMs }
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

  it.each([['authorization_changed'], ['authorization_denied']] as const)(
    'reports %s as a rejected authorization rather than a retryable outage',
    async (admissionCode) => {
      const error = await providerError(admissionDenied(admissionCode))

      expect(error.kind).toBe('permission_denied')
      await expect(userVisible(admissionDenied(admissionCode))).resolves.toEqual({
        status: 'error',
        errorCode: 'provider_rejected',
        retryable: false,
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
