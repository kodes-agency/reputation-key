import type { MetricRegistryRepository } from '../../application/ports/metric-registry.repository.port'
import { findMetricVersionById } from '../../readings/contracts'

export const createMetricRegistryRepository = (): MetricRegistryRepository => ({
  findVersionById: async (definitionVersionId) =>
    findMetricVersionById(definitionVersionId),
})
