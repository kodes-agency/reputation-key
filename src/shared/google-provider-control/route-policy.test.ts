import { describe, expect, it } from 'vitest'
import { GOOGLE_PROVIDER_ROUTE_KEYS } from './contracts'
import {
  GOOGLE_PROVIDER_ROUTE_POLICIES,
  GOOGLE_PROVIDER_PRODUCTION_ORIGINS,
  compileGoogleProviderRequest,
  type GoogleProviderRouteDescriptor,
} from './route-catalogue'

describe('Google provider egress inventory', () => {
  it('accounts for every frozen route exactly once', () => {
    expect(Object.keys(GOOGLE_PROVIDER_ROUTE_POLICIES).sort()).toEqual(
      [...GOOGLE_PROVIDER_ROUTE_KEYS].sort(),
    )
  })

  it('keeps every route on an approved origin', () => {
    for (const [routeKey, entry] of Object.entries(GOOGLE_PROVIDER_ROUTE_POLICIES)) {
      expect(GOOGLE_PROVIDER_PRODUCTION_ORIGINS, routeKey).toContain(entry.origin)
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
    })
    expect(compiled.admission.requestBodyBytes).toBeLessThanOrEqual(
      policy.maxRequestBytes,
    )
  })
})
