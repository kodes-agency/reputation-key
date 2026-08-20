import { METRIC_KEYS, type MetricKey } from '#/shared/domain/metric-keys'
import { metricError } from './errors'
import { createReading, type MetricReading } from './metric-reading'

export const VALID_METRIC_KEYS: ReadonlySet<MetricKey> = new Set(METRIC_KEYS)

export const createMetricReading = (
  input: Parameters<typeof createReading>[0],
): MetricReading => {
  if (!Number.isFinite(input.value) || input.value < 0) {
    throw metricError(
      'invalid_value',
      `Metric value must be finite and >= 0, got ${input.value}`,
    )
  }
  if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) {
    throw metricError('missing_required_field', 'occurredAt must be a valid Date')
  }
  if (!VALID_METRIC_KEYS.has(input.metricKey)) {
    throw metricError('unknown_metric_key', `Invalid metricKey: ${input.metricKey}`)
  }
  return createReading(input)
}
