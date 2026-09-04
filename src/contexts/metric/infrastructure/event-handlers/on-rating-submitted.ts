// Metric context — records portal.rating metric on rating submission events
import type { GuestRatingSubmitted } from '#/contexts/guest/application/public-api'
import {
  makeDurableRecordMetricFanoutHandler,
  makeRecordMetricFanoutHandler,
} from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

const options = [
  {
    metricKey: 'portal.rating',
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
    sourcePolicy: 'first_party_guest_private',
    span: 'metric.event.onRatingSubmitted',
    value: (event: GuestRatingSubmitted) => event.value,
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
  {
    metricKey: 'portal.rating_count',
    definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
    sourcePolicy: 'first_party_guest_gateway_metric',
    span: 'metric.event.onRatingSubmitted',
    value: () => 1,
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
  {
    metricKey: 'portal.rating_average',
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
    sourcePolicy: 'first_party_guest_gateway_metric',
    span: 'metric.event.onRatingSubmitted',
    value: (event: GuestRatingSubmitted) => event.value,
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
] as const

export const onRatingSubmitted =
  makeRecordMetricFanoutHandler<GuestRatingSubmitted>(options)
export const onRatingSubmittedDurably =
  makeDurableRecordMetricFanoutHandler<GuestRatingSubmitted>(options)
