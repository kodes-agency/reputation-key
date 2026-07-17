// Review context — Drizzle refresh sweep run repository (BQC-1.5).

import { desc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviewRefreshRuns } from '#/shared/db/schema/review-sync.schema'
import type {
  CreateRefreshRunInput,
  RefreshRun,
  RefreshRunPatch,
  ReviewRefreshRunRepository,
} from '../../application/ports/review-refresh-run.repository'
import { trace } from '#/shared/observability/trace'

type Row = typeof reviewRefreshRuns.$inferSelect

const fromRow = (row: Row): RefreshRun => ({
  id: row.id,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  cursorContentExpiresAt: row.cursorContentExpiresAt,
  cursorReviewId: row.cursorReviewId,
  batchSize: row.batchSize,
  maxBatches: row.maxBatches,
  batchesProcessed: row.batchesProcessed,
  candidatesSeen: row.candidatesSeen,
  refreshDueCount: row.refreshDueCount,
  enqueuedCount: row.enqueuedCount,
  enqueueFailedCount: row.enqueueFailedCount,
  oldestDueContentExpiresAt: row.oldestDueContentExpiresAt,
  status: row.status as RefreshRun['status'],
  failureReason: row.failureReason,
  nextAttemptAt: row.nextAttemptAt,
})

export const createReviewRefreshRunRepository = (
  db: Database,
): ReviewRefreshRunRepository => ({
  createRun: async (input: CreateRefreshRunInput) => {
    return trace('review.refreshRun.create', async () => {
      const rows = await db
        .insert(reviewRefreshRuns)
        .values({
          batchSize: input.batchSize,
          maxBatches: input.maxBatches,
          cursorContentExpiresAt: input.cursor?.contentExpiresAt ?? null,
          cursorReviewId: input.cursor?.reviewId ?? null,
        })
        .returning()
      if (!rows[0]) throw new Error('refresh run insert failed — no row returned')
      return fromRow(rows[0])
    })
  },

  updateRun: async (id: string, patch: RefreshRunPatch) => {
    return trace('review.refreshRun.update', async () => {
      await db
        .update(reviewRefreshRuns)
        .set({
          ...(patch.cursor !== undefined
            ? {
                cursorContentExpiresAt: patch.cursor?.contentExpiresAt ?? null,
                cursorReviewId: patch.cursor?.reviewId ?? null,
              }
            : {}),
          ...(patch.batchesProcessed !== undefined
            ? { batchesProcessed: patch.batchesProcessed }
            : {}),
          ...(patch.candidatesSeen !== undefined
            ? { candidatesSeen: patch.candidatesSeen }
            : {}),
          ...(patch.refreshDueCount !== undefined
            ? { refreshDueCount: patch.refreshDueCount }
            : {}),
          ...(patch.enqueuedCount !== undefined
            ? { enqueuedCount: patch.enqueuedCount }
            : {}),
          ...(patch.enqueueFailedCount !== undefined
            ? { enqueueFailedCount: patch.enqueueFailedCount }
            : {}),
          ...(patch.oldestDueContentExpiresAt !== undefined
            ? { oldestDueContentExpiresAt: patch.oldestDueContentExpiresAt }
            : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.failureReason !== undefined
            ? { failureReason: patch.failureReason }
            : {}),
          ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
          ...(patch.nextAttemptAt !== undefined
            ? { nextAttemptAt: patch.nextAttemptAt }
            : {}),
        })
        .where(eq(reviewRefreshRuns.id, id))
    })
  },

  findLatestRun: async () => {
    return trace('review.refreshRun.findLatest', async () => {
      const rows = await db
        .select()
        .from(reviewRefreshRuns)
        .orderBy(desc(reviewRefreshRuns.startedAt))
        .limit(1)
      return rows[0] ? fromRow(rows[0]) : null
    })
  },
})
