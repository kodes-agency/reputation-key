import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GOOGLE_PROVIDER_ROUTE_KEYS } from './contracts'
import {
  GOOGLE_PROVIDER_ROUTE_POLICIES,
  assertGoogleProviderRoutePolicies,
  compileGoogleProviderRequest,
  type GoogleProviderRouteDescriptor,
} from './route-catalogue'

describe('Google provider egress inventory', () => {
  it('accounts for every frozen route exactly once', () => {
    expect(Object.keys(GOOGLE_PROVIDER_ROUTE_POLICIES).sort()).toEqual(
      [...GOOGLE_PROVIDER_ROUTE_KEYS].sort(),
    )
    expect(() => assertGoogleProviderRoutePolicies()).not.toThrow()
  })

  it('keeps the sole direct exception non-credential, fixed-origin, and repeat-safe', () => {
    const direct = Object.entries(GOOGLE_PROVIDER_ROUTE_POLICIES).filter(
      ([, entry]) => entry.transport === 'direct_fixed_trust_read',
    )

    expect(direct).toEqual([
      [
        'oauth.jwks',
        expect.objectContaining({
          method: 'GET',
          credential: 'none',
          recovery: 'safe_read_repeat',
          repositoryState: 'direct_fixed_trust_read',
        }),
      ],
    ])
  })

  it('never classifies a provider write or one-time credential operation as repeat-safe', () => {
    for (const [routeKey, entry] of Object.entries(GOOGLE_PROVIDER_ROUTE_POLICIES)) {
      if (entry.method !== 'GET' || routeKey === 'oauth.token.exchange') {
        expect(entry.recovery, routeKey).not.toBe('safe_read_repeat')
      }
    }
    expect(GOOGLE_PROVIDER_ROUTE_POLICIES['oauth.token.exchange'].recovery).toBe(
      'preserve_then_never_reexchange',
    )
    expect(GOOGLE_PROVIDER_ROUTE_POLICIES['oauth.revoke'].recovery).toBe(
      'one_use_revoke_reconciliation',
    )
    expect(GOOGLE_PROVIDER_ROUTE_POLICIES['notifications.subscribe'].recovery).toBe(
      'desired_state_readback',
    )
  })

  it('records the executable durable recovery authority for one-use OAuth operations', () => {
    expect(GOOGLE_PROVIDER_ROUTE_POLICIES['oauth.token.exchange'].repositoryState).toBe(
      'gateway_wired_durable_recovery',
    )
    expect(GOOGLE_PROVIDER_ROUTE_POLICIES['oauth.token.refresh'].repositoryState).toBe(
      'gateway_wired',
    )
    expect(GOOGLE_PROVIDER_ROUTE_POLICIES['oauth.revoke'].repositoryState).toBe(
      'gateway_wired_durable_recovery',
    )
  })

  it('pins every route to a real owning implementation', () => {
    for (const [routeKey, entry] of Object.entries(GOOGLE_PROVIDER_ROUTE_POLICIES)) {
      const source = readFileSync(resolve(process.cwd(), entry.ownerModule), 'utf8')
      if (routeKey === 'oauth.jwks') {
        expect(source).toContain('fetch(config.jwksUrl')
      } else {
        expect(source, routeKey).toContain(`routeKey: '${routeKey}'`)
      }
    }
  })
})

const accessToken = 'access-token'
const accountId = 'account-1'
const locationName = `accounts/${accountId}/locations/location-1`
const reviewName = `${locationName}/reviews/review-1`
const descriptors = [
  { routeKey: 'account-management.accounts.list', accessToken },
  { routeKey: 'business-information.locations.list', accessToken, accountId },
  {
    routeKey: 'performance.fetch',
    accessToken,
    locationId: 'location-1',
    startLocalDate: '2026-07-01',
    endLocalDate: '2026-07-31',
  },
  {
    routeKey: 'oauth.token.exchange',
    code: 'code',
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://example.test/callback',
    codeVerifier: 'verifier',
  },
  {
    routeKey: 'oauth.token.refresh',
    refreshToken: 'refresh',
    clientId: 'client',
    clientSecret: 'secret',
  },
  { routeKey: 'oauth.jwks' },
  { routeKey: 'oauth.revoke', token: 'token' },
  { routeKey: 'notifications.get', accessToken, accountId },
  {
    routeKey: 'notifications.subscribe',
    accessToken,
    accountId,
    pubsubTopic: 'projects/project/topics/reviews',
    notificationTypes: ['NEW_REVIEW'],
  },
  { routeKey: 'notifications.unsubscribe', accessToken, accountId },
  { routeKey: 'reviews.list', accessToken, locationName },
  { routeKey: 'reviews.get', accessToken, reviewName },
  { routeKey: 'reviews.reply', accessToken, reviewName, comment: 'Thank you' },
] satisfies GoogleProviderRouteDescriptor[]

describe('Google provider route policy compilation', () => {
  it('exercises a descriptor for every live route', () => {
    expect(descriptors.map(({ routeKey }) => routeKey).sort()).toEqual(
      [...GOOGLE_PROVIDER_ROUTE_KEYS].sort(),
    )
  })

  it.each(descriptors)('compiles $routeKey with its declared policy', (descriptor) => {
    const compiled = compileGoogleProviderRequest(descriptor, () => 'a'.repeat(64))
    const policy = GOOGLE_PROVIDER_ROUTE_POLICIES[descriptor.routeKey]
    expect(compiled.method).toBe(policy.method)
    expect(new URL(compiled.url).origin).toBe(policy.origin)
    expect(compiled.admission).toMatchObject({
      endpointClass: policy.endpointClass,
      requestClass: policy.requestClass,
      maxRequestBytes: policy.maxRequestBytes,
      maxResponseBytes: policy.maxResponseBytes,
      quotaPolicyId: policy.quotaPolicyId,
      inFlightPolicyId: policy.inFlightPolicyId,
    })
    expect(compiled.admission.requestBodyBytes).toBeLessThanOrEqual(
      policy.maxRequestBytes,
    )
  })
})
