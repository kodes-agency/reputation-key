// Unconditional queue seam for local AI authorization-derivative erasure.
//
// This job stays outside the AI context for the same reason as the AI
// execution reaper: disabling AI execution must never disable cleanup. The
// concrete store/use case is supplied by composition; this shared seam sees
// counts only and writes the existing content-free retention evidence signal.

import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import {
  closeRetentionRun,
  failRetentionRun,
  openRetentionRun,
} from '#/shared/db/retention/evidence'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'ai-authorization-derivative-erasure' as const
export const AI_AUTHORIZATION_ERASURE_RETENTION_SUBJECT =
  'ai.authorization_derivatives' as const

const jobDataSchema = z.object({}).strict()

type AiAuthorizationErasureJobResult = Readonly<{
  claimed: number
  completed: number
  retryScheduled: number
  terminalFailed: number
  lostClaims: number
  deleted: Readonly<{
    reviewAnalysis: number
    propertyAggregate: number
    propertyTrend: number
    total: number
  }>
  batchFull: boolean
  backlog: Readonly<{
    pending: number
    inProgress: number
    terminalFailed: number
    overdue: number
  }>
}>

type AiAuthorizationErasureJobDependencies = Readonly<{
  db: Database
  clock: () => Date
  batchSize: number
  erase: () => Promise<AiAuthorizationErasureJobResult>
}>

const operationalFailureCode = (
  result: AiAuthorizationErasureJobResult,
): string | null => {
  if (result.backlog.overdue > 0) return 'ai_erasure_deadline_breached'
  if (result.terminalFailed > 0 || result.backlog.terminalFailed > 0) {
    return 'ai_erasure_attempts_exhausted'
  }
  if (result.retryScheduled > 0) return 'ai_erasure_retry_scheduled'
  if (result.lostClaims > 0) return 'ai_erasure_claim_lost'
  return null
}

export const createAiAuthorizationErasureHandler =
  (
    dependencies: AiAuthorizationErasureJobDependencies,
  ): ((job: Job) => Promise<AiAuthorizationErasureJobResult>) =>
  async (job) =>
    trace(`job.${JOB_NAME}`, async () => {
      jobDataSchema.parse(job.data)
      const startedAt = dependencies.clock()
      const runId = await openRetentionRun(
        dependencies.db,
        AI_AUTHORIZATION_ERASURE_RETENTION_SUBJECT,
        dependencies.batchSize,
        startedAt,
      )

      let result: AiAuthorizationErasureJobResult
      try {
        result = await dependencies.erase()
        if (
          !Number.isSafeInteger(result.deleted.total) ||
          result.deleted.total < 0 ||
          result.deleted.total > 2_147_483_647
        ) {
          throw new Error('ai_erasure_evidence_count_invalid')
        }
      } catch {
        const safeFailure = new Error('ai_erasure_worker_failed')
        await failRetentionRun(dependencies.db, runId, dependencies.clock(), safeFailure)
        throw new Error('AI authorization erasure worker failed')
      }

      const failureCode = operationalFailureCode(result)
      await closeRetentionRun(dependencies.db, runId, {
        finishedAt: dependencies.clock(),
        batches: result.claimed > 0 ? 1 : 0,
        rowsDeleted: result.deleted.total,
        outcome: failureCode ? 'failed' : 'completed',
        ...(failureCode ? { errorCode: failureCode } : {}),
      })
      getLogger().info(
        {
          job: JOB_NAME,
          claimed: result.claimed,
          completed: result.completed,
          retryScheduled: result.retryScheduled,
          terminalFailed: result.terminalFailed,
          lostClaims: result.lostClaims,
          reviewAnalysisDeleted: result.deleted.reviewAnalysis,
          propertyAggregateDeleted: result.deleted.propertyAggregate,
          propertyTrendDeleted: result.deleted.propertyTrend,
          batchFull: result.batchFull,
          pending: result.backlog.pending,
          inProgress: result.backlog.inProgress,
          failed: result.backlog.terminalFailed,
          overdue: result.backlog.overdue,
        },
        'AI authorization derivative erasure sweep completed',
      )
      if (failureCode) {
        throw new Error('AI authorization erasure requires recovery')
      }
      return result
    })
