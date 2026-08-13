// Metric context — records portal.rating metric on rating submission events
import type { GuestRatingSubmitted } from '#/contexts/guest/application/public-api'
import { makeRecordMetricHandler } from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

export const onRatingSubmitted = makeRecordMetricHandler<GuestRatingSubmitted>({
  metricKey: 'portal.rating',
  definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
  sourcePolicy: 'first_party_guest_private',
  span: 'metric.event.onRatingSubmitted',
  value: (event) => event.value,
})
