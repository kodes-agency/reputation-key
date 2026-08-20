// Metric context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type {
  MetricReadingId,
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'
import type { AttributionQuality } from './attribution-quality'
import type { PermittedConsumer, SourcePolicyClass } from './metric-registry'
import type { MetricKey } from '#/shared/domain/metric-keys'

export type MetricRecorded = Readonly<{
  _tag: 'metric.recorded'
  eventId: string
  readingId: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  portalGroupId: PortalGroupId | null
  definitionVersionId: string
  sourceEventId: string
  sourcePolicy: SourcePolicyClass
  metricKey: MetricKey
  value: number
  numerator: number | null
  denominator: number | null
  sampleCount: number
  attributionQuality: AttributionQuality
  permittedConsumers: readonly PermittedConsumer[]
  occurredAt: Date
  correlationId: string | null
}>
export const metricRecorded = (
  args: Omit<MetricRecorded, '_tag' | 'correlationId' | 'eventId'>,
): MetricRecorded => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'metric.recorded',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type MetricCorrected = Readonly<{
  _tag: 'metric.corrected'
  eventId: string
  correctionId: string
  correctedReadingId: MetricReadingId
  replacementReadingId: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  definitionVersionId: string
  sourceEventId: string
  supersededSourceEventId: string
  occurredAt: Date
  correlationId: string | null
}>

export const metricCorrected = (
  args: Omit<MetricCorrected, '_tag' | 'correlationId' | 'eventId'>,
): MetricCorrected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'metric.corrected',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type MetricEvent = MetricRecorded | MetricCorrected
