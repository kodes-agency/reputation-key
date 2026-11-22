import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_REVIEW_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import {
  runReviewProviderSnapshot,
  type RunReviewProviderSnapshotDeps,
} from './run-review-provider-snapshot.server'
import {
  reviewId,
  runId,
  review,
  run,
  makeDeps,
  request,
} from './run-review-provider-snapshot.test-fixtures'

describe('runReviewProviderSnapshot', () => {
  // A guest who posts while a run is between its main and its confirmation
  // listing changes the set the confirmation must find again. The store
  // records such a run as `listing_changed`, and as `confirmation_set_changed`
  // only once the Property's runs keep changing (snapshot-listing-change.server.ts).
  describe('when the listing changed between the two scans', () => {
    const NEXT_CURSOR = 'v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const counts = {
      expectedProviderTotal: 3_714,
      expectedProviderAverageRating: 4.5,
      mainPageIndex: 75,
      mainUniqueCount: 3_713,
      confirmationUniqueCount: 2_000,
    } as const
    const confirming = run({
      ...counts,
      state: 'confirming',
      phase: 'confirmation',
      confirmationDeadline: new Date('2026-08-16T12:00:00.000Z'),
      confirmationPageIndex: 40,
      confirmationCursorRef: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    })
    const endedAs = (code: 'listing_changed' | 'confirmation_set_changed') =>
      run({ ...counts, state: 'failed', phase: 'terminal', failureCode: code })
    const confirmationPage = (nextCursorRef: string | null) =>
      makeDeps({
        currentRun: confirming,
        page: {
          reviews: [review],
          totalReviewCount: 3_714,
          averageRating: 4.5,
          nextCursorRef,
        },
      })
    /** The store answers with the code it recorded, whatever the step asked. */
    const recordedAs = (
      deps: RunReviewProviderSnapshotDeps,
      code: 'listing_changed' | 'confirmation_set_changed',
    ) => {
      vi.mocked(deps.repository.failRun).mockResolvedValue(endedAs(code))
      vi.mocked(deps.repository.commitPage).mockResolvedValue({
        status: 'failed',
        run: endedAs(code),
        code,
      })
    }
    const LISTING_CHANGED_LOG = {
      event: 'review_snapshot_listing_changed',
      expected: 3_714,
      listed: 3_713,
      confirmed: 2_000,
    }

    it('ends the run as listing_changed, warns with counts only and removes nothing', async () => {
      const deps = confirmationPage(NEXT_CURSOR)
      recordedAs(deps, 'listing_changed')

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        LISTING_CHANGED_LOG,
        expect.any(String),
      )
      expect(deps.logger.error).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
        expect.objectContaining({ runId }),
      )
      expect(deps.repository.finishConfirmationScan).not.toHaveBeenCalled()
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    it('stays confirmation_set_changed, with no warning, when the store found it repeating', async () => {
      const deps = confirmationPage(NEXT_CURSOR)
      recordedAs(deps, 'confirmation_set_changed')

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'confirmation_set_changed' })

      expect(deps.logger.warn).not.toHaveBeenCalled()
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    // The last confirmation page commits; the counts that disagree are found
    // when the confirmation scan is finished.
    it('answers with the code the store recorded when it finishes the confirmation', async () => {
      const deps = confirmationPage(null)
      vi.mocked(deps.repository.finishConfirmationScan).mockResolvedValue({
        status: 'failed',
        run: endedAs('listing_changed'),
        code: 'listing_changed',
      })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.logger.warn).toHaveBeenCalledWith(
        LISTING_CHANGED_LOG,
        expect.any(String),
      )
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    // A review this run had found missing is on Google after all.
    it('ends the run the store failed on a removal candidate found again', async () => {
      const deps = makeDeps({ currentRun: confirming })
      vi.mocked(deps.repository.readNextLinkedCandidate).mockResolvedValue({
        runId,
        reviewId,
        expectedState: 'linked',
        expectedSourceRevision: 1,
        status: 'pending',
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      })
      vi.mocked(deps.googleReviewApi.getReview).mockResolvedValue({
        status: 'found',
        review,
      })
      recordedAs(deps, 'listing_changed')

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.repository.confirmLinkedCandidateMissing).not.toHaveBeenCalled()
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    it('answers a later step of that run with its code and applies nothing', async () => {
      const deps = makeDeps({ currentRun: endedAs('listing_changed') })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({
        status: 'failed',
        runId,
        code: 'listing_changed',
        alreadyFailed: { failedAt: null },
      })

      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.listReviewsPage).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })
  })

  // A guest who posts while the main scan is between two pages moves Google's
  // total (a large location). The
  // store records the failure as `listing_changed` unless the Property's runs
  // keep changing (snapshot-listing-change.server.ts), and the use case answers with
  // whatever the store recorded.
  describe("when Google's listing moved while the main scan was reading it", () => {
    const NEXT_CURSOR = 'v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const counts = {
      expectedProviderTotal: 3_716,
      expectedProviderAverageRating: 4.5,
      mainPageIndex: 6,
      mainUniqueCount: 300,
    } as const
    const scanning = run({
      ...counts,
      mainCursorRef: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    })
    const endedAs = (code: 'listing_changed' | 'total_changed' | 'average_changed') =>
      run({ ...counts, state: 'failed', phase: 'terminal', failureCode: code })
    /** Page 7 of the scan, with Google's total one review higher than before. */
    const pageSeven = () =>
      makeDeps({
        currentRun: scanning,
        page: {
          reviews: [review],
          totalReviewCount: 3_717,
          averageRating: 4.5,
          nextCursorRef: NEXT_CURSOR,
        },
      })
    /** The store answers with the code it recorded, whatever the step asked. */
    const recordedAs = (
      deps: RunReviewProviderSnapshotDeps,
      code: 'listing_changed' | 'total_changed' | 'average_changed',
    ) => {
      vi.mocked(deps.repository.failRun).mockResolvedValue(endedAs(code))
      vi.mocked(deps.repository.commitPage).mockResolvedValue({
        status: 'failed',
        run: endedAs(code),
        code,
      })
    }
    const LISTING_CHANGED_LOG = {
      event: 'review_snapshot_listing_changed',
      expected: 3_716,
      listed: 300,
      confirmed: 0,
    }

    it('ends the run as listing_changed, warns with counts only and removes nothing', async () => {
      const deps = pageSeven()
      recordedAs(deps, 'listing_changed')

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'listing_changed' })

      expect(deps.repository.commitPage).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'main', totalReviewCount: 3_717 }),
      )
      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        LISTING_CHANGED_LOG,
        expect.any(String),
      )
      expect(deps.logger.error).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
        expect.objectContaining({ runId }),
      )
      // It never got as far as listing a second time or applying anything.
      expect(deps.repository.finishMainScan).not.toHaveBeenCalled()
      expect(deps.repository.beginConfirmationScan).not.toHaveBeenCalled()
      expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
    })

    it.each(['total_changed', 'average_changed'] as const)(
      'stays %s, with no warning, when the store found the changes repeating',
      async (code) => {
        const deps = pageSeven()
        recordedAs(deps, code)

        await expect(
          runReviewProviderSnapshot(deps)({ ...request, runId }),
        ).resolves.toEqual({ status: 'failed', runId, code })

        expect(deps.logger.warn).not.toHaveBeenCalled()
        expect(deps.repository.applyDeletionBatch).not.toHaveBeenCalled()
      },
    )

    it('answers a later step of that run with its code and lists nothing more', async () => {
      const deps = makeDeps({ currentRun: endedAs('listing_changed') })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({
        status: 'failed',
        runId,
        code: 'listing_changed',
        alreadyFailed: { failedAt: null },
      })

      expect(deps.googleReviewApi.listReviewsPage).not.toHaveBeenCalled()
      expect(deps.repository.commitPage).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })

    // The same review twice on ONE page is not the listing moving between
    // pages: Google's page is broken, and the run asks for `duplicate_resource`
    // outright (the store keeps it loud, review-provider-snapshot-listing-change).
    it('still asks for duplicate_resource when one page lists a review twice', async () => {
      const deps = makeDeps({
        currentRun: scanning,
        page: {
          reviews: [review, review],
          totalReviewCount: 3_716,
          averageRating: 4.5,
          nextCursorRef: NEXT_CURSOR,
        },
      })

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'duplicate_resource' })

      expect(deps.repository.failRun).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'duplicate_resource' }),
      )
      expect(deps.repository.commitPage).not.toHaveBeenCalled()
      expect(deps.logger.warn).not.toHaveBeenCalled()
    })
  })
})
