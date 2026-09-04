// Metric context — records portal.feedback metric on feedback submission events
import type { GuestFeedbackSubmitted } from '#/contexts/guest/application/public-api'
import {
  makeDurableRecordMetricHandler,
  makeRecordMetricHandler,
} from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

const options = {
  metricKey: 'portal.feedback',
  definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
  sourcePolicy: 'first_party_guest_private',
  span: 'metric.event.onFeedbackSubmitted',
  sourceReceiptConsumer: 'metric.guest-analytics',
} as const

export const onFeedbackSubmitted =
  makeRecordMetricHandler<GuestFeedbackSubmitted>(options)
export const onFeedbackSubmittedDurably =
  makeDurableRecordMetricHandler<GuestFeedbackSubmitted>(options)
