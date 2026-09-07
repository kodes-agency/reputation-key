import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  AiReviewEventConsumeResult,
  AiReviewEventStorePort,
} from '../../application/ports/ai-review-event-store.port'

type AggregateHeadRow = Readonly<{
  terminal_analysis_sequence: number | string | null
  aggregate_revision: number | string | null
}>

function safeInteger(value: number | string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : (value ?? 0)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('AI aggregate head contains an invalid sequence')
  }
  return parsed
}

export const createAiReviewEventStoreAdapter = (db: Database): AiReviewEventStorePort => {
  async function currentHead(input: {
    organizationId: string
    propertyId: string
    sourceEpoch: number
    reviewAnalysisEpoch: number
  }): Promise<Readonly<{ terminal: number; revision: number }>> {
    const result = await db.execute(sql<AggregateHeadRow>`
      SELECT
        max(terminal_analysis_sequence) AS terminal_analysis_sequence,
        max(aggregate_revision) AS aggregate_revision
      FROM ai_property_aggregate_heads
      WHERE organization_id = ${input.organizationId}
        AND property_id = ${input.propertyId}::uuid
        AND source_epoch = ${input.sourceEpoch}
        AND review_analysis_epoch = ${input.reviewAnalysisEpoch}
    `)
    const row = result.rows[0] as AggregateHeadRow | undefined
    return {
      terminal: safeInteger(row?.terminal_analysis_sequence),
      revision: safeInteger(row?.aggregate_revision),
    }
  }

  return Object.freeze({
    async consumeNext(input): Promise<AiReviewEventConsumeResult> {
      const head = await currentHead(input)
      const terminal = Math.max(head.terminal, input.analysisStartSequence)
      if (input.analysisSequence <= terminal) {
        return {
          status: 'duplicate',
          consumedSequence: terminal,
          terminalAnalysisSequence: terminal,
        }
      }
      if (input.analysisSequence !== terminal + 1) {
        return { status: 'gap', expectedSequence: terminal + 1 }
      }
      return {
        status: 'accepted',
        consumedSequence: input.analysisSequence,
        terminalAnalysisSequence: terminal,
      }
    },

    async settleOutcome(input) {
      const head = await currentHead(input)
      return {
        terminalAnalysisSequence: Math.max(head.terminal, input.analysisSequence),
        aggregateRevision: head.revision,
      }
    },
  })
}
