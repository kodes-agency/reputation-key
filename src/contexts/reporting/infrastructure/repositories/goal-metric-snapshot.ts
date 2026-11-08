import type { Database } from '#/shared/db'
import type { QueryGoalMetricDeps } from '../../application/use-cases/query-goal-metric'
import { createGoalMetricSourceStatus } from './goal-metric-source-status'
import { createMetricRepository } from './metric.repository'
import { readGoalMetricSourceHead } from './goal-metric-source-head'

/** A receipt committed after the total was read cannot certify that older total. */
export const createGoalMetricSnapshotReader =
  (db: Database): QueryGoalMetricDeps['readSnapshot'] =>
  (query, eventTypes) =>
    db.transaction(
      async (tx) => {
        const aggregate = await createMetricRepository(tx).queryGoalAggregate(query)
        const source = await createGoalMetricSourceStatus(tx).inspect(query, eventTypes)
        const sourceHead = await readGoalMetricSourceHead(tx, query, eventTypes)
        return { aggregate, source, sourceHead }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
