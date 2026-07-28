// Metric context — records portal.scan metric on scan events
import type { GuestScanRecorded } from '#/contexts/guest/application/public-api'
import { makeRecordMetricHandler } from './record-portal-metric'

export const onScanRecorded = makeRecordMetricHandler<GuestScanRecorded>({
  metricKey: 'portal.scan',
  span: 'metric.event.onScanRecorded',
})
