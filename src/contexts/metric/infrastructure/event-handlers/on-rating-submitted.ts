// Metric context — records portal.rating metric on rating submission events
import type { GuestRatingSubmitted } from '#/contexts/guest/application/public-api'
import {
  makeDurableRecordMetricHandler,
  makeRecordMetricHandler,
} from './record-portal-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

const options = {
  metricKey: 'portal.rating',
  definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
  sourcePolicy: 'first_party_guest_private',
  span: 'metric.event.onRatingSubmitted',
  value: (event: GuestRatingSubmitted) => event.value,
} as const

export const onRatingSubmitted = makeRecordMetricHandler<GuestRatingSubmitted>(options)
export const onRatingSubmittedDurably =
  makeDurableRecordMetricHandler<GuestRatingSubmitted>(options)
