import type { GuestQualifiedScanRetracted } from '#/contexts/guest/application/public-api'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import {
  makeDurablePortalMetricRetractionHandler,
  makePortalMetricRetractionHandler,
} from './retract-portal-metric'

const options = [
  {
    definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
    span: 'metric.event.onQualifiedScanRetracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
] as const

export const onQualifiedScanRetracted =
  makePortalMetricRetractionHandler<GuestQualifiedScanRetracted>(options)

export const onQualifiedScanRetractedDurably =
  makeDurablePortalMetricRetractionHandler<GuestQualifiedScanRetracted>(options)
