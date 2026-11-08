import type { GovernedMetricVersion } from '../../readings/contracts'

export type MetricRegistryRepository = Readonly<{
  findVersionById(definitionVersionId: string): Promise<GovernedMetricVersion | null>
}>
