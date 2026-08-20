import { describe, expect, it } from 'vitest'
import {
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
} from '../../application/google-provider-contract'
import { isGbpApiError } from '../../domain/gbp-api-error'
import { parseGooglePerformanceResponse } from './google-performance-parser'

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

const datedValue = (year: number, month: number, day: number, value?: unknown) => ({
  date: { year, month, day },
  ...(value === undefined ? {} : { value }),
})

const metricSeries = (
  metric: string,
  values: ReadonlyArray<ReturnType<typeof datedValue>>,
  extra: Readonly<Record<string, unknown>> = {},
) => ({
  dailyMetric: metric,
  timeSeries: { datedValues: values },
  ...extra,
})

function parse(
  response: unknown,
  requestedMetrics: readonly string[] = GOOGLE_PERFORMANCE_DAILY_METRICS,
) {
  const body = encode(response)
  const result = parseGooglePerformanceResponse({
    body,
    requestedMetrics,
    startLocalDate: '2026-07-01',
    endLocalDate: '2026-07-31',
  })
  return { body, result }
}

describe('Google Performance response parser', () => {
  it('flattens nested groups, treats omitted values as zero, and accepts the exact bound', () => {
    const { body, result } = parse({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            metricSeries('WEBSITE_CLICKS', [
              datedValue(2026, 7, 1),
              datedValue(2026, 7, 2, String(MAX_GOOGLE_PERFORMANCE_DAILY_VALUE)),
            ]),
          ],
          ignoredAdditiveField: true,
        },
        {
          dailyMetricTimeSeries: [
            metricSeries('CALL_CLICKS', [datedValue(2026, 7, 1, '3')]),
          ],
        },
      ],
      ignoredAdditiveField: true,
    })

    expect(result).toEqual({
      requestedRange: {
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      },
      series: [
        {
          metric: 'WEBSITE_CLICKS',
          points: [
            { localDate: '2026-07-01', value: 0 },
            {
              localDate: '2026-07-02',
              value: MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
            },
          ],
        },
        {
          metric: 'CALL_CLICKS',
          points: [{ localDate: '2026-07-01', value: 3 }],
        },
      ],
    })
    expect(body.every((byte) => byte === 0)).toBe(true)
  })

  it('accepts an empty provider response as a valid no-data report', () => {
    expect(parse({}).result).toEqual({
      requestedRange: {
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      },
      series: [],
    })
  })

  it.each([
    ['unknown metric', metricSeries('DAILY_METRIC_UNKNOWN', [])],
    ['deprecated metric', metricSeries('BUSINESS_FOOD_ORDERS', [])],
    ['unrequested metric', metricSeries('CALL_CLICKS', [])],
    ['sub-entity', metricSeries('WEBSITE_CLICKS', [], { dailySubEntityType: {} })],
    ['numeric value', metricSeries('WEBSITE_CLICKS', [datedValue(2026, 7, 1, 1)])],
    ['negative value', metricSeries('WEBSITE_CLICKS', [datedValue(2026, 7, 1, '-1')])],
    ['fractional value', metricSeries('WEBSITE_CLICKS', [datedValue(2026, 7, 1, '1.5')])],
    [
      'overflow value',
      metricSeries('WEBSITE_CLICKS', [
        datedValue(2026, 7, 1, String(BigInt(MAX_GOOGLE_PERFORMANCE_DAILY_VALUE) + 1n)),
      ]),
    ],
    [
      'partial date',
      {
        dailyMetric: 'WEBSITE_CLICKS',
        timeSeries: { datedValues: [{ date: { year: 2026, month: 7 }, value: '1' }] },
      },
    ],
    ['invalid date', metricSeries('WEBSITE_CLICKS', [datedValue(2026, 2, 29, '1')])],
    ['out-of-range date', metricSeries('WEBSITE_CLICKS', [datedValue(2026, 8, 1, '1')])],
  ])('rejects %s and overwrites the raw buffer', (_name, series) => {
    const body = encode({
      multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [series] }],
    })
    expect(() =>
      parseGooglePerformanceResponse({
        body,
        requestedMetrics: ['WEBSITE_CLICKS'],
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      }),
    ).toThrowError(/GBP API fetchPerformanceReport failed \(parse_error\)/)
    expect(body.every((byte) => byte === 0)).toBe(true)
  })

  it.each([
    [
      'duplicate metric series',
      [metricSeries('WEBSITE_CLICKS', []), metricSeries('WEBSITE_CLICKS', [])],
    ],
    [
      'duplicate metric date',
      [
        metricSeries('WEBSITE_CLICKS', [
          datedValue(2026, 7, 1, '1'),
          datedValue(2026, 7, 1, '2'),
        ]),
      ],
    ],
  ])('rejects %s', (_name, series) => {
    expect(() =>
      parse({
        multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: series }],
      }),
    ).toThrowError(/GBP API fetchPerformanceReport failed \(parse_error\)/)
  })

  it('rejects malformed JSON and responses over 5 MiB without retaining content', () => {
    const malformed = new TextEncoder().encode('{')
    expect(() =>
      parseGooglePerformanceResponse({
        body: malformed,
        requestedMetrics: GOOGLE_PERFORMANCE_DAILY_METRICS,
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      }),
    ).toThrowError(/GBP API fetchPerformanceReport failed \(parse_error\)/)
    expect(malformed.every((byte) => byte === 0)).toBe(true)

    const oversized = new Uint8Array(5 * 1024 * 1024 + 1).fill(1)
    expect(() =>
      parseGooglePerformanceResponse({
        body: oversized,
        requestedMetrics: GOOGLE_PERFORMANCE_DAILY_METRICS,
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      }),
    ).toThrowError(/GBP API fetchPerformanceReport failed \(parse_error\)/)
    expect(oversized.every((byte) => byte === 0)).toBe(true)
  })

  it('propagates cancellation while still overwriting the raw buffer', () => {
    const body = encode({})
    const controller = new AbortController()
    controller.abort()
    expect(() =>
      parseGooglePerformanceResponse({
        body,
        requestedMetrics: GOOGLE_PERFORMANCE_DAILY_METRICS,
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
        signal: controller.signal,
      }),
    ).toThrowError(/aborted/i)
    expect(body.every((byte) => byte === 0)).toBe(true)
  })

  it('returns a content-free classified parse error', () => {
    const body = encode({
      multiDailyMetricTimeSeries: [
        { dailyMetricTimeSeries: [metricSeries('UNKNOWN_NEW_METRIC', [])] },
      ],
    })
    try {
      parseGooglePerformanceResponse({
        body,
        requestedMetrics: GOOGLE_PERFORMANCE_DAILY_METRICS,
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      })
      throw new Error('expected parser failure')
    } catch (error) {
      expect(isGbpApiError(error)).toBe(true)
      if (!isGbpApiError(error)) return
      expect(error.kind).toBe('parse_error')
      expect(error.providerBodyBytes).toBeGreaterThan(0)
      expect(JSON.stringify(error)).not.toContain('UNKNOWN_NEW_METRIC')
    }
  })
})
