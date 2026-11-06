import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { GoogleInFlightCoordinator, GoogleQuotaCoordinator } from './contracts'
import {
  createInMemoryGoogleQuotaCoordinator,
  googleQuotaCredentialFingerprint,
} from './quota-coordinator'
import {
  compileGoogleProviderRequest,
  type GoogleProviderAdmissionMetadata,
  type GoogleProviderRouteDescriptor,
} from './route-catalogue'
import {
  createGoogleExecutionAdmissionService,
  type GoogleAdmissionPermitAuthority,
  type GoogleAdmissionPermitSnapshot,
} from './admission-service'
import { createGoogleEgressGateway } from './egress-gateway'
const bindCredential = (credential: string) =>
  createHmac('sha256', 'credential-binding-test-key').update(credential).digest('hex')
type AuthorityStartResult = 'started' | 'changed' | 'expired' | 'unavailable'
const projectFingerprint = 'd'.repeat(64)

function permitFor(
  permitId: string,
  admission: GoogleProviderAdmissionMetadata,
): GoogleAdmissionPermitSnapshot {
  return Object.freeze({
    permitId,
    kind: admission.requestClass === 'credential_cleanup' ? 'credential_cleanup' : 'work',
    routeKey: admission.routeKey,
    routeCatalogueVersion: admission.catalogueVersion,
    expectedAdmission: admission,
    quotaKey: Object.freeze({
      credentialFingerprint: googleQuotaCredentialFingerprint(
        admission.credentialBinding,
        projectFingerprint,
      )!,
      projectFingerprint,
      endpointClass: admission.endpointClass,
      organizationId: 'organization-1',
      initiatorUserId: 'user-1',
      connectionId: 'connection-1',
      propertyId: admission.requestClass === 'performance' ? 'property-1' : null,
    }),
    expiresAtMs: 20_000,
    authorityRevision: 'authority-revision-1',
  })
}

function testCoordinators() {
  const quota: GoogleQuotaCoordinator = Object.freeze({
    acquire: vi.fn(async () => ({ ok: true as const, remaining: 9 })),
  })
  const release = vi.fn(async () => true)
  let leaseSequence = 0
  const inFlight: GoogleInFlightCoordinator = Object.freeze({
    acquire: vi.fn(async () => ({
      ok: true as const,
      lease: Object.freeze({
        leaseId: `inflight-lease-${String(++leaseSequence).padStart(8, '0')}`,
        expiresAtMs: 15_000,
      }),
    })),
    release,
  })
  return { quota, inFlight, release }
}

function testAuthority(
  permit: GoogleAdmissionPermitSnapshot,
  startResult: AuthorityStartResult = 'started',
) {
  const complete = vi.fn<GoogleAdmissionPermitAuthority['complete']>(
    async () => undefined,
  )
  const failStarted = vi.fn(async () => undefined)
  const authority: GoogleAdmissionPermitAuthority = Object.freeze({
    load: vi.fn(async (permitId: string) =>
      permitId === permit.permitId ? permit : null,
    ),
    start: vi.fn(async () => startResult),
    failStarted,
    complete,
  })
  return { authority, complete, failStarted }
}

function admissionFixture(
  input: Readonly<{
    permit: GoogleAdmissionPermitSnapshot
    nowMs?: () => number
    startResult?: AuthorityStartResult
  }>,
) {
  const nowMs = input.nowMs ?? (() => 1_000)
  const coordinators = testCoordinators()
  const authority = testAuthority(input.permit, input.startResult)
  const service = createGoogleExecutionAdmissionService({
    nowMs,
    authority: authority.authority,
    quotaForPolicy: () => coordinators.quota,
    inFlightForPolicy: () => coordinators.inFlight,
  })
  return { service, ...coordinators, ...authority }
}

function compile(descriptor: GoogleProviderRouteDescriptor) {
  return compileGoogleProviderRequest(descriptor, bindCredential)
}

describe('Google in-process admission service', () => {
  it('rejects route substitution before quota use', async () => {
    const accounts = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const locations = compile({
      routeKey: 'business-information.locations.list',
      accessToken: 'access-token',
      accountId: 'account-1',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-route-0001', accounts.admission),
    })

    await expect(
      fixture.service.start({
        permitId: 'permit-route-0001',
        admission: locations.admission,
        deadlineMs: 10_000,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'route_mismatch',
      retryAfterMs: 0,
    })
    expect(fixture.quota.acquire).not.toHaveBeenCalled()
  })

  it('completes a local handle idempotently without repeating durable completion', async () => {
    const compiled = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-happy-0001', compiled.admission),
    })
    const started = await fixture.service.start({
      permitId: 'permit-happy-0001',
      admission: compiled.admission,
      deadlineMs: 10_000,
    })
    if (!started.ok) throw new Error('expected admission handle')
    await expect(
      started.handle.complete({ outcome: 'success', retryAfterMs: null }),
    ).resolves.toBe(true)
    await expect(
      started.handle.complete({ outcome: 'success', retryAfterMs: null }),
    ).resolves.toBe(true)
    expect(fixture.release).toHaveBeenCalledTimes(1)
    expect(fixture.complete).toHaveBeenCalledTimes(1)
    expect(fixture.complete).toHaveBeenCalledWith(
      'permit-happy-0001',
      'authority-revision-1',
      'success',
      null,
    )
  })

  it('releases a semaphore after start CAS denial while keeping quota spent', async () => {
    const compiled = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-cas-000001', compiled.admission),
      startResult: 'changed',
    })
    const quota = createInMemoryGoogleQuotaCoordinator({
      nowMs: () => 1_000,
      capacity: 1,
      refillTokensPerSecond: 1,
    })
    vi.mocked(fixture.quota.acquire).mockImplementation(quota.acquire)
    await expect(
      fixture.service.start({
        permitId: 'permit-cas-000001',
        admission: compiled.admission,
        deadlineMs: 10_000,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
      retryAfterMs: 0,
    })
    expect(fixture.quota.acquire).toHaveBeenCalledTimes(1)
    expect(fixture.inFlight.acquire).toHaveBeenCalledTimes(1)
    expect(fixture.release).toHaveBeenCalledTimes(1)
    await expect(
      quota.acquire(
        permitFor('permit-cas-000001', compiled.admission).quotaKey,
        1,
        10_000,
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'quota_exhausted',
      retryAfterMs: 1_000,
    })
  })

  // The gateway checks the same deadline before it asks; the time spent reaching
  // admission can still use it up. That is not a malformed request, which the
  // reply workflow treats as a deterministic refusal it never retries.
  it.each([
    ['at', 10_000],
    ['past', 10_001],
  ])(
    'denies with deadline_exceeded when started %s the deadline',
    async (_label, now) => {
      const compiled = compile({
        routeKey: 'account-management.accounts.list',
        accessToken: 'access-token',
      })
      const fixture = admissionFixture({
        permit: permitFor('permit-late-00001', compiled.admission),
        nowMs: () => now,
      })

      await expect(
        fixture.service.start({
          permitId: 'permit-late-00001',
          admission: compiled.admission,
          deadlineMs: 10_000,
        }),
      ).resolves.toEqual({ ok: false, code: 'deadline_exceeded', retryAfterMs: 0 })
      expect(fixture.quota.acquire).not.toHaveBeenCalled()
    },
  )

  // On 2026-10-23 a token refresh reached admission in time, the permit read used
  // up the rest of its deadline, and the quota step's "too late" came back as
  // `quota_exhausted`: the log blamed a quota that was nearly full. An elapsed
  // deadline is reported as one, and spends no quota.
  it('denies with deadline_exceeded, spending no quota, when reading the permit used up the deadline', async () => {
    let nowMs = 1_000
    const compiled = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-load-00001', compiled.admission),
      nowMs: () => nowMs,
    })
    const load = vi.mocked(fixture.authority.load)
    const loadPermit = load.getMockImplementation()
    load.mockImplementationOnce(async (permitId) => {
      nowMs = 10_000
      return loadPermit ? loadPermit(permitId) : null
    })

    await expect(
      fixture.service.start({
        permitId: 'permit-load-00001',
        admission: compiled.admission,
        deadlineMs: 10_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'deadline_exceeded', retryAfterMs: 0 })
    expect(fixture.quota.acquire).not.toHaveBeenCalled()
    expect(fixture.inFlight.acquire).not.toHaveBeenCalled()
  })

  // A coordinator says "too late" two ways: the deadline had already passed
  // (no wait would help, retryAfterMs 0), or the next free token would arrive
  // after it (a real wait). Only the second is pressure on the limit.
  it.each([
    ['quota', 'deadline_exceeded', 0, 'deadline_exceeded'],
    ['quota', 'deadline_exceeded', 4_000, 'quota_exhausted'],
    ['quota', 'quota_exhausted', 4_000, 'quota_exhausted'],
    ['in-flight', 'deadline_exceeded', 0, 'deadline_exceeded'],
    ['in-flight', 'deadline_exceeded', 4_000, 'in_flight_exhausted'],
    ['in-flight', 'limit_exhausted', 4_000, 'in_flight_exhausted'],
  ] as const)(
    'reports a %s %s with retryAfterMs %i as %s',
    async (coordinator, coordinatorCode, retryAfterMs, expected) => {
      const compiled = compile({
        routeKey: 'account-management.accounts.list',
        accessToken: 'access-token',
      })
      const fixture = admissionFixture({
        permit: permitFor('permit-late-00002', compiled.admission),
      })
      if (coordinator === 'quota') {
        vi.mocked(fixture.quota.acquire).mockResolvedValueOnce({
          ok: false,
          code: coordinatorCode as 'deadline_exceeded' | 'quota_exhausted',
          retryAfterMs,
        })
      } else {
        vi.mocked(fixture.inFlight.acquire).mockResolvedValueOnce({
          ok: false,
          code: coordinatorCode as 'deadline_exceeded' | 'limit_exhausted',
          retryAfterMs,
        })
      }

      await expect(
        fixture.service.start({
          permitId: 'permit-late-00002',
          admission: compiled.admission,
          deadlineMs: 10_000,
        }),
      ).resolves.toEqual({ ok: false, code: expected, retryAfterMs })
    },
  )

  // Admission expiry is measured after waiting for capacity and starting the permit.
  it.each([
    ['the call deadline', 10_000, 10_000, 'deadline_exceeded'],
    ['the permit expiry', 20_000, 30_000, 'permit_expired'],
  ] as const)(
    'refuses to issue a handle once %s passed while it waited for a slot',
    async (_label, lateNowMs, deadlineMs, code) => {
      let nowMs = 1_000
      const compiled = compile({
        routeKey: 'account-management.accounts.list',
        accessToken: 'access-token',
      })
      const fixture = admissionFixture({
        permit: permitFor('permit-slow-00001', compiled.admission),
        nowMs: () => nowMs,
      })
      vi.mocked(fixture.inFlight.acquire).mockImplementationOnce(async () => {
        nowMs = lateNowMs
        return {
          ok: true as const,
          lease: Object.freeze({
            leaseId: 'inflight-lease-slow0001',
            expiresAtMs: 40_000,
          }),
        }
      })

      await expect(
        fixture.service.start({
          permitId: 'permit-slow-00001',
          admission: compiled.admission,
          deadlineMs,
        }),
      ).resolves.toEqual({ ok: false, code, retryAfterMs: 0 })

      // The started permit is failed and the slot returned, not left to its lease.
      expect(fixture.failStarted).toHaveBeenCalledWith(
        expect.objectContaining({ permitId: 'permit-slow-00001' }),
        'grant_expired',
      )
      expect(fixture.release).toHaveBeenCalledTimes(1)
    },
  )

  it('does not dispatch the same permit twice under concurrent calls', async () => {
    const descriptor = {
      routeKey: 'account-management.accounts.list' as const,
      accessToken: 'access-token',
    }
    const compiled = compile(descriptor)
    const fixture = admissionFixture({
      permit: permitFor('permit-once-00001', compiled.admission),
    })
    const quota = createInMemoryGoogleQuotaCoordinator({
      nowMs: () => 1_000,
      capacity: 2,
      refillTokensPerSecond: 1,
    })
    vi.mocked(fixture.quota.acquire).mockImplementation(quota.acquire)
    let started = false
    vi.mocked(fixture.authority.start).mockImplementation(async () => {
      if (started) return 'changed'
      started = true
      return 'started'
    })
    const fetchMock = vi.fn(async () => new Response('{}'))
    const gateway = createGoogleEgressGateway({
      nowMs: () => 1_000,
      bindCredential,
      admission: fixture.service,
      fetch: fetchMock,
    })
    const input = { permitId: 'permit-once-00001', descriptor, deadlineMs: 10_000 }
    const results = await Promise.all([gateway.execute(input), gateway.execute(input)])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.find((result) => !result.ok)).toMatchObject({
      code: 'admission_denied',
      admissionCode: 'authorization_changed',
      dispatch: 'not_sent',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(
      quota.acquire(
        permitFor('permit-once-00001', compiled.admission).quotaKey,
        1,
        10_000,
      ),
    ).resolves.toEqual({
      ok: false,
      code: 'quota_exhausted',
      retryAfterMs: 1_000,
    })
    expect(fixture.complete).toHaveBeenCalledTimes(1)
    expect(fixture.release).toHaveBeenCalledTimes(2)
  })

  it('requires credential-cleanup permits to use only the fixed revoke route', async () => {
    const revoke = compile({ routeKey: 'oauth.revoke', token: 'token-to-revoke' })
    const fixture = admissionFixture({
      permit: permitFor('permit-revoke-001', revoke.admission),
    })
    await expect(
      fixture.service.start({
        permitId: 'permit-revoke-001',
        admission: revoke.admission,
        deadlineMs: 10_000,
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(fixture.quota.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialFingerprint: bindCredential('token-to-revoke'),
        endpointClass: 'oauth-revoke',
      }),
      1,
      10_000,
    )
  })
})

describe('Google in-process egress gateway', () => {
  function gatewayFixture(descriptor: GoogleProviderRouteDescriptor, response: Response) {
    const compiled = compile(descriptor)
    const fixture = admissionFixture({
      permit: permitFor('permit-gateway-01', compiled.admission),
    })
    const startSpy = vi.fn(fixture.service.start)
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => response,
    )
    const admission = Object.freeze({
      ...fixture.service,
      start: startSpy,
    })
    return {
      gateway: createGoogleEgressGateway({
        nowMs: () => 1_000,
        bindCredential,
        admission,
        fetch: fetchMock as typeof fetch,
      }),
      fetchMock,
      startSpy,
      admission,
    }
  }

  it('constructs the typed upstream request while admission receives only code metadata', async () => {
    const descriptor = {
      routeKey: 'business-information.locations.list' as const,
      accessToken: 'provider-access-token',
      accountId: 'account/provider-id',
      pageToken: 'next-page-token',
    }
    const fixture = gatewayFixture(
      descriptor,
      new Response('{"locations":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await fixture.gateway.execute({
      permitId: 'permit-gateway-01',
      descriptor,
      deadlineMs: 10_000,
    })

    expect(result.ok).toBe(true)
    expect(fixture.fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fixture.fetchMock.mock.calls[0]!
    expect(url).toBe(
      'https://mybusinessbusinessinformation.googleapis.com/v1/accounts/account%2Fprovider-id/locations?pageSize=100&readMask=name%2Ctitle%2CstorefrontAddress%2Ccategories%2Cmetadata&pageToken=next-page-token',
    )
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { authorization: 'Bearer provider-access-token' },
    })
    const admissionPayload = JSON.stringify(fixture.startSpy.mock.calls[0]?.[0])
    expect(admissionPayload).not.toContain('provider-access-token')
    expect(admissionPayload).not.toContain('account/provider-id')
    expect(admissionPayload).not.toContain('next-page-token')
  })

  it('fails a declared oversized response and still completes the admission handle', async () => {
    const descriptor = {
      routeKey: 'account-management.accounts.list' as const,
      accessToken: 'provider-access-token',
    }
    const fixture = gatewayFixture(
      descriptor,
      new Response('x', {
        status: 200,
        headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
      }),
    )
    await expect(
      fixture.gateway.execute({
        permitId: 'permit-gateway-01',
        descriptor,
        deadlineMs: 10_000,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'response_too_large',
      dispatch: 'answered',
      providerStatus: 200,
      retryAfterMs: 0,
    })
  })

  it.each([
    'notifications.subscribe',
    'notifications.get',
    'notifications.unsubscribe',
  ] as const)(
    'records the %s permit before delivering its response',
    async (routeKey) => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      try {
        const descriptor = {
          routeKey,
          accessToken: 'access-token',
          accountId: 'account-1',
          pubsubTopic: 'projects/test/topics/notifications',
          notificationTypes: ['NEW_REVIEW' as const],
        }
        const fixture = admissionFixture({
          permit: permitFor('permit-delayed-completion', compile(descriptor).admission),
          nowMs: Date.now,
        })
        let permitState = 'started'
        fixture.complete.mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          permitState = 'completed'
        })
        const fetchProvider = vi.fn(async () => new Response('{}'))
        const gateway = createGoogleEgressGateway({
          nowMs: Date.now,
          bindCredential,
          admission: fixture.service,
          fetch: fetchProvider,
        })
        const delivered = vi.fn()
        const execution = gateway
          .execute({
            permitId: 'permit-delayed-completion',
            descriptor,
            deadlineMs: 15_000,
          })
          .then((result) => delivered({ result, permitState }))

        await vi.advanceTimersByTimeAsync(20)
        await execution
        expect(delivered).toHaveBeenCalledExactlyOnceWith({
          result: expect.objectContaining({ ok: true, status: 200 }),
          permitState: 'completed',
        })
        expect(fixture.complete).toHaveBeenCalledTimes(1)
        expect(fixture.release).toHaveBeenCalledTimes(1)
        expect(fetchProvider).toHaveBeenCalledTimes(1)
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
    },
  )

  it.each([
    { status: 200, responseAtMs: 10_000 },
    { status: 429, responseAtMs: 10_000 },
    { status: 503, responseAtMs: 10_000 },
    { status: 200, responseAtMs: 14_999 },
  ])(
    'delivers a Google $status at $responseAtMs ms while failed lease releases finish in the background',
    async ({ status, responseAtMs }) => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      try {
        const descriptor = { routeKey: 'oauth.jwks' as const }
        const fixture = admissionFixture({
          permit: permitFor('permit-slow-release', compile(descriptor).admission),
          nowMs: Date.now,
        })
        fixture.release.mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 2_000))
          throw new Error('release unavailable')
        })
        const fetchProvider = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, responseAtMs))
          return new Response('provider answer', {
            status,
            headers: { 'retry-after': '30', 'cache-control': 'no-store' },
          })
        })
        const warn = vi.fn()
        const gateway = createGoogleEgressGateway({
          nowMs: Date.now,
          bindCredential,
          admission: fixture.service,
          fetch: fetchProvider,
          logger: { warn },
        })
        const delivered = vi.fn()
        const execution = gateway
          .execute({
            permitId: 'permit-slow-release',
            descriptor,
            deadlineMs: 15_000,
          })
          .then(delivered)

        await vi.advanceTimersByTimeAsync(responseAtMs)
        expect(delivered).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            ok: true,
            status,
            headers: expect.objectContaining({
              retryAfter: '30',
              cacheControl: 'no-store',
            }),
            body: new TextEncoder().encode('provider answer'),
          }),
        )
        expect(fixture.release).toHaveBeenCalledTimes(1)
        await execution
        await vi.advanceTimersByTimeAsync(6_000)
        expect(fixture.release).toHaveBeenCalledTimes(3)
        expect(fixture.complete).toHaveBeenCalledTimes(1)
        expect(fetchProvider).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
    },
  )

  it.each([
    [5_000, 1_000],
    [50, 25],
  ])(
    'bounds a stalled durable completion with %i ms left to %i ms',
    async (remainingMs, waitMs) => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      try {
        const descriptor = { routeKey: 'oauth.jwks' as const }
        const fixture = admissionFixture({
          permit: permitFor('permit-stalled-completion', compile(descriptor).admission),
          nowMs: Date.now,
        })
        const { promise: databaseCompletion, resolve: completeDatabase } =
          Promise.withResolvers<void>()
        fixture.complete.mockImplementation(() => databaseCompletion)
        const fetchProvider = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000))
          return new Response('provider answer', {
            status: 429,
            headers: { 'retry-after': '30', 'cache-control': 'no-store' },
          })
        })
        const warn = vi.fn()
        const gateway = createGoogleEgressGateway({
          nowMs: Date.now,
          bindCredential,
          admission: fixture.service,
          fetch: fetchProvider,
          logger: { warn },
        })
        const delivered = vi.fn()
        const execution = gateway
          .execute({
            permitId: 'permit-stalled-completion',
            descriptor,
            deadlineMs: 10_000 + remainingMs,
          })
          .then(delivered)

        await vi.advanceTimersByTimeAsync(10_000 + waitMs - 1)
        expect(delivered).not.toHaveBeenCalled()
        expect(fixture.release).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        await execution
        expect(delivered).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            ok: true,
            status: 429,
            headers: expect.objectContaining({
              retryAfter: '30',
              cacheControl: 'no-store',
            }),
            body: new TextEncoder().encode('provider answer'),
          }),
        )
        completeDatabase()
        await vi.advanceTimersByTimeAsync(0)
        expect(fixture.complete).toHaveBeenCalledTimes(1)
        expect(fixture.release).toHaveBeenCalledTimes(1)
        expect(fetchProvider).toHaveBeenCalledTimes(1)
        expect(warn).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
    },
  )

  it('keeps a provider response when durable completion is unavailable', async () => {
    const descriptor = {
      routeKey: 'oauth.jwks' as const,
    }
    const compiled = compile(descriptor)
    const fixture = admissionFixture({
      permit: permitFor('permit-completion-01', compiled.admission),
    })
    const complete = vi.fn(async () => false)
    const start = fixture.service.start
    const gateway = createGoogleEgressGateway({
      nowMs: () => 1_000,
      bindCredential,
      admission: {
        start: async (input) => {
          const result = await start(input)
          return result.ok ? { ok: true, handle: { ...result.handle, complete } } : result
        },
      },
      fetch: vi.fn(async () => new Response('{"keys":[]}')) as typeof fetch,
    })

    await expect(
      gateway.execute({
        permitId: 'permit-completion-01',
        descriptor,
        deadlineMs: 10_000,
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 })
    expect(complete).toHaveBeenCalledTimes(3)
  })
})
