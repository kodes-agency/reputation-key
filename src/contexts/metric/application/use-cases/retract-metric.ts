import type {
  RetractMetricCommand,
  RetractMetricResult,
  MetricCommandStore,
} from '../ports/metric-command-store.port'

export type RetractMetric = (input: RetractMetricCommand) => Promise<RetractMetricResult>

export const retractMetric = (commandStore: MetricCommandStore): RetractMetric =>
  commandStore.retractMetric
