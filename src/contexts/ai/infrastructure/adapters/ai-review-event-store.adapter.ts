import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  AiReviewEventConsumeResult,
  AiReviewEventStorePort,
} from '../../application/ports/ai-review-event-store.port'

function safeSequence(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null
}

export const createAiReviewEventStoreAdapter = (db: Database): AiReviewEventStorePort => {
  return {
    async consumeNext(input): Promise<AiReviewEventConsumeResult> {
      const result = await db.execute(sql`
        SELECT *
        FROM consume_ai_review_event_v1(
          ${input.organizationId},
          ${input.propertyId}::uuid,
          ${input.sourceEpoch},
          ${input.reviewAnalysisEpoch},
          ${input.analysisStartSequence},
          ${input.analysisSequence},
          ${input.eventEnvelopeId}::uuid,
          ${input.disposition}
        )
      `)
      if (result.rows.length !== 1) return { status: 'generation_changed' }
      const row = result.rows[0] as Readonly<Record<string, unknown>>
      const status = row.status
      if (status === 'gap') {
        const expectedSequence = safeSequence(row.expected_sequence)
        return expectedSequence === null
          ? { status: 'generation_changed' }
          : { status, expectedSequence }
      }
      if (status !== 'accepted' && status !== 'duplicate') {
        return { status: 'generation_changed' }
      }
      const consumedSequence = safeSequence(row.consumed_sequence)
      const terminalAnalysisSequence = safeSequence(row.terminal_analysis_sequence)
      if (consumedSequence === null || terminalAnalysisSequence === null) {
        return { status: 'generation_changed' }
      }
      return { status, consumedSequence, terminalAnalysisSequence }
    },

    async settleOutcome(input) {
      const result = await db.execute(sql`
        SELECT *
        FROM settle_ai_review_analysis_outcome_v1(
          ${input.organizationId},
          ${input.propertyId}::uuid,
          ${input.sourceEpoch},
          ${input.reviewAnalysisEpoch},
          ${input.analysisSequence},
          ${input.state},
          ${input.operationId}::uuid,
          ${input.dispositionCode}
        )
      `)
      if (result.rows.length !== 1) return null
      const row = result.rows[0] as Readonly<Record<string, unknown>>
      const terminalAnalysisSequence = safeSequence(row.terminal_analysis_sequence)
      const aggregateRevision = safeSequence(row.aggregate_revision)
      return terminalAnalysisSequence === null || aggregateRevision === null
        ? null
        : { terminalAnalysisSequence, aggregateRevision }
    },
  }
}
