import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  compileGoogleProviderRequest,
} from './route-catalogue'

const bindCredential = (value: string) =>
  createHmac('sha256', 'test-binding-key').update(value).digest('hex')

describe('Google provider route catalogue', () => {
  it('compiles account discovery without accepting an origin, method, path, or arbitrary query', () => {
    const compiled = compileGoogleProviderRequest(
      {
        routeKey: 'account-management.accounts.list',
        accessToken: 'access-token',
        pageToken: 'next_page-1',
      },
      bindCredential,
    )

    expect(compiled.catalogueVersion).toBe(GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION)
    expect(compiled.method).toBe('GET')
    expect(compiled.url).toBe(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20&pageToken=next_page-1',
    )
    expect(compiled.headers).toEqual({ authorization: 'Bearer access-token' })
    expect(compiled.admission.requestClass).toBe('discovery')
    expect(compiled.admission.requestBodySha256).toBeNull()
    expect(compiled.admission.credentialBinding).toBe(bindCredential('access-token'))
  })

  it('compiles location discovery with the exact read mask and encoded account suffix', () => {
    const compiled = compileGoogleProviderRequest(
      {
        routeKey: 'business-information.locations.list',
        accessToken: 'access-token',
        accountId: '123/unsafe',
      },
      bindCredential,
    )

    expect(compiled.url).toBe(
      'https://mybusinessbusinessinformation.googleapis.com/v1/accounts/123%2Funsafe/locations?pageSize=100&readMask=name%2Ctitle%2CstorefrontAddress%2Ccategories',
    )
    expect(compiled.method).toBe('GET')
  })

  it('compiles bounded Review list and targeted get routes', () => {
    const locationName = ['accounts', 'account-1', 'locations', 'location-1'].join('/')
    const reviewName = [locationName, 'reviews', 'review-1'].join('/')
    const list = compileGoogleProviderRequest(
      {
        routeKey: 'reviews.list',
        accessToken: 'access-token',
        locationName,
        pageToken: 'opaque-provider-page',
      },
      bindCredential,
    )
    expect(list.url).toBe(
      `https://mybusiness.googleapis.com/v4/${locationName}/reviews?pageSize=50&pageToken=opaque-provider-page`,
    )
    expect(list.method).toBe('GET')

    const get = compileGoogleProviderRequest(
      {
        routeKey: 'reviews.get',
        accessToken: 'access-token',
        reviewName,
      },
      bindCredential,
    )
    expect(get.url).toBe(`https://mybusiness.googleapis.com/v4/${reviewName}`)
    expect(get.method).toBe('GET')
    expect(get.admission.maxResponseBytes).toBe(64 * 1024)
  })

  it('compiles OAuth refresh and revoke as fixed form routes with bounded bodies', () => {
    const refresh = compileGoogleProviderRequest(
      {
        routeKey: 'oauth.token.refresh',
        refreshToken: 'refresh-token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
      bindCredential,
    )
    expect(refresh.url).toBe('https://oauth2.googleapis.com/token')
    expect(refresh.method).toBe('POST')
    if (refresh.body === null) throw new Error('expected refresh form body')
    expect(new TextDecoder().decode(refresh.body)).toBe(
      'refresh_token=refresh-token&client_id=client-id&client_secret=client-secret&grant_type=refresh_token',
    )
    expect(refresh.admission.requestClass).toBe('credential_refresh')
    expect(refresh.admission.credentialBinding).toBe(bindCredential('refresh-token'))

    const revoke = compileGoogleProviderRequest(
      { routeKey: 'oauth.revoke', token: 'access-token' },
      bindCredential,
    )
    expect(revoke.url).toBe('https://oauth2.googleapis.com/revoke')
    if (revoke.body === null) throw new Error('expected revoke form body')
    expect(new TextDecoder().decode(revoke.body)).toBe('token=access-token')
    expect(revoke.admission.requestClass).toBe('credential_cleanup')
  })

  it('rejects malformed route fields before constructing an upstream request', () => {
    expect(() =>
      compileGoogleProviderRequest(
        {
          routeKey: 'business-information.locations.list',
          accessToken: '',
          accountId: 'account-1',
        },
        bindCredential,
      ),
    ).toThrow('provider route input is invalid')
    expect(() =>
      compileGoogleProviderRequest(
        {
          routeKey: 'reviews.list',
          accessToken: 'token',
          locationName: '../locations/location-1',
          pageToken: undefined,
        },
        bindCredential,
      ),
    ).toThrow('provider route input is invalid')
  })
  it('maps a frozen route to the local TLS simulator without changing its path', () => {
    const compiled = compileGoogleProviderRequest(
      {
        routeKey: 'business-information.locations.list',
        accessToken: 'access-token',
        accountId: 'account-1',
      },
      bindCredential,
      {
        kind: 'local_sandbox',
        simulatorOrigin: 'https://google-provider-simulator:9443',
      },
    )

    expect(compiled.url).toBe(
      'https://google-provider-simulator:9443/v1/accounts/account-1/locations?pageSize=100&readMask=name%2Ctitle%2CstorefrontAddress%2Ccategories',
    )
    expect(compiled.admission.requestBindingSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a malformed local simulator origin', () => {
    expect(() =>
      compileGoogleProviderRequest({ routeKey: 'oauth.jwks' }, bindCredential, {
        kind: 'local_sandbox',
        simulatorOrigin: 'http://google-provider-simulator:9443/path',
      }),
    ).toThrow('provider simulator origin is invalid')
  })

  it('compiles the frozen Performance route without caller-controlled metrics or query', () => {
    const compiled = compileGoogleProviderRequest(
      {
        routeKey: 'performance.fetch',
        accessToken: 'access-token',
        locationId: 'location/unsafe',
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      },
      bindCredential,
    )

    const expectedMetrics = [
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'BUSINESS_CONVERSATIONS',
      'BUSINESS_DIRECTION_REQUESTS',
      'CALL_CLICKS',
      'WEBSITE_CLICKS',
      'BUSINESS_BOOKINGS',
      'BUSINESS_FOOD_MENU_CLICKS',
    ]
      .map((metric) => `dailyMetrics=${metric}`)
      .join('&')
    expect(compiled.url).toBe(
      `https://businessprofileperformance.googleapis.com/v1/locations/location%2Funsafe:fetchMultiDailyMetricsTimeSeries?${expectedMetrics}&dailyRange.startDate.year=2026&dailyRange.startDate.month=7&dailyRange.startDate.day=1&dailyRange.endDate.year=2026&dailyRange.endDate.month=7&dailyRange.endDate.day=31&prettyPrint=false`,
    )
    expect(compiled.method).toBe('GET')
    expect(compiled.headers).toEqual({ authorization: 'Bearer access-token' })
    expect(compiled.admission).toMatchObject({
      endpointClass: 'performance',
      requestClass: 'performance',
      maxResponseBytes: 5 * 1024 * 1024,
      quotaPolicyId: 'google-performance-read-v1',
      inFlightPolicyId: 'google-performance-read-v1',
    })
  })
})
