// Metric context — records portal.scan metric on scan events
import type { GuestScanRecorded } from '#/contexts/guest/application/public-api'
import {
  makeDurableRecordMetricHandler,
  makeRecordMetricHandler,
} from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

const options = {
  metricKey: 'portal.scan',
  definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
  sourcePolicy: 'review_solicitation_analytics_only',
  span: 'metric.event.onScanRecorded',
} as const

export const onScanRecorded = makeRecordMetricHandler<GuestScanRecorded>(options)
export const onScanRecordedDurably =
  makeDurableRecordMetricHandler<GuestScanRecorded>(options)
