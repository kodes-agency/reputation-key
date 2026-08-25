import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { GoogleInFlightCoordinator, GoogleQuotaCoordinator } from './contracts'
import { createInMemoryGoogleAdmissionGrantStore } from './admission-grant-store'
import { googleQuotaCredentialFingerprint } from './quota-coordinator'
import {
  compileGoogleProviderRequest,
  type GoogleProviderAdmissionMetadata,
  type GoogleProviderRouteDescriptor,
} from './route-catalogue'
import {
  createGoogleExecutionAdmissionService,
  type GoogleAdmissionPermitAuthority,
  type GoogleAdmissionPermitSnapshot,
} from '../../../services/google-execution-admission/service'
import { handleGoogleExecutionAdmissionRequest } from '../../../services/google-execution-admission/http-api'
import { createGoogleEgressGateway } from '../../../services/google-egress-gateway/service'
import {
  createGoogleEgressGatewayHttpClient,
  handleGoogleEgressGatewayRequest,
} from '../../../services/google-egress-gateway/http-api'
const grantKeyring = createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
const bindCredential = (credential: string) =>
  createHmac('sha256', 'credential-binding-test-key').update(credential).digest('hex')
type AuthorityStartResult = 'started' | 'changed' | 'expired' | 'unavailable'
const projectFingerprint = 'd'.repeat(64)
const gatewayIdentity = 'google-egress-gateway-1'

function permitFor(
  permitId: string,
  admission: GoogleProviderAdmissionMetadata,
): GoogleAdmissionPermitSnapshot {
  return Object.freeze({
    permitId,
    kind: admission.requestClass === 'credential_cleanup' ? 'credential_cleanup' : 'work',
    gatewayIdentity,
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
    permitGeneration: 1,
    policyVersion: 1,
    emergencyKillVersion: 0,
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
  const complete = vi.fn(async () => undefined)
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
  let admissionSequence = 0
  const service = createGoogleExecutionAdmissionService({
    nowMs,
    admissionId: () => `admission-id-${String(++admissionSequence).padStart(8, '0')}`,
    grantKeyring,
    grantStore: createInMemoryGoogleAdmissionGrantStore(nowMs),
    authority: authority.authority,
    quotaForPolicy: () => coordinators.quota,
    inFlightForPolicy: () => coordinators.inFlight,
  })
  return { service, ...coordinators, ...authority }
}

function compile(descriptor: GoogleProviderRouteDescriptor) {
  return compileGoogleProviderRequest(descriptor, bindCredential)
}

describe('Google execution-admission service', () => {
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
        gatewayIdentity,
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

  it('issues, redeems once, completes, and rejects replay', async () => {
    const compiled = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-happy-0001', compiled.admission),
    })
    const started = await fixture.service.start({
      permitId: 'permit-happy-0001',
      gatewayIdentity,
      admission: compiled.admission,
      deadlineMs: 10_000,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('expected admission grant')
    const redemption = {
      grant: started.grant,
      gatewayIdentity,
      admission: compiled.admission,
    }
    await expect(fixture.service.redeem(redemption)).resolves.toEqual({ ok: true })
    await expect(fixture.service.redeem(redemption)).resolves.toEqual({
      ok: false,
      code: 'grant_replayed',
    })
    await expect(
      fixture.service.complete({
        admissionId: started.grant.admissionId,
        outcome: 'success',
        retryAfterMs: null,
      }),
    ).resolves.toBe(true)
    expect(fixture.release).toHaveBeenCalledTimes(1)
    expect(fixture.complete).toHaveBeenCalledWith(
      'permit-happy-0001',
      'authority-revision-1',
      'success',
      null,
    )
  })
  it('reports an expired signed grant distinctly from a grant mismatch', async () => {
    let nowMs = 1_000
    const compiled = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-expiry-0001', compiled.admission),
      nowMs: () => nowMs,
    })
    const started = await fixture.service.start({
      permitId: 'permit-expiry-0001',
      gatewayIdentity,
      admission: compiled.admission,
      deadlineMs: 10_000,
    })
    if (!started.ok) throw new Error('expected grant')
    nowMs = started.grant.expiresAtMs

    await expect(
      fixture.service.redeem({
        grant: started.grant,
        gatewayIdentity,
        admission: compiled.admission,
      }),
    ).resolves.toEqual({ ok: false, code: 'grant_expired' })
  })

  it('releases a semaphore after start CAS denial without refunding quota', async () => {
    const compiled = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-cas-000001', compiled.admission),
      startResult: 'changed',
    })
    await expect(
      fixture.service.start({
        permitId: 'permit-cas-000001',
        gatewayIdentity,
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
  })

  it('requires credential-cleanup permits to use only the fixed revoke route', async () => {
    const revoke = compile({ routeKey: 'oauth.revoke', token: 'token-to-revoke' })
    const fixture = admissionFixture({
      permit: permitFor('permit-revoke-001', revoke.admission),
    })
    await expect(
      fixture.service.start({
        permitId: 'permit-revoke-001',
        gatewayIdentity,
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

describe('Google egress gateway', () => {
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
        gatewayIdentity,
        bindCredential,
        grantKeyring,
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

  it('fails a declared oversized response and still completes the redeemed grant', async () => {
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
      retryAfterMs: 0,
    })
  })
})
describe('Google provider service HTTP boundaries', () => {
  it('rejects an admission request without the gateway mTLS identity', async () => {
    const compiled = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-http-0001', compiled.admission),
    })
    const response = await handleGoogleExecutionAdmissionRequest({
      request: new Request('https://internal.invalid/v1/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          permitId: 'permit-http-0001',
          admission: compiled.admission,
          deadlineMs: 10_000,
        }),
      }),
      gatewayIdentity: null,
      service: fixture.service,
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'unauthorized',
    })
    expect(fixture.authority.load).not.toHaveBeenCalled()
  })

  it('rejects an unknown route before invoking the gateway', async () => {
    const execute = vi.fn()
    const response = await handleGoogleEgressGatewayRequest({
      request: new Request('https://internal.invalid/v1/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          permitId: 'permit-http-0002',
          descriptor: { routeKey: 'unknown.route', accessToken: 'secret' },
          deadlineMs: 10_000,
        }),
      }),
      callerIdentity: 'google-web-1',
      allowedCallerIdentities: new Set(['google-web-1']),
      gateway: Object.freeze({ execute }),
    })

    expect(response.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects query-bearing admission paths before permit lookup', async () => {
    const compiled = compile({
      routeKey: 'account-management.accounts.list',
      accessToken: 'access-token',
    })
    const fixture = admissionFixture({
      permit: permitFor('permit-http-query-0001', compiled.admission),
    })
    const response = await handleGoogleExecutionAdmissionRequest({
      request: new Request('https://internal.invalid/v1/start?unexpected=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          permitId: 'permit-http-query-0001',
          admission: compiled.admission,
          deadlineMs: 10_000,
        }),
      }),
      gatewayIdentity,
      service: fixture.service,
    })

    expect(response.status).toBe(404)
    expect(fixture.authority.load).not.toHaveBeenCalled()
  })

  it('rejects non-JSON gateway bodies before invoking execution', async () => {
    const execute = vi.fn()
    const response = await handleGoogleEgressGatewayRequest({
      request: new Request('https://internal.invalid/v1/execute', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({
          permitId: 'permit-http-media-0001',
          descriptor: { routeKey: 'oauth.jwks' },
          deadlineMs: 10_000,
        }),
      }),
      callerIdentity: 'google-web-1',
      allowedCallerIdentities: new Set(['google-web-1']),
      gateway: Object.freeze({ execute }),
    })

    expect(response.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })
  it('reconstructs a bounded upstream result through the gateway client', async () => {
    const body = new TextEncoder().encode('{"accounts":[]}')
    const client = createGoogleEgressGatewayHttpClient({
      postRaw: vi.fn(async () => ({
        status: 200,

        headers: new Headers({
          'x-repkey-provider-status': '206',
          'x-repkey-provider-content-type': 'application/json',
          'x-repkey-provider-retry-after': '5',
        }),
        body,
      })),
    })

    await expect(
      client.execute({
        permitId: 'permit-http-0003',
        descriptor: {
          routeKey: 'account-management.accounts.list',
          accessToken: 'provider-token',
        },
        deadlineMs: 10_000,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 206,
      headers: {
        contentType: 'application/json',
        cacheControl: null,
        retryAfter: '5',
      },
      body,
    })
  })

  it('discards a provider response when durable completion is unavailable', async () => {
    const descriptor = {
      routeKey: 'oauth.jwks' as const,
    }
    const compiled = compile(descriptor)
    const fixture = admissionFixture({
      permit: permitFor('permit-http-0004', compiled.admission),
    })
    const gateway = createGoogleEgressGateway({
      nowMs: () => 1_000,
      gatewayIdentity,
      bindCredential,
      grantKeyring,
      admission: {
        ...fixture.service,
        complete: vi.fn(async () => false),
      },
      fetch: vi.fn(async () => new Response('{"keys":[]}')) as typeof fetch,
    })

    await expect(
      gateway.execute({
        permitId: 'permit-http-0004',
        descriptor,
        deadlineMs: 10_000,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      retryAfterMs: 0,
    })
  })
})
