import type { GuestRatingRetracted } from '#/contexts/guest/application/public-api'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import {
  makeDurablePortalMetricRetractionHandler,
  makePortalMetricRetractionHandler,
} from './retract-portal-metric'

const options = [
  {
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
    span: 'metric.event.onRatingRetracted',
  },
  {
    definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
    span: 'metric.event.onRatingRetracted',
  },
  {
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
    span: 'metric.event.onRatingRetracted',
  },
] as const

export const onRatingRetracted =
  makePortalMetricRetractionHandler<GuestRatingRetracted>(options)

export const onRatingRetractedDurably =
  makeDurablePortalMetricRetractionHandler<GuestRatingRetracted>(options)
