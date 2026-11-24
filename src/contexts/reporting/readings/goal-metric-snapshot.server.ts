import type { Database } from '#/shared/db'
import type { QueryGoalMetricDeps } from './query-goal-metric.server'
import { inspectGoalMetricSourceStatus } from './goal-metric-source-status.server'
import { queryGoalAggregate } from './metric-repository.server'
import { readGoalMetricSourceHead } from './goal-metric-source-head.server'

/** A receipt committed after the total was read cannot certify that older total. */
export const createGoalMetricSnapshotReader =
  (db: Database): QueryGoalMetricDeps['readSnapshot'] =>
  (query, eventTypes) =>
    db.transaction(
      async (tx) => {
        const aggregate = await queryGoalAggregate(tx, query)
        const source = await inspectGoalMetricSourceStatus(tx, query, eventTypes)
        const sourceHead = await readGoalMetricSourceHead(tx, query, eventTypes)
        return { aggregate, source, sourceHead }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
