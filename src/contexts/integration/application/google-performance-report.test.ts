import { describe, expect, it } from 'vitest'
import type {
  GoogleDailyMetric,
  GooglePerformanceSourceReport,
} from './google-provider-contract'
import {
  buildPropertyPerformancePeriod,
  composePropertyGooglePerformanceReport,
} from './google-performance-report'

const LEASE = Object.freeze({
  leaseRef: `l1.${'a'.repeat(43)}.v1.${'b'.repeat(43)}`,
  expiresAt: '2026-03-09T12:00:30.000Z',
  ttlSeconds: 30,
  renewAfterMs: 10_000,
})

function dates(start: string, count: number): string[] {
  const cursor = new Date(`${start}T00:00:00.000Z`)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(cursor)
    date.setUTCDate(date.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

function sourceReport(
  metrics: Readonly<Record<string, Readonly<Record<string, number>>>>,
): GooglePerformanceSourceReport {
  return {
    requestedRange: {
      startLocalDate: '2026-02-23',
      endLocalDate: '2026-03-08',
    },
    series: Object.entries(metrics).map(([metric, values]) => ({
      metric: metric as GoogleDailyMetric,
      points: Object.entries(values).map(([localDate, value]) => ({ localDate, value })),
    })),
  }
}

function compose(source: GooglePerformanceSourceReport) {
  return composePropertyGooglePerformanceReport({
    source,
    preset: '7d',
    timezone: 'America/New_York',
    retrievedAt: new Date('2026-03-09T12:00:00.000Z'),
    contentExpiresAt: new Date('2026-03-09T12:15:00.000Z'),
    authorizationLease: LEASE,
  })
}

describe('Google Performance report composition', () => {
  it('builds property-local calendar windows across a DST boundary', () => {
    expect(
      buildPropertyPerformancePeriod({
        preset: '7d',
        timezone: 'America/New_York',
        now: new Date('2026-03-09T12:00:00.000Z'),
      }),
    ).toEqual({
      preset: '7d',
      timezone: 'America/New_York',
      currentStartLocalDate: '2026-03-02',
      currentEndLocalDate: '2026-03-08',
      priorStartLocalDate: '2026-02-23',
      priorEndLocalDate: '2026-03-01',
    })
  })

  it('derives exact full-coverage totals, deltas, health, and chart series', () => {
    const prior = dates('2026-02-23', 7)
    const current = dates('2026-03-02', 7)
    const values = (before: number, after: number) =>
      Object.fromEntries([
        ...prior.map((date) => [date, before]),
        ...current.map((date) => [date, after]),
      ])
    const report = compose(
      sourceReport({
        BUSINESS_IMPRESSIONS_DESKTOP_MAPS: values(5, 10),
        BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: values(5, 10),
        BUSINESS_IMPRESSIONS_MOBILE_MAPS: values(5, 10),
        BUSINESS_IMPRESSIONS_MOBILE_SEARCH: values(5, 10),
        WEBSITE_CLICKS: values(2, 3),
        CALL_CLICKS: values(1, 2),
        BUSINESS_DIRECTION_REQUESTS: values(0, 1),
        BUSINESS_CONVERSATIONS: values(1, 1),
        BUSINESS_BOOKINGS: values(0, 2),
        BUSINESS_FOOD_MENU_CLICKS: values(0, 0),
      }),
    )

    expect(report.headlines.totalProfileImpressions).toMatchObject({
      value: 280,
      priorValue: 140,
      deltaPercent: 100,
      availability: 'ready',
      completeDayCount: 7,
      priorCompleteDayCount: 7,
    })
    expect(report.headlines.websiteClicks).toMatchObject({
      value: 21,
      priorValue: 14,
      deltaPercent: 50,
      availability: 'ready',
    })
    expect(report.sourceHealth).toEqual({
      state: 'ready',
      providerCheckedThroughLocalDate: '2026-03-08',
      latestReturnedDataLocalDate: '2026-03-08',
      latestCompleteCoreLocalDate: '2026-03-08',
      dataLagDays: 0,
    })
    expect(report.discoverySeries.map((series) => series.id)).toEqual(['search', 'maps'])
    expect(report.discoverySeries[0]?.points[0]).toEqual({
      localDate: '2026-03-02',
      value: 20,
      availability: 'returned',
    })
    expect(report.actionSeries.map((series) => series.id)).toEqual([
      'website_clicks',
      'call_clicks',
      'direction_requests',
    ])
    expect(report.additionalInteractions.map((metric) => metric.label)).toEqual([
      'Conversations',
      'Bookings',
      'Menu clicks',
    ])
  })

  it('preserves returned zeros and treats absent dates as unavailable', () => {
    const current = dates('2026-03-02', 7)
    const report = compose(
      sourceReport({
        WEBSITE_CLICKS: Object.fromEntries(current.map((date) => [date, 0])),
      }),
    )

    expect(report.headlines.websiteClicks).toMatchObject({
      value: 0,
      priorValue: null,
      deltaPercent: null,
      availability: 'ready',
      completeDayCount: 7,
      priorCompleteDayCount: 0,
    })
    expect(report.headlines.callClicks).toMatchObject({
      value: null,
      availability: 'not_applicable_or_not_returned',
      completeDayCount: 0,
    })
    expect(report.actionSeries[0]?.points[0]).toEqual({
      localDate: '2026-03-02',
      value: 0,
      availability: 'returned',
    })
    expect(report.actionSeries[1]?.points[0]).toEqual({
      localDate: '2026-03-02',
      value: null,
      availability: 'unavailable',
    })
    expect(report.sourceHealth.state).toBe('partial')
  })

  it('marks a valid empty provider response as no data', () => {
    const report = compose(sourceReport({}))

    expect(report.sourceHealth).toEqual({
      state: 'no_data',
      providerCheckedThroughLocalDate: '2026-03-08',
      latestReturnedDataLocalDate: null,
      latestCompleteCoreLocalDate: null,
      dataLagDays: null,
    })
    expect(report.headlines.totalProfileImpressions.availability).toBe(
      'not_applicable_or_not_returned',
    )
  })

  it('withholds deltas and marks inconsistent impression coverage partial', () => {
    const current = dates('2026-03-02', 7)
    const prior = dates('2026-02-23', 7)
    const complete = Object.fromEntries([...prior, ...current].map((date) => [date, 1]))
    const missingMiddle = { ...complete }
    delete missingMiddle['2026-03-05']
    const report = compose(
      sourceReport({
        BUSINESS_IMPRESSIONS_DESKTOP_MAPS: complete,
        BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: complete,
        BUSINESS_IMPRESSIONS_MOBILE_MAPS: complete,
        BUSINESS_IMPRESSIONS_MOBILE_SEARCH: missingMiddle,
      }),
    )

    expect(report.headlines.totalProfileImpressions).toMatchObject({
      value: 24,
      priorValue: 28,
      deltaPercent: null,
      availability: 'partial',
      completeDayCount: 6,
      priorCompleteDayCount: 7,
    })
    expect(report.sourceHealth.state).toBe('partial')
    expect(report.sourceHealth.latestCompleteCoreLocalDate).toBe('2026-03-08')
  })
})
