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
import type { MetricKey } from './types'

export type MetricRecorded = Readonly<{
  _tag: 'metric.recorded'
  eventId: string
  readingId: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  groupId: PortalGroupId | null
  metricKey: MetricKey
  value: number
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

export type MetricEvent = MetricRecorded
