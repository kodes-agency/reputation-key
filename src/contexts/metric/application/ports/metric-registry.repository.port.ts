import type { GovernedMetricVersion } from '../../domain/metric-registry'

export type MetricRegistryRepository = Readonly<{
  findVersionById(definitionVersionId: string): Promise<GovernedMetricVersion | null>
}>
