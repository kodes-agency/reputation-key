// Review context — refresh sweep run repository integration tests (BQC-1.5).
// Proves the run record round-trips: create, per-batch updates, latest-run
// resume lookup — content-free operational state.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDb } from '#/shared/db'
import { createReviewRefreshRunRepository } from './review-refresh-run.repository'
import { sql } from 'drizzle-orm'

const db = getDb()

describe('reviewRefreshRunRepository (integration)', () => {
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM review_refresh_runs`)
  })

  afterAll(async () => {
    await db.execute(sql`DELETE FROM review_refresh_runs`)
  })

  it('creates a run, applies patches, and finds it as latest', async () => {
    const repo = createReviewRefreshRunRepository(db)
    const cursor = {
      contentExpiresAt: new Date('2026-08-01T00:00:00Z'),
      reviewId: 'aa000000-0000-4000-8000-0000000000c1',
    }

    const run = await repo.createRun({ batchSize: 500, maxBatches: 10, cursor })
    expect(run.status).toBe('running')
    expect(run.cursorContentExpiresAt).toEqual(cursor.contentExpiresAt)
    expect(run.cursorReviewId).toBe(cursor.reviewId)

    await repo.updateRun(run.id, {
      batchesProcessed: 3,
      candidatesSeen: 1500,
      refreshDueCount: 1400,
      enqueuedCount: 37,
      oldestDueContentExpiresAt: cursor.contentExpiresAt,
    })

    await repo.updateRun(run.id, {
      status: 'budget_exhausted',
      finishedAt: new Date('2026-07-17T13:00:00Z'),
      nextAttemptAt: new Date('2026-07-17T14:00:00Z'),
    })

    const latest = await repo.findLatestRun()
    expect(latest).not.toBeNull()
    expect(latest!.id).toBe(run.id)
    expect(latest!.status).toBe('budget_exhausted')
    expect(latest!.batchesProcessed).toBe(3)
    expect(latest!.candidatesSeen).toBe(1500)
    expect(latest!.enqueuedCount).toBe(37)
    expect(latest!.oldestDueContentExpiresAt).toEqual(cursor.contentExpiresAt)
    expect(latest!.nextAttemptAt).toEqual(new Date('2026-07-17T14:00:00Z'))
  })

  it('records failure state with reason', async () => {
    const repo = createReviewRefreshRunRepository(db)
    const run = await repo.createRun({ batchSize: 500, maxBatches: 10 })

    await repo.updateRun(run.id, {
      status: 'failed',
      failureReason: '1 enqueue failure(s) in batch 2',
      enqueueFailedCount: 1,
      finishedAt: new Date('2026-07-17T13:05:00Z'),
    })

    const latest = await repo.findLatestRun()
    expect(latest!.id).toBe(run.id)
    expect(latest!.status).toBe('failed')
    expect(latest!.failureReason).toContain('enqueue failure')
    expect(latest!.enqueueFailedCount).toBe(1)
  })
})
