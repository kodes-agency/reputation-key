// Metric context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

import { createErrorFactory } from '#/shared/domain/errors'

export type MetricErrorCode =
  'unknown_metric_key' | 'invalid_value' | 'repo_insert_failed' | 'missing_required_field'
export type MetricError = Readonly<{
  _tag: 'MetricError'
  code: MetricErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const metricError = createErrorFactory<MetricError['_tag'], MetricError['code']>(
  'MetricError',
)

export const isMetricError = (e: unknown): e is MetricError =>
  typeof e === 'object' &&
  e !== null &&
  '_tag' in e &&
  (e as { _tag: string })._tag === 'MetricError'
