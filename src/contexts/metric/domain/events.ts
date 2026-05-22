import type {
  MetricReadingId,
  OrganizationId,
  PropertyId,
  PortalId,
  StaffId,
} from '#/shared/domain/ids'
import type { MetricKey } from './types'

export type MetricRecorded = Readonly<{
  _tag: 'metric.recorded'
  metricReadingId: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  metricKey: MetricKey
  value: number
  staffId: StaffId | null
  occurredAt: Date
}>

export const metricRecorded = (
  payload: Omit<MetricRecorded, '_tag'>,
): MetricRecorded => ({
  _tag: 'metric.recorded',
  ...payload,
})

export type MetricEvent = MetricRecorded
