// Metric context — records portal.scan metric on scan events
import type { GuestScanRecorded } from '#/contexts/guest/application/public-api'
import { makeRecordMetricHandler } from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

export const onScanRecorded = makeRecordMetricHandler<GuestScanRecorded>({
  metricKey: 'portal.scan',
  definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
  sourcePolicy: 'review_solicitation_analytics_only',
  span: 'metric.event.onScanRecorded',
})
