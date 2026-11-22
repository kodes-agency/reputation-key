import { describe, expect, it, vi } from 'vitest'
import type { ReviewProviderSnapshotRun } from './review-provider-snapshot-repository.port.server'
import { runReviewProviderSnapshot } from './run-review-provider-snapshot.server'
import {
  organizationId,
  propertyId,
  runId,
  run,
  makeDeps,
  request,
} from './run-review-provider-snapshot.test-fixtures'

describe('runReviewProviderSnapshot', () => {
  it('applies only the fixed 100-row deletion batch and resumes until complete', async () => {
    const deps = makeDeps({ currentRun: run({ state: 'deleting', phase: 'apply' }) })
    vi.mocked(deps.repository.applyDeletionBatch).mockResolvedValue({
      run: run({ state: 'deleting', phase: 'apply' }),
      applied: 100,
      observed: 0,
      done: false,
    })

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'deleting', runId, applied: 100 },
    )
    expect(deps.repository.applyDeletionBatch).toHaveBeenCalledWith({ runId, limit: 100 })
  })

  describe("when Google's total and its list differ by a small amount", () => {
    const completedWith = (
      listing: Readonly<{ expected: number; unique: number; pages: number }>,
    ) => {
      const deps = makeDeps({ currentRun: run({ state: 'deleting', phase: 'apply' }) })
      vi.mocked(deps.repository.applyDeletionBatch).mockResolvedValue({
        run: run({
          state: 'completed',
          phase: 'terminal',
          expectedProviderTotal: listing.expected,
          expectedProviderAverageRating: 4.5,
          mainUniqueCount: listing.unique,
          mainPageIndex: listing.pages,
        }),
        applied: 0,
        observed: 0,
        done: true,
      })
      return deps
    }

    it('completes the run and logs the gap as counts only', async () => {
      const deps = completedWith({ expected: 82, unique: 81, pages: 2 })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'completed', runId })

      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        {
          event: 'review_snapshot_completed_with_count_gap',
          expected: 82,
          unique: 81,
          gap: 1,
        },
        expect.any(String),
      )
    })

    it('logs a list longer than the total the same way', async () => {
      const deps = completedWith({ expected: 19, unique: 20, pages: 1 })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'completed', runId })

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ expected: 19, unique: 20, gap: 1 }),
        expect.any(String),
      )
    })

    it('logs a gap of two the same way (86 counted, 84 listed)', async () => {
      const deps = completedWith({ expected: 86, unique: 84, pages: 2 })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'completed', runId })

      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ expected: 86, unique: 84, gap: 2 }),
        expect.any(String),
      )
    })

    it('logs nothing when the list matches the total', async () => {
      const deps = completedWith({ expected: 81, unique: 81, pages: 2 })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'completed', runId })

      expect(deps.logger.warn).not.toHaveBeenCalled()
    })

    it('fails the run and discards its cursors when the store refuses the gap', async () => {
      const deps = makeDeps()
      vi.mocked(deps.repository.finishMainScan).mockResolvedValue({
        status: 'failed',
        run: run({ state: 'failed', phase: 'terminal', failureCode: 'set_mismatch' }),
        code: 'set_mismatch',
      })

      await expect(runReviewProviderSnapshot(deps)(request)).resolves.toEqual({
        status: 'failed',
        runId,
        code: 'set_mismatch',
      })
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })
  })

  // A step is queued with the id of its run. When that run has already failed
  // (the queue retrying the step that failed it, a redrive of its dead letter,
  // a continuation queued before the run ended) the step does no work. It must
  // say so: otherwise the caller cannot tell this replay from the attempt that
  // failed the run, and fails the job again, with a longer backoff, every time.
  describe('when the step finds its run already failed', () => {
    const failedRun = (failureCode: ReviewProviderSnapshotRun['failureCode']) =>
      run({ state: 'failed', phase: 'terminal', failureCode })

    it('answers with the stored failure, marked as already failed, and discards the cursors again', async () => {
      const deps = makeDeps({ currentRun: failedRun('observation_failed') })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({
        status: 'failed',
        runId,
        code: 'observation_failed',
        alreadyFailed: { failedAt: null },
      })
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledTimes(1)
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith({
        organizationId,
        propertyId,
        sourceEpoch: 1,
        runId,
      })
    })

    it('does no work: it reads no page, writes no observation and fails nothing again', async () => {
      const deps = makeDeps({ currentRun: failedRun('observation_failed') })

      await runReviewProviderSnapshot(deps)({ ...request, runId })

      expect(deps.googleReviewApi.listReviewsPage).not.toHaveBeenCalled()
      expect(deps.observationWriter.persist).not.toHaveBeenCalled()
      expect(deps.repository.failRun).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
      expect(deps.logger.error).not.toHaveBeenCalled()
    })

    it('names provider_failure when the stored failure carries no code', async () => {
      const deps = makeDeps({ currentRun: failedRun(null) })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({
        status: 'failed',
        runId,
        code: 'provider_failure',
        alreadyFailed: { failedAt: null },
      })
    })

    // The caller needs the time to tell a failure the failing step recorded from
    // one it died before recording.
    it('carries the time the run failed, so the caller can tell whether the failure was recorded', async () => {
      const terminalAt = new Date('2026-08-16T00:07:30.000Z')
      const deps = makeDeps({
        currentRun: run({
          state: 'failed',
          phase: 'terminal',
          failureCode: 'observation_failed',
          terminalAt,
        }),
      })

      const result = await runReviewProviderSnapshot(deps)({ ...request, runId })

      expect(result).toMatchObject({
        status: 'failed',
        alreadyFailed: { failedAt: terminalAt },
      })
    })

    // The control: the attempt that fails the run now is a fresh failure and
    // carries no mark, so the caller keeps failing the job for it.
    it('does not mark the step that fails the run itself', async () => {
      const deps = makeDeps()
      vi.mocked(deps.observationWriter.persist).mockRejectedValue(
        new Error('canceling statement due to lock timeout'),
      )

      const result = await runReviewProviderSnapshot(deps)({ ...request, runId })

      expect(result).toEqual({ status: 'failed', runId, code: 'observation_failed' })
      expect(result).not.toHaveProperty('alreadyFailed')
      expect(deps.repository.failRun).toHaveBeenCalledWith({
        runId,
        organizationId,
        code: 'observation_failed',
      })
    })
  })
})
