// Metric context — metric repository port
// Per architecture: "Repository ports for all data access."

import type { MetricKey, MetricReading } from '../../domain/types'
import type { OrganizationId, PropertyId, PortalId, StaffId } from '#/shared/domain/ids'

export type MetricReadingsQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  staffId: StaffId | null
  metricKey: MetricKey
  periodStart?: Date
  periodEnd?: Date
  rollingWindowDays?: number
}>

export type MetricReadingsAggregate = Readonly<{
  sum: number
  count: number
  max: number
}>

export type MetricRepository = Readonly<{
  insertReading(reading: Omit<MetricReading, 'id'>): Promise<MetricReading>
  findByOrganizationId(
    orgId: OrganizationId,
    metricKey?: MetricKey,
  ): Promise<ReadonlyArray<MetricReading>>
  queryAggregate(query: MetricReadingsQuery): Promise<MetricReadingsAggregate>
}>
