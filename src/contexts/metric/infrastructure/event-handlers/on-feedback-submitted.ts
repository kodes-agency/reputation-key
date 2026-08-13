// Metric context — records portal.feedback metric on feedback submission events
import type { GuestFeedbackSubmitted } from '#/contexts/guest/application/public-api'
import { makeRecordMetricHandler } from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

export const onFeedbackSubmitted = makeRecordMetricHandler<GuestFeedbackSubmitted>({
  metricKey: 'portal.feedback',
  definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
  sourcePolicy: 'first_party_guest_private',
  span: 'metric.event.onFeedbackSubmitted',
})
