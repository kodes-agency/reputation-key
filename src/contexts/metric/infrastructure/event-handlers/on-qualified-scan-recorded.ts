import type { GuestQualifiedScanRecorded } from '#/contexts/guest/application/public-api'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import {
  makeDurableRecordMetricHandler,
  makeRecordMetricHandler,
} from './record-portal-metric'

const options = {
  metricKey: 'portal.qualified_scan',
  definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
  sourcePolicy: 'first_party_guest_gateway_metric',
  span: 'metric.event.onQualifiedScanRecorded',
  portalGroupId: (event: GuestQualifiedScanRecorded) => event.portalGroupId,
  sourceReceiptConsumer: 'metric.guest-analytics',
} as const

export const onQualifiedScanRecorded =
  makeRecordMetricHandler<GuestQualifiedScanRecorded>(options)

export const onQualifiedScanRecordedDurably =
  makeDurableRecordMetricHandler<GuestQualifiedScanRecorded>(options)
