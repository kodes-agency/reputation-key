import type { GoalMetricAggregateQuery } from './metric.repository'

export type GoalMetricSourceStatus = Readonly<{
  state: 'complete' | 'pending' | 'unavailable' | 'quarantined'
  relevantFactCount: number
  pendingFactCount: number
  reason: string | null
}>

/**
 * Proves durable projection completeness from source facts and consumer
 * receipts. A high timestamp alone is not sufficient because older jobs may
 * still be pending.
 */
export type GoalMetricSourceStatusPort = Readonly<{
  inspect(
    query: GoalMetricAggregateQuery,
    eventTypes: readonly string[],
  ): Promise<GoalMetricSourceStatus>
}>
