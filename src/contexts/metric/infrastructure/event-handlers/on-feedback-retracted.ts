import type { GuestFeedbackRetracted } from '#/contexts/guest/application/public-api'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import {
  makeDurablePortalMetricRetractionHandler,
  makePortalMetricRetractionHandler,
} from './retract-portal-metric'

const options = [
  {
    definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
    span: 'metric.event.onFeedbackRetracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
] as const

export const onFeedbackRetracted =
  makePortalMetricRetractionHandler<GuestFeedbackRetracted>(options)

export const onFeedbackRetractedDurably =
  makeDurablePortalMetricRetractionHandler<GuestFeedbackRetracted>(options)
