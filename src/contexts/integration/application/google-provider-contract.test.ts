import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION as CANONICAL_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS as CANONICAL_ROUTE_KEYS,
  type GoogleProviderRouteKey as CanonicalGoogleProviderRouteKey,
} from '#/shared/google-provider-control/contracts'
import {
  GOOGLE_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  GOOGLE_PROVIDER_ROUTE_CATALOG_VERSION,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
  type GoogleProviderRouteKey,
  MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
  isGooglePerformanceDailyMetric,
} from './google-provider-contract'

describe('Google provider contract', () => {
  it('freezes the active Performance catalogue by name', () => {
    expect(GOOGLE_PERFORMANCE_CATALOG_VERSION).toBe('2026-08-05')
    expect(GOOGLE_PERFORMANCE_DAILY_METRICS).toEqual([
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
    ])
  })

  it('rejects unknown and deprecated metrics', () => {
    expect(isGooglePerformanceDailyMetric('WEBSITE_CLICKS')).toBe(true)
    expect(isGooglePerformanceDailyMetric('DAILY_METRIC_UNKNOWN')).toBe(false)
    expect(isGooglePerformanceDailyMetric('BUSINESS_FOOD_ORDERS')).toBe(false)
    expect(isGooglePerformanceDailyMetric('FUTURE_METRIC')).toBe(false)
  })

  it('freezes the exact-integer daily value bound', () => {
    expect(MAX_GOOGLE_PERFORMANCE_DAILY_VALUE).toBe(6_152_458_507_336)
    expect(MAX_GOOGLE_PERFORMANCE_DAILY_VALUE * 4 * 366).toBeLessThanOrEqual(
      Number.MAX_SAFE_INTEGER,
    )
  })

  it('aliases the one canonical provider route catalogue without a second copy', () => {
    expect(GOOGLE_PROVIDER_ROUTE_CATALOG_VERSION).toBe(CANONICAL_ROUTE_CATALOGUE_VERSION)
    expect(GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION).toBe(
      CANONICAL_ROUTE_CATALOGUE_VERSION,
    )
    expect(GOOGLE_PROVIDER_ROUTE_KEYS).toBe(CANONICAL_ROUTE_KEYS)
    expect(GOOGLE_PROVIDER_ROUTE_KEYS).toEqual(
      expect.arrayContaining([
        'notifications.get',
        'notifications.subscribe',
        'notifications.unsubscribe',
      ]),
    )
    expectTypeOf<GoogleProviderRouteKey>().toEqualTypeOf<CanonicalGoogleProviderRouteKey>()
  })
})
