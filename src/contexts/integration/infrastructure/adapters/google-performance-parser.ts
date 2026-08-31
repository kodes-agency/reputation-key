import { z } from 'zod/v4'
import {
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
  MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES,
  isGooglePerformanceDailyMetric,
  type GoogleDailyMetric,
  type GooglePerformanceSourceReport,
} from '../../application/google-provider-contract'
import { createGbpApiError } from '../../domain/gbp-api-error'

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const INTEGER_VALUE = /^(0|[1-9][0-9]*)$/
const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

const providerDateSchema = z.looseObject({
  year: z.number().int().safe(),
  month: z.number().int().safe(),
  day: z.number().int().safe(),
})
const datedValueSchema = z.looseObject({
  date: providerDateSchema,
  value: z.string().optional(),
})
const metricSeriesSchema = z.looseObject({
  dailyMetric: z.enum(GOOGLE_PERFORMANCE_DAILY_METRICS),
  dailySubEntityType: z.never().optional(),
  timeSeries: z.looseObject({
    datedValues: z.array(datedValueSchema).optional(),
  }),
})
const performanceResponseSchema = z.looseObject({
  multiDailyMetricTimeSeries: z
    .array(
      z.looseObject({
        dailyMetricTimeSeries: z.array(metricSeriesSchema).optional(),
      }),
    )
    .optional(),
})

function parseLocalDate(value: unknown): string | null {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (year < 1 || month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth ? value : null
}

function parseProviderDate(value: z.infer<typeof providerDateSchema>): string | null {
  const { year, month, day } = value
  if (year < 1 || year > 9_999 || month < 1 || month > 12 || day < 1) {
    return null
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseGooglePerformanceResponse(
  input: Readonly<{
    body: Uint8Array
    requestedMetrics: readonly string[]
    startLocalDate: string
    endLocalDate: string
    signal?: AbortSignal
  }>,
): GooglePerformanceSourceReport {
  const providerBodyBytes = input.body.byteLength
  const malformed = (): never => {
    throw createGbpApiError('fetchPerformanceReport', 'parse_error', {
      providerBodyBytes,
    })
  }

  try {
    input.signal?.throwIfAborted()
    if (providerBodyBytes > MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES) malformed()
    const startLocalDate = parseLocalDate(input.startLocalDate)
    const endLocalDate = parseLocalDate(input.endLocalDate)
    if (
      startLocalDate === null ||
      endLocalDate === null ||
      startLocalDate > endLocalDate
    ) {
      return malformed()
    }

    const requested = new Set<string>()
    for (const metric of input.requestedMetrics) {
      if (!isGooglePerformanceDailyMetric(metric)) malformed()
      if (requested.has(metric)) malformed()
      requested.add(metric)
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(utf8Decoder.decode(input.body))
    } catch {
      malformed()
    }
    input.signal?.throwIfAborted()
    const parsed = performanceResponseSchema.safeParse(decoded)
    if (!parsed.success) return malformed()

    const rawGroups = parsed.data.multiDailyMetricTimeSeries
    const seenMetrics = new Set<GoogleDailyMetric>()
    const series: Array<{
      metric: GoogleDailyMetric
      points: ReadonlyArray<{ localDate: string; value: number }>
    }> = []

    for (const rawGroup of rawGroups ?? []) {
      input.signal?.throwIfAborted()
      for (const rawMetricSeries of rawGroup.dailyMetricTimeSeries ?? []) {
        const metric = rawMetricSeries.dailyMetric
        if (!requested.has(metric) || seenMetrics.has(metric)) {
          malformed()
        }
        const rawDatedValues = rawMetricSeries.timeSeries.datedValues

        const seenDates = new Set<string>()
        const points: Array<{ localDate: string; value: number }> = []
        for (const rawDatedValue of rawDatedValues ?? []) {
          const localDate = parseProviderDate(rawDatedValue.date)
          if (localDate === null) return malformed()
          if (
            localDate < startLocalDate ||
            localDate > endLocalDate ||
            seenDates.has(localDate)
          ) {
            malformed()
          }
          const rawValue = rawDatedValue.value
          if (rawValue !== undefined && !INTEGER_VALUE.test(rawValue)) {
            malformed()
          }
          const exactValue = rawValue === undefined ? 0n : BigInt(rawValue)
          if (exactValue > BigInt(MAX_GOOGLE_PERFORMANCE_DAILY_VALUE)) malformed()
          seenDates.add(localDate)
          points.push(Object.freeze({ localDate, value: Number(exactValue) }))
        }
        points.sort((left, right) => left.localDate.localeCompare(right.localDate))
        seenMetrics.add(metric)
        series.push(Object.freeze({ metric, points: Object.freeze(points) }))
      }
    }

    return Object.freeze({
      requestedRange: Object.freeze({ startLocalDate, endLocalDate }),
      series: Object.freeze(series),
    })
  } finally {
    input.body.fill(0)
  }
}
