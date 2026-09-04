import type {
  RetractMetricCommand,
  RetractMetricResult,
  MetricCommandStore,
} from '../ports/metric-command-store.port'

export type RetractMetric = (input: RetractMetricCommand) => Promise<RetractMetricResult>
export type RetractMetrics = (
  inputs: readonly RetractMetricCommand[],
  sourceReceipt?: NonNullable<RetractMetricCommand['sourceReceipt']>,
) => Promise<readonly RetractMetricResult[]>

export const retractMetric = (commandStore: MetricCommandStore): RetractMetric =>
  commandStore.retractMetric

export const retractMetrics = (commandStore: MetricCommandStore): RetractMetrics =>
  commandStore.retractMetrics
