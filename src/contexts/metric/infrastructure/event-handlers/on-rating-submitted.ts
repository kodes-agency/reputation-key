// Metric context — records portal.rating metric on rating submission events
import type { GuestRatingSubmitted } from '#/contexts/guest/application/public-api'
import { makeRecordMetricHandler } from './record-portal-metric'

export const onRatingSubmitted = makeRecordMetricHandler<GuestRatingSubmitted>({
  metricKey: 'portal.rating',
  span: 'metric.event.onRatingSubmitted',
  value: (event) => event.value,
})
