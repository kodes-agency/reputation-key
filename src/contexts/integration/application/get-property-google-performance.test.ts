import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { createGbpApiError } from '../domain/gbp-api-error'
import type { GooglePerformanceSourceReport } from './google-provider-contract'
import {
  createGetPropertyGooglePerformance,
  type GooglePerformanceAuthorizationSnapshot,
} from './get-property-google-performance'

const ACTOR: AuthContext = Object.freeze({
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'AccountAdmin',
  effectivePermissions: new Set(['property.read', 'integration.manage'] as const),
  scopeByPermission: new Map(),
})
const PROPERTY_ID = propertyId('11111111-1111-4111-8111-111111111111')
const CONNECTION_ID = googleConnectionId('22222222-2222-4222-8222-222222222222')
const NOW = new Date('2026-03-09T12:00:00.000Z')
const LEASE = Object.freeze({
  leaseRef: `l1.${'a'.repeat(43)}.v1.${'b'.repeat(43)}`,
  expiresAt: '2026-03-09T12:00:30.000Z',
  ttlSeconds: 30,
  renewAfterMs: 10_000,
})

function snapshot(
  overrides: Partial<GooglePerformanceAuthorizationSnapshot> = {},
): GooglePerformanceAuthorizationSnapshot {
  return Object.freeze({
    organizationId: ACTOR.organizationId,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    locationId: 'location-1',
    timezone: 'America/New_York',
    sourceEpoch: 2,
    profileVersion: 3,
    connectionLifecycleVersion: 4,
    connectionAccessVersion: 5,
    credentialGeneration: 6,
    authorizationVector: Object.freeze({
      policyVersion: 'beta-local-2',
      credentialGeneration: 6,
    }),
    authorizationVectorSha256: 'a'.repeat(64),
    authorizationFenceSha256: 'f'.repeat(64),
    principalHmacKeyVersion: 'v1',
    principalHmac: 'c'.repeat(43),
    ...overrides,
  })
}

function emptySource(): GooglePerformanceSourceReport {
  return {
    requestedRange: {
      startLocalDate: '2026-02-23',
      endLocalDate: '2026-03-08',
    },
    series: [],
  }
}

type PerformanceDeps = Parameters<typeof createGetPropertyGooglePerformance>[0]

function setup(
  input?: Readonly<{
    authorize?: ReturnType<typeof vi.fn<PerformanceDeps['authorize']>>
    fetchReport?: ReturnType<typeof vi.fn<PerformanceDeps['fetchReport']>>
    issueLease?: ReturnType<typeof vi.fn<PerformanceDeps['issueLease']>>
    monotonicNowMs?: () => number
  }>,
) {
  const current = snapshot()
  const authorize =
    input?.authorize ??
    vi
      .fn<PerformanceDeps['authorize']>()
      .mockResolvedValueOnce({ ok: true, snapshot: current, accessToken: 'access-token' })
      .mockResolvedValueOnce({ ok: true, snapshot: current, accessToken: null })
  const fetchReport =
    input?.fetchReport ?? vi.fn<PerformanceDeps['fetchReport']>(async () => emptySource())
  const issueLease =
    input?.issueLease ??
    vi.fn<PerformanceDeps['issueLease']>(async () => ({ ok: true, lease: LEASE }))
  let monotonic = 0
  const getPerformance = createGetPropertyGooglePerformance({
    authorize,
    fetchReport,
    issueLease,
    clock: () => NOW,
    monotonicNowMs: input?.monotonicNowMs ?? (() => monotonic++),
  })
  return { getPerformance, authorize, fetchReport, issueLease, current }
}

describe('getPropertyGooglePerformance', () => {
  it('returns a policy denial without calling Google or issuing a lease', async () => {
    const authorize = vi.fn(async () => ({
      ok: false as const,
      result: {
        status: 'unavailable' as const,
        reason: 'policy_disabled' as const,
        action: null,
      },
    }))
    const { getPerformance, fetchReport, issueLease } = setup({ authorize })

    await expect(
      getPerformance({ propertyId: PROPERTY_ID, preset: '30d', actor: ACTOR }),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'policy_disabled',
      action: null,
    })
    expect(fetchReport).not.toHaveBeenCalled()
    expect(issueLease).not.toHaveBeenCalled()
  })

  it('requests one combined prior and current range then returns a volatile report', async () => {
    const { getPerformance, authorize, fetchReport, issueLease, current } = setup()

    const result = await getPerformance({
      propertyId: PROPERTY_ID,
      preset: '7d',
      actor: ACTOR,
    })

    expect(fetchReport).toHaveBeenCalledTimes(1)
    expect(fetchReport).toHaveBeenCalledWith(
      {
        organizationId: ACTOR.organizationId,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        expectedConnectionLifecycleVersion: 4,
        expectedConnectionAccessVersion: 5,
        expectedCredentialGeneration: 6,
        expectedSourceEpoch: 2,
        locationId: 'location-1',
        startLocalDate: '2026-02-23',
        endLocalDate: '2026-03-08',
        signal: expect.any(AbortSignal),
      },
      ACTOR,
      current,
      'access-token',
    )
    expect(authorize).toHaveBeenNthCalledWith(2, {
      actor: ACTOR,
      propertyId: PROPERTY_ID,
      phase: 'before_return',
    })
    expect(issueLease).toHaveBeenCalledWith({
      actor: ACTOR,
      snapshot: current,
      absoluteDeadlineMs: NOW.getTime() + 15 * 60_000,
      nowMs: NOW.getTime(),
    })
    expect(result).toMatchObject({
      status: 'ready',
      data: {
        contractVersion: 1,
        contentExpiresAt: '2026-03-09T12:15:00.000Z',
        contentTtlSeconds: 900,
        authorizationLease: LEASE,
        period: {
          currentStartLocalDate: '2026-03-02',
          currentEndLocalDate: '2026-03-08',
          priorStartLocalDate: '2026-02-23',
          priorEndLocalDate: '2026-03-01',
        },
        sourceHealth: { state: 'no_data' },
      },
    })
  })

  it('discards a parsed response when authorization changes before return', async () => {
    const current = snapshot()
    const authorize = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        snapshot: current,
        accessToken: 'access-token',
      })
      .mockResolvedValueOnce({
        ok: false,
        result: {
          status: 'error',
          errorCode: 'stale_source',
          retryable: true,
          retryAfterSeconds: null,
        },
      })
    const { getPerformance, fetchReport, issueLease } = setup({ authorize })

    await expect(
      getPerformance({ propertyId: PROPERTY_ID, preset: '7d', actor: ACTOR }),
    ).resolves.toEqual({
      status: 'error',
      errorCode: 'stale_source',
      retryable: true,
      retryAfterSeconds: null,
    })
    expect(fetchReport).toHaveBeenCalledTimes(1)
    expect(issueLease).not.toHaveBeenCalled()
  })

  it('publishes after refresh when only the credential generation changes', async () => {
    const initial = snapshot()
    const refreshed = snapshot({
      credentialGeneration: 7,
      authorizationVector: Object.freeze({
        policyVersion: 'beta-local-2',
        credentialGeneration: 7,
      }),
      authorizationVectorSha256: 'd'.repeat(64),
    })
    const authorize = vi
      .fn<PerformanceDeps['authorize']>()
      .mockResolvedValueOnce({
        ok: true,
        snapshot: initial,
        accessToken: 'access-token',
      })
      .mockResolvedValueOnce({
        ok: true,
        snapshot: refreshed,
        accessToken: null,
      })
    const { getPerformance, issueLease } = setup({ authorize })

    await expect(
      getPerformance({ propertyId: PROPERTY_ID, preset: '7d', actor: ACTOR }),
    ).resolves.toMatchObject({ status: 'ready' })
    expect(issueLease).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: refreshed }),
    )
  })

  it('discards a response when a non-credential authorization vector changes', async () => {
    const initial = snapshot()
    const changed = snapshot({
      authorizationVector: Object.freeze({
        policyVersion: 'beta-local-3',
        credentialGeneration: 6,
      }),
      authorizationVectorSha256: 'e'.repeat(64),
      authorizationFenceSha256: 'd'.repeat(64),
    })
    const authorize = vi
      .fn<PerformanceDeps['authorize']>()
      .mockResolvedValueOnce({
        ok: true,
        snapshot: initial,
        accessToken: 'access-token',
      })
      .mockResolvedValueOnce({
        ok: true,
        snapshot: changed,
        accessToken: null,
      })
    const { getPerformance, issueLease } = setup({ authorize })

    await expect(
      getPerformance({ propertyId: PROPERTY_ID, preset: '7d', actor: ACTOR }),
    ).resolves.toEqual({
      status: 'error',
      errorCode: 'stale_source',
      retryable: true,
      retryAfterSeconds: null,
    })
    expect(issueLease).not.toHaveBeenCalled()
  })

  it.each([
    [
      createGbpApiError('fetchPerformanceReport', 'rate_limited', {
        retryAfterMs: 4_500,
      }),
      {
        status: 'error',
        errorCode: 'rate_limited',
        retryable: true,
        retryAfterSeconds: 5,
      },
    ],
    [
      createGbpApiError('fetchPerformanceReport', 'parse_error'),
      {
        status: 'error',
        errorCode: 'malformed_provider_response',
        retryable: false,
        retryAfterSeconds: null,
      },
    ],
    [
      createGbpApiError('fetchPerformanceReport', 'permission_denied'),
      {
        status: 'error',
        errorCode: 'provider_rejected',
        retryable: false,
        retryAfterSeconds: null,
      },
    ],
    [
      createGbpApiError('fetchPerformanceReport', 'upstream_error'),
      {
        status: 'error',
        errorCode: 'temporarily_unavailable',
        retryable: true,
        retryAfterSeconds: null,
      },
    ],
    [
      createGbpApiError('fetchPerformanceReport', 'upstream_error', {
        retryAfterMs: 5_000,
      }),
      {
        status: 'error',
        errorCode: 'temporarily_unavailable',
        retryable: true,
        retryAfterSeconds: 5,
      },
    ],
    [
      new DOMException('timed out', 'AbortError'),
      {
        status: 'error',
        errorCode: 'provider_timeout',
        retryable: true,
        retryAfterSeconds: null,
      },
    ],
  ])('maps provider failures to content-free errors', async (error, expected) => {
    const fetchReport = vi.fn(async () => {
      throw error
    })
    const { getPerformance, authorize, issueLease } = setup({ fetchReport })

    await expect(
      getPerformance({ propertyId: PROPERTY_ID, preset: '7d', actor: ACTOR }),
    ).resolves.toEqual(expected)
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(issueLease).not.toHaveBeenCalled()
  })

  it('reports an AbortSignal.timeout deadline as a provider timeout', async () => {
    // AbortSignal.timeout aborts with a TimeoutError DOMException, not an
    // AbortError, so the dedicated timeout state used to be unreachable.
    const fetchReport = vi.fn<PerformanceDeps['fetchReport']>(async (input) => {
      const signal = input.signal!
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      throw signal.reason
    })
    // Deadline 15_000; the second reading leaves a 1 ms provider budget.
    const readings = [0, 14_999]
    let reading = 0
    const { getPerformance, issueLease } = setup({
      fetchReport,
      monotonicNowMs: () => readings[Math.min(reading++, readings.length - 1)]!,
    })

    await expect(
      getPerformance({ propertyId: PROPERTY_ID, preset: '7d', actor: ACTOR }),
    ).resolves.toEqual({
      status: 'error',
      errorCode: 'provider_timeout',
      retryable: true,
      retryAfterSeconds: null,
    })
    expect(issueLease).not.toHaveBeenCalled()
  })

  it('fails closed when the authorization lease cannot be issued', async () => {
    const issueLease = vi.fn<PerformanceDeps['issueLease']>(async () => ({
      ok: false,
      code: 'runtime_unavailable',
    }))
    const { getPerformance } = setup({ issueLease })

    await expect(
      getPerformance({ propertyId: PROPERTY_ID, preset: '7d', actor: ACTOR }),
    ).resolves.toEqual({
      status: 'error',
      errorCode: 'temporarily_unavailable',
      retryable: true,
      retryAfterSeconds: null,
    })
  })
})
