// Metric context — metric repository port
// Per architecture: "Repository ports for all data access."

import type { MetricKey, MetricReading } from '../../domain/types'

export type MetricRepository = Readonly<{
  insertReading(reading: Omit<MetricReading, 'id'>): Promise<MetricReading>
  findByOrganizationId(
    orgId: string,
    metricKey?: MetricKey,
  ): Promise<ReadonlyArray<MetricReading>>
}>
