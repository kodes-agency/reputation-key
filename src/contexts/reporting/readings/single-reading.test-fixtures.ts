import type {
  MetricCommandStore,
  RecordMetricCommand,
  RetractMetricCommand,
} from './metric-command-store.port.server'
import {
  recordMetrics,
  type RecordMetric,
  type RecordMetricDeps,
} from './record-metric.server'

/** One-reading forms of the batch store operations, for tests. */
export const recordOne = async (
  store: MetricCommandStore,
  command: RecordMetricCommand,
) => {
  const { sourceReceipt, ...entry } = command
  const [result] = await store.recordMetrics({ readings: [entry], sourceReceipt })
  if (!result) throw new Error('Metric command produced no result')
  return result
}

export const retractOne = async (
  store: MetricCommandStore,
  command: RetractMetricCommand,
) => {
  const { sourceReceipt, ...entry } = command
  const [result] = await store.retractMetrics([entry], sourceReceipt)
  if (!result) throw new Error('Metric retraction produced no result')
  return result
}

export const recordMetric =
  (deps: RecordMetricDeps): RecordMetric =>
  async (input) => {
    const { sourceReceipt, ...reading } = input
    const [result] = await recordMetrics(deps)({ readings: [reading], sourceReceipt })
    if (!result) throw new Error('Metric command produced no result')
    return result
  }
