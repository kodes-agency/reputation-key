// Every Google provider route must resolve to quota and in-flight coordination.
//
// Regression for 2026-09-29: the route catalogue named `google-notifications-
// read-v1` / `google-notifications-write-v1` for the three notification routes,
// but GOOGLE_QUOTA_POLICIES never defined them. The runtime builds coordinators
// only from that table, so admission found none and refused every GBP
// notification call with `coordination_unavailable` before dispatch — push
// subscription could never succeed anywhere, and nothing failed at build time.

import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createFakeGoogleCoordinationRedis } from '#/shared/testing/fake-google-coordination-redis'
import {
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { GOOGLE_PROVIDER_ROUTE_KEYS, type GoogleProviderRouteKey } from './contracts'
import {
  GOOGLE_QUOTA_POLICIES,
  createGoogleCoordinationLookup,
  googleQuotaCredentialFingerprint,
  type GoogleQuotaPolicy,
} from './quota-coordinator'
import {
  GOOGLE_PROVIDER_ROUTE_POLICIES,
  compileGoogleProviderRequest,
  type GoogleProviderRouteDescriptor,
} from './route-catalogue'
import {
  createGoogleExecutionAdmissionService,
  type GoogleAdmissionPermitSnapshot,
} from './admission-service'

const NOW_MS = 1_790_000_000_000
const PROJECT_FINGERPRINT = 'b'.repeat(64)
const QUOTA_POLICIES: Readonly<Record<string, GoogleQuotaPolicy>> = GOOGLE_QUOTA_POLICIES

function lookup() {
  return createGoogleCoordinationLookup({
    redis: createFakeGoogleCoordinationRedis(),
    nowMs: () => NOW_MS,
    leaseId: () => 'lease-identifier-0001',
  })
}

describe('Google quota policy coverage', () => {
  it.each(GOOGLE_PROVIDER_ROUTE_KEYS)(
    '%s names quota and in-flight policies that exist for its request class',
    (routeKey) => {
      const route = GOOGLE_PROVIDER_ROUTE_POLICIES[routeKey]

      expect(QUOTA_POLICIES[route.quotaPolicyId]?.requestClass).toBe(route.requestClass)
      expect(QUOTA_POLICIES[route.inFlightPolicyId]?.requestClass).toBe(
        route.requestClass,
      )
    },
  )

  it.each(GOOGLE_PROVIDER_ROUTE_KEYS)(
    '%s resolves to both coordinators the admission service asks for',
    (routeKey) => {
      const route = GOOGLE_PROVIDER_ROUTE_POLICIES[routeKey]
      const coordination = lookup()

      expect(coordination.quotaForPolicy(route.quotaPolicyId)).not.toBeNull()
      expect(coordination.inFlightForPolicy(route.inFlightPolicyId)).not.toBeNull()
    },
  )

  it('answers null for a policy id nobody defined', () => {
    const coordination = lookup()

    expect(coordination.quotaForPolicy('google-undefined-v1')).toBeNull()
    expect(coordination.inFlightForPolicy('google-undefined-v1')).toBeNull()
  })

  it('gives reply publishing its own lane, apart from review reads', () => {
    expect(GOOGLE_PROVIDER_ROUTE_POLICIES['reviews.reply']).toMatchObject({
      quotaPolicyId: 'google-reviews-write-v1',
      inFlightPolicyId: 'google-reviews-write-v1',
    })
    for (const routeKey of ['reviews.list', 'reviews.get'] as const) {
      expect(GOOGLE_PROVIDER_ROUTE_POLICIES[routeKey]).toMatchObject({
        quotaPolicyId: 'google-reviews-v1',
        inFlightPolicyId: 'google-reviews-v1',
      })
    }
  })

  it('sizes the reply lane like the review lane: 30 a minute per credential, 4 in flight', () => {
    const write = GOOGLE_QUOTA_POLICIES['google-reviews-write-v1']
    const read = GOOGLE_QUOTA_POLICIES['google-reviews-v1']

    expect(write.requestClass).toBe('reviews')
    expect(write.buckets).toEqual([
      {
        id: 'credential-project-endpoint-minute',
        scope: 'credential_project_endpoint',
        capacity: 30,
        refillTokens: 30,
        refillIntervalMs: 60_000,
      },
    ])
    expect(write).toMatchObject({
      inFlightScope: 'credential_project_endpoint',
      maxInFlight: 4,
    })
    expect(write.leaseMs).toBe(read.leaseMs)
  })

  it('lets a reply through while review reads have used up their minute', async () => {
    const coordination = lookup()
    const key = {
      credentialFingerprint: 'c'.repeat(64),
      projectFingerprint: PROJECT_FINGERPRINT,
      endpointClass: 'reviews' as const,
      organizationId: 'org-1',
      initiatorUserId: null,
      connectionId: 'conn-1',
      propertyId: 'prop-1',
    }
    const reads = coordination.quotaForPolicy('google-reviews-v1')
    const writes = coordination.quotaForPolicy('google-reviews-write-v1')

    for (let call = 0; call < 30; call += 1) {
      await reads?.acquire(key, 1, NOW_MS + 5_000)
    }

    await expect(reads?.acquire(key, 1, NOW_MS + 5_000)).resolves.toMatchObject({
      ok: false,
      code: 'quota_exhausted',
    })
    await expect(writes?.acquire(key, 1, NOW_MS + 5_000)).resolves.toMatchObject({
      ok: true,
    })
  })

  // The replyBurst scenario (catalogue.ts: 25 replies on one connection) makes
  // a publish of two Google calls: the read before the claim and the write.
  describe('a burst of 25 publishes on one connection', () => {
    const BURST = 25
    const key = {
      credentialFingerprint: 'c'.repeat(64),
      projectFingerprint: PROJECT_FINGERPRINT,
      endpointClass: 'reviews' as const,
      organizationId: 'org-1',
      initiatorUserId: null,
      connectionId: 'conn-1',
      propertyId: 'prop-1',
    }

    /** How many of the burst's calls the quota refuses, each publish being its
     * read and then its write, under the policy the catalogue gives each route. */
    async function refusedCalls(
      policyOf: (routeKey: 'reviews.get' | 'reviews.reply') => string,
    ): Promise<number> {
      const coordination = lookup()
      let refused = 0
      for (let publish = 0; publish < BURST; publish += 1) {
        for (const routeKey of ['reviews.get', 'reviews.reply'] as const) {
          const quota = coordination.quotaForPolicy(policyOf(routeKey))
          const result = await quota?.acquire(key, 1, NOW_MS + 5_000)
          if (result?.ok !== true) refused += 1
        }
      }
      return refused
    }

    it('is admitted in full: the reads fit the review lane and the writes the reply lane', async () => {
      await expect(
        refusedCalls(
          (routeKey) => GOOGLE_PROVIDER_ROUTE_POLICIES[routeKey].quotaPolicyId,
        ),
      ).resolves.toBe(0)
    })

    it('would have been refused on one shared lane: 50 calls against 30', async () => {
      const refused = await refusedCalls(
        () => GOOGLE_PROVIDER_ROUTE_POLICIES['reviews.get'].quotaPolicyId,
      )

      expect(refused).toBe(2 * BURST - 30)
    })
  })

  it('keeps the notification writes inside Google’s published edit and project limits', () => {
    const write = GOOGLE_QUOTA_POLICIES['google-notifications-write-v1']
    const read = GOOGLE_QUOTA_POLICIES['google-notifications-read-v1']
    const perMinute = (policy: GoogleQuotaPolicy, scope: string) =>
      policy.buckets
        .filter((entry) => entry.scope === scope)
        .map((entry) => (entry.refillTokens * 60_000) / entry.refillIntervalMs)

    // Google: 10 edits per minute per profile; 300 QPM per project.
    expect(
      Math.max(...perMinute(write, 'credential_project_endpoint')),
    ).toBeLessThanOrEqual(10)
    expect(
      Math.max(...perMinute(write, 'project')) + Math.max(...perMinute(read, 'project')),
    ).toBeLessThan(300)
  })
})

// The routes whose permits carry a system principal and no initiating user:
// Review sync, reply publication and notification management. A bucket scoped
// to a user would resolve no binding for them and fail closed as
// `coordination_unavailable`, exactly like a missing policy.
const SYSTEM_ROUTE_DESCRIPTORS = [
  {
    routeKey: 'reviews.list',
    accessToken: 'access-token',
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  },
  {
    routeKey: 'reviews.list',
    accessToken: 'access-token',
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    orderBy: 'updateTime desc',
  },
  {
    routeKey: 'reviews.get',
    accessToken: 'access-token',
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
  },
  {
    routeKey: 'reviews.reply',
    accessToken: 'access-token',
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    comment: 'Thank you for your review.',
  },
  {
    routeKey: 'notifications.get',
    accessToken: 'access-token',
    accountId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.accountId,
  },
  {
    routeKey: 'notifications.subscribe',
    accessToken: 'access-token',
    accountId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.accountId,
    pubsubTopic: 'projects/repkey-project/topics/gbp-notifications',
    notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
  },
  {
    routeKey: 'notifications.unsubscribe',
    accessToken: 'access-token',
    accountId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.accountId,
  },
] as const satisfies ReadonlyArray<GoogleProviderRouteDescriptor>

function systemPermit(descriptor: GoogleProviderRouteDescriptor): Readonly<{
  snapshot: GoogleAdmissionPermitSnapshot
  admission: ReturnType<typeof compileGoogleProviderRequest>['admission']
}> {
  const compiled = compileGoogleProviderRequest(descriptor, () => 'a'.repeat(64))
  const credentialFingerprint = googleQuotaCredentialFingerprint(
    compiled.admission.credentialBinding,
    PROJECT_FINGERPRINT,
  )
  if (!credentialFingerprint) throw new Error('expected a credential fingerprint')
  return {
    admission: compiled.admission,
    snapshot: {
      permitId: 'permit-0001',
      kind: 'work',
      gatewayIdentity: 'google-egress-runtime-1',
      routeKey: compiled.routeKey,
      routeCatalogueVersion: compiled.catalogueVersion,
      expectedAdmission: compiled.admission,
      quotaKey: {
        credentialFingerprint,
        projectFingerprint: PROJECT_FINGERPRINT,
        endpointClass: compiled.admission.endpointClass,
        organizationId: 'organization-1',
        initiatorUserId: null,
        connectionId: '8e000000-0000-4000-8000-000000000001',
        propertyId: '8f000000-0000-4000-8000-000000000001',
      },
      expiresAtMs: NOW_MS + 30_000,
      authorityRevision: 'c'.repeat(64),
    },
  }
}

describe('system-principal admission through the real coordinators', () => {
  it.each(
    SYSTEM_ROUTE_DESCRIPTORS.map((descriptor) => [descriptor.routeKey, descriptor]),
  )(
    'admits %s without an initiating user',
    async (_routeKey: GoogleProviderRouteKey, descriptor) => {
      const { snapshot, admission } = systemPermit(descriptor)
      const coordination = lookup()
      const service = createGoogleExecutionAdmissionService({
        nowMs: () => NOW_MS,
        admissionId: () => 'admission-identifier-0001',
        grantKeyring: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
        grantStore: {
          issue: async () => true,
          redeem: async () => 'unknown',
          complete: async () => null,
        },
        authority: {
          load: async () => snapshot,
          start: async () => 'started',
          failStarted: async () => undefined,
          complete: async () => undefined,
        },
        quotaForPolicy: coordination.quotaForPolicy,
        inFlightForPolicy: coordination.inFlightForPolicy,
      })

      const started = await service.start({
        permitId: snapshot.permitId,
        gatewayIdentity: snapshot.gatewayIdentity,
        admission,
        deadlineMs: NOW_MS + 10_000,
      })

      expect(started).toMatchObject({ ok: true })
    },
  )
})
