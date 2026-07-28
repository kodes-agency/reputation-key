// Metric context — records portal.feedback metric on feedback submission events
import type { GuestFeedbackSubmitted } from '#/contexts/guest/application/public-api'
import { makeRecordMetricHandler } from './record-portal-metric'

export const onFeedbackSubmitted = makeRecordMetricHandler<GuestFeedbackSubmitted>({
  metricKey: 'portal.feedback',
  span: 'metric.event.onFeedbackSubmitted',
})
