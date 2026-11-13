// Every Google provider route must resolve to quota and in-flight coordination.
//
// Regression for 2026-09-29: the route catalogue named `google-notifications-
// read-v1` / `google-notifications-write-v1` for the three notification routes,
// but GOOGLE_QUOTA_POLICIES never defined them. The runtime builds coordinators
// only from that table, so admission found none and refused every GBP
// notification call with `coordination_unavailable` before dispatch — push
// subscription could never succeed anywhere, and nothing failed at build time.

import { describe, expect, it } from 'vitest'
import { GOOGLE_PROVIDER_ROUTE_KEYS } from './contracts'
import {
  GOOGLE_QUOTA_POLICIES,
  createGoogleCoordinationLookup,
  type GoogleQuotaPolicy,
} from './quota-coordinator'
import { GOOGLE_PROVIDER_ROUTE_POLICIES } from './route-catalogue'

const NOW_MS = 1_790_000_000_000
const QUOTA_POLICIES: Readonly<Record<string, GoogleQuotaPolicy>> = GOOGLE_QUOTA_POLICIES

function lookup() {
  return createGoogleCoordinationLookup({
    redis: {
      eval: async () => {
        throw new Error('this test must not reach Redis')
      },
    },
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
