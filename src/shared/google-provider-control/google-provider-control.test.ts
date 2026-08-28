import { describe, expect, it, vi } from 'vitest'
import type { GoogleExecutionAdmissionRequest } from './contracts'
import {
  createDenyAllGoogleExecutionAdmission,
  createInMemoryGoogleExecutionAdmission,
  validateGoogleExecutionAdmissionRequest,
} from './execution-admission'
import { createInMemoryGoogleQuotaCoordinator } from './quota-coordinator'
import {
  executeWithSingle401Refresh,
  googleRetryDelayMs,
  hashBoundedRequestBody,
  parseGoogleRetryAfterMs,
} from './provider-call'
import { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION } from './route-catalogue'

const request = (
  override: Partial<GoogleExecutionAdmissionRequest> = {},
): GoogleExecutionAdmissionRequest => ({
  capability: 'property.import_gbp_v2',
  organizationId: 'org-1',
  propertyId: null,
  connectionId: 'connection-1',
  authorization: {
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
    propertyAuthorizationGeneration: null,
    capabilityPolicyVersion: 'beta-local-2',
    executionPolicyVersion: 'beta-local-2',
    routingPolicyVersion: 1,
  },
  routeKey: 'account-management.accounts.list',
  routeCatalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  endpointClass: 'account-management',
  requestClass: 'discovery',
  requestBindingSha256: 'a'.repeat(64),
  credentialBinding: 'b'.repeat(64),
  requestBodySha256: null,
  requestBodyBytes: 0,
  maxRequestBytes: 0,
  maxResponseBytes: 5 * 1024 * 1024,
  quotaPolicyId: 'google-discovery-read-v1',
  inFlightPolicyId: 'google-discovery-read-v1',
  deadlineMs: 20_000,
  ...override,
})

const fingerprint = (value: string) =>
  value.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)

describe('Google execution admission', () => {
  it.each([
    ['property.import_gbp_v2', 'performance.fetch', 'performance', 'performance'],
    ['property.read_gbp_performance', 'reviews.list', 'reviews', 'reviews'],
    [
      'property.connect_gbp',
      'account-management.accounts.list',
      'account-management',
      'discovery',
    ],
    ['property.publish_reply', 'reviews.get', 'reviews', 'reviews'],
  ] as const)(
    'rejects a %s permit for the unrelated %s route',
    (capability, routeKey, endpointClass, requestClass) => {
      expect(
        validateGoogleExecutionAdmissionRequest(
          request({ capability, routeKey, endpointClass, requestClass }),
          10_000,
        ),
      ).toBe('route_mismatch')
    },
  )

  it('accepts the system review-sync capability only on read review routes', () => {
    expect(
      validateGoogleExecutionAdmissionRequest(
        request({
          capability: 'property.connect_gbp',
          propertyId: 'property-1',
          routeKey: 'reviews.get',
          endpointClass: 'reviews',
          requestClass: 'reviews',
          maxRequestBytes: 0,
          maxResponseBytes: 64 * 1024,
          quotaPolicyId: 'google-reviews-v1',
          inFlightPolicyId: 'google-reviews-v1',
        }),
        10_000,
      ),
    ).toBeNull()
  })

  it.each([
    ['notifications.get', 0, null, 'google-notifications-read-v1'],
    ['notifications.subscribe', 128, 'c'.repeat(64), 'google-notifications-write-v1'],
    ['notifications.unsubscribe', 96, 'd'.repeat(64), 'google-notifications-write-v1'],
  ] as const)(
    'accepts property.connect_gbp for the governed %s route',
    (routeKey, requestBodyBytes, requestBodySha256, quotaPolicyId) => {
      expect(
        validateGoogleExecutionAdmissionRequest(
          request({
            capability: 'property.connect_gbp',
            propertyId: 'property-1',
            routeKey,
            endpointClass: 'notifications',
            requestClass: 'notifications',
            requestBodySha256,
            requestBodyBytes,
            maxRequestBytes: requestBodyBytes === 0 ? 0 : 64 * 1024,
            maxResponseBytes: 64 * 1024,
            quotaPolicyId,
            inFlightPolicyId: quotaPolicyId,
          }),
          10_000,
        ),
      ).toBeNull()
    },
  )

  it('accepts the reply-publication capability only on the review write route', () => {
    expect(
      validateGoogleExecutionAdmissionRequest(
        request({
          capability: 'property.publish_reply',
          propertyId: 'property-1',
          routeKey: 'reviews.reply',
          endpointClass: 'reviews',
          requestClass: 'reviews',
          requestBodySha256: 'c'.repeat(64),
          requestBodyBytes: 24,
          maxRequestBytes: 64 * 1024,
          maxResponseBytes: 64 * 1024,
          quotaPolicyId: 'google-reviews-v1',
          inFlightPolicyId: 'google-reviews-v1',
        }),
        10_000,
      ),
    ).toBeNull()
  })

  it('denies by default', async () => {
    await expect(
      createDenyAllGoogleExecutionAdmission().issue(request()),
    ).resolves.toEqual({
      ok: false,
      code: 'denied_by_default',
    })
  })

  it('binds exact authorization, route, request metadata, credential, body, deadline, and one use', async () => {
    let now = 10_000
    let permitSequence = 0
    const admission = createInMemoryGoogleExecutionAdmission({
      nowMs: () => now,
      idGen: () => `permit-${++permitSequence}`,
      authorize: () => true,
    })
    const issued = await admission.issue(request())
    expect(issued.ok).toBe(true)
    if (!issued.ok) throw new Error('expected permit')

    await expect(
      admission.consume(issued.value, request({ requestBindingSha256: 'c'.repeat(64) })),
    ).resolves.toEqual({ ok: false, code: 'request_binding_mismatch' })
    await expect(admission.consume(issued.value, request())).resolves.toMatchObject({
      ok: true,
    })
    await expect(admission.consume(issued.value, request())).resolves.toEqual({
      ok: false,
      code: 'permit_replayed',
    })

    const second = await admission.issue(request())
    if (!second.ok) throw new Error('expected second permit')
    now = 20_001
    await expect(admission.consume(second.value, request())).resolves.toEqual({
      ok: false,
      code: 'permit_expired',
    })
  })

  it.each([
    ['endpoint_mismatch', { endpointClass: 'business-information' as const }],
    [
      'route_mismatch',
      {
        routeKey: 'business-information.locations.list' as const,
        endpointClass: 'business-information' as const,
      },
    ],
    ['request_class_mismatch', { requestClass: 'identity' as const }],
    [
      'authorization_drift',
      {
        authorization: {
          ...request().authorization,
          credentialGeneration: 2,
        },
      },
    ],
  ])('rejects %s without consuming the permit', async (code, override) => {
    const admission = createInMemoryGoogleExecutionAdmission({
      nowMs: () => 10_000,
      idGen: () => `permit-${code}`,
      authorize: () => true,
    })
    const issued = await admission.issue(request())
    if (!issued.ok) throw new Error('expected permit')
    await expect(admission.consume(issued.value, request(override))).resolves.toEqual({
      ok: false,
      code,
    })
    await expect(admission.consume(issued.value, request())).resolves.toMatchObject({
      ok: true,
    })
  })
})

describe('Google quota and refresh coordination', () => {
  it('shares quota by credential, project, and endpoint with bounded retry advice', async () => {
    let now = 1_000
    const quota = createInMemoryGoogleQuotaCoordinator({
      nowMs: () => now,
      capacity: 2,
      refillTokensPerSecond: 1,
    })
    const key = {
      credentialFingerprint: fingerprint('a'),
      projectFingerprint: fingerprint('b'),
      endpointClass: 'performance' as const,
      organizationId: 'organization-1',
      initiatorUserId: 'user-1',
      connectionId: 'connection-1',
      propertyId: 'property-1',
    }
    await expect(quota.acquire(key, 2, 3_000)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
    await expect(quota.acquire(key, 1, 3_000)).resolves.toEqual({
      ok: false,
      code: 'quota_exhausted',
      retryAfterMs: 1_000,
    })
    now = 2_000
    await expect(quota.acquire(key, 1, 3_000)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
  })

  it('retries only one 401 after one refresh', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, value: 'unauthorized' })
      .mockResolvedValueOnce({ status: 401, value: 'still-unauthorized' })
    const refresh = vi.fn().mockResolvedValue('token-2')
    await expect(
      executeWithSingle401Refresh({
        token: 'token-1',
        deadlineMs: 2_000,
        nowMs: () => 1_000,
        send,
        refreshAfter401: refresh,
      }),
    ).resolves.toEqual({ status: 401, value: 'still-unauthorized' })
    expect(send).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('hashes a bounded body without retaining it', () => {
    expect(hashBoundedRequestBody(new TextEncoder().encode('body'), 4)).toEqual({
      sha256: '230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5',
      bytes: 4,
    })
    expect(() => hashBoundedRequestBody(new Uint8Array(5), 4)).toThrow('bound')
  })

  it('bounds Retry-After and exponential backoff to five through 300 seconds', () => {
    expect(parseGoogleRetryAfterMs('120', 1_000)).toBe(120_000)
    expect(parseGoogleRetryAfterMs('999', 1_000)).toBe(300_000)
    expect(parseGoogleRetryAfterMs(new Date(101_000).toUTCString(), 1_000)).toBe(100_000)
    expect(parseGoogleRetryAfterMs('malformed', 1_000)).toBeNull()
    expect(
      googleRetryDelayMs({
        attempt: 1,
        nowMs: 1_000,
        retryAfter: null,
        jitter: 1,
      }),
    ).toBe(5_000)
    expect(
      googleRetryDelayMs({
        attempt: 20,
        nowMs: 1_000,
        retryAfter: null,
        jitter: 1,
      }),
    ).toBe(300_000)
    expect(
      googleRetryDelayMs({
        attempt: 1,
        nowMs: 1_000,
        retryAfter: '120',
        jitter: 0,
      }),
    ).toBe(120_000)
  })
})
