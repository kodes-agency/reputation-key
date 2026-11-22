import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_REVIEW_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { runReviewProviderSnapshot } from './run-review-provider-snapshot.server'
import {
  organizationId,
  reviewId,
  runId,
  run,
  makeDeps,
  request,
} from './run-review-provider-snapshot.test-fixtures'

describe('runReviewProviderSnapshot', () => {
  it('checkpoints a rate-limited page scan and preserves the run cursors', async () => {
    const deps = makeDeps()
    const providerError = Object.assign(new Error('429 from provider'), {
      _tag: 'GoogleReviewApiError' as const,
      code: 'provider_rate_limited' as const,
      recoverable: true,
    })
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(providerError)

    // Transient: the queue retries the SAME page. Discarding cursors here
    // restarted a multi-page scan from zero on a single 429.
    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'scanning' },
    )
    expect(deps.googleReviewApi.discardReviewCursors).not.toHaveBeenCalled()
    expect(deps.repository.failRun).not.toHaveBeenCalled()
    expect(deps.repository.commitPage).not.toHaveBeenCalled()
  })

  // The cursor does not move here, so the continuation repeats this exact call.
  // Carrying the provider's own hint out is what lets the scheduler wait
  // instead of spinning: without it the retry rate is queue speed.
  it('carries the provider backoff hint out on a rate-limited checkpoint', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error('429 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'provider_rate_limited' as const,
        recoverable: true,
        retryAfterMs: 5_000,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'scanning', retryAfterMs: 5_000 },
    )
  })

  it('omits the hint when the provider sent none, rather than inventing one', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error('429 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'provider_rate_limited' as const,
        recoverable: true,
        retryAfterMs: 0,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'scanning' },
    )
  })

  it('checkpoints a provider-unavailable page scan', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error('503 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'provider_unavailable' as const,
        recoverable: true,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'checkpointed', runId, state: 'scanning' },
    )
    expect(deps.repository.failRun).not.toHaveBeenCalled()
  })

  it('still fails terminally when the page scan hits a non-recoverable code', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error('403 from provider'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'authorization_changed' as const,
        recoverable: false,
      }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'failed', runId, code: 'authorization_changed' },
    )
    expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    )
    expect(deps.repository.failRun).toHaveBeenCalledWith({
      runId,
      organizationId,
      code: 'authorization_changed',
      providerFailure: {
        providerStatus: null,
        providerErrorStatus: null,
        dispatch: 'unknown',
      },
    })
  })

  // A connection that broke while a run was in flight (a refresh Google
  // refused, a disconnect) cannot be used by the next step either. The run ends
  // under its own code and discards its cursors, so the next poll after the
  // reconnect starts afresh instead of resuming cursors that will have lapsed.
  it.each(['scanning', 'confirming'] as const)(
    'ends a %s run under connection_unusable and discards its cursors',
    async (state) => {
      const deps = makeDeps({
        currentRun:
          state === 'scanning'
            ? run()
            : run({
                state: 'confirming',
                phase: 'confirmation',
                confirmationDeadline: new Date('2026-08-16T12:00:00.000Z'),
              }),
      })
      const refusal = Object.assign(new Error('connection_unusable'), {
        code: 'connection_unusable',
      })
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(refusal)
      vi.mocked(deps.googleReviewApi.getReview).mockRejectedValue(refusal)

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'connection_unusable' })
      expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
        expect.objectContaining({ runId }),
      )
      expect(deps.repository.failRun).toHaveBeenCalledWith({
        runId,
        organizationId,
        code: 'connection_unusable',
      })
      expect(deps.logger.error).not.toHaveBeenCalled()
    },
  )

  // Google answered that the Location or the request is not valid (404, 400):
  // every retry gets the same answer, so the run ends under its own code
  // (`provider_rejected`, with the status logged) and the next poll starts a
  // fresh one instead of the continuation looping until the run expires.
  const rejectedByGoogle = (providerStatus: number | null = 404) =>
    Object.assign(new Error('Google answered; status synthetic'), {
      _tag: 'GoogleReviewApiError' as const,
      code: 'provider_rejected' as const,
      recoverable: false,
      failure: { executionCode: null, dispatch: 'answered' as const, providerStatus },
    })

  it('ends the run as provider_rejected when Google rejected the page request', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(rejectedByGoogle())

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'failed', runId, code: 'provider_rejected' },
    )
    expect(deps.googleReviewApi.discardReviewCursors).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    )
    expect(deps.repository.failRun).toHaveBeenCalledWith({
      runId,
      organizationId,
      code: 'provider_rejected',
      providerFailure: {
        providerStatus: 404,
        providerErrorStatus: null,
        dispatch: 'answered',
      },
    })
    expect(deps.repository.commitPage).not.toHaveBeenCalled()
  })

  it.each(['provider_rejected', 'provider_failure', 'authorization_changed'])(
    'records closed provider evidence on a failed run (%s)',
    async (code) => {
      const deps = makeDeps()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue({
        code,
        failure: {
          providerStatus: 403,
          providerErrorStatus: 'PERMISSION_DENIED',
          dispatch: 'answered',
        },
      })

      await runReviewProviderSnapshot(deps)({ ...request, runId })

      expect(deps.repository.failRun).toHaveBeenCalledWith({
        runId,
        organizationId,
        code,
        providerFailure: {
          providerStatus: 403,
          providerErrorStatus: 'PERMISSION_DENIED',
          dispatch: 'answered',
        },
      })
    },
  )

  it('cannot store unexpected provider content or status values', async () => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue({
      code: 'provider_rejected',
      message: 'private customer content',
      failure: {
        providerStatus: 99999,
        providerErrorStatus: 'PRIVATE_CUSTOMER_VALUE',
        dispatch: 'private resource',
        body: { error: { status: 'NOT_FOUND', message: 'private content' } },
      },
    })

    await runReviewProviderSnapshot(deps)({ ...request, runId })

    expect(deps.repository.failRun).toHaveBeenCalledWith({
      runId,
      organizationId,
      code: 'provider_rejected',
      providerFailure: {
        providerStatus: null,
        providerErrorStatus: null,
        dispatch: 'unknown',
      },
    })
    expect(JSON.stringify(vi.mocked(deps.repository.failRun).mock.calls)).not.toContain(
      'private',
    )
    expect(JSON.stringify(vi.mocked(deps.logger.warn).mock.calls)).not.toContain(
      'private',
    )
  })

  it('ends the confirmation as provider_rejected when Google rejected the review request', async () => {
    const deps = makeDeps({
      currentRun: run({
        state: 'confirming',
        phase: 'confirmation',
        confirmationDeadline: new Date('2026-08-16T12:00:00.000Z'),
      }),
    })
    vi.mocked(deps.repository.readNextLinkedCandidate).mockResolvedValue({
      runId,
      reviewId,
      expectedState: 'linked',
      expectedSourceRevision: 1,
      status: 'pending',
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
    vi.mocked(deps.googleReviewApi.getReview).mockRejectedValue(rejectedByGoogle(400))

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      { status: 'failed', runId, code: 'provider_rejected' },
    )
    expect(deps.repository.confirmLinkedCandidateMissing).not.toHaveBeenCalled()
  })

  // The status is the one fact that tells a deleted location (404) from a
  // refused request (400), and it was recorded nowhere. One warning: the run
  // row names the Property, so the line carries no identifier but the run id.
  it.each([404, 400])(
    'logs one warning with the Google status %s and no uncoded-cause error',
    async (providerStatus) => {
      const deps = makeDeps()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
        rejectedByGoogle(providerStatus),
      )

      await runReviewProviderSnapshot(deps)({ ...request, runId })

      expect(deps.logger.error).not.toHaveBeenCalled()
      expect(deps.logger.warn).toHaveBeenCalledTimes(1)
      expect(deps.logger.warn).toHaveBeenCalledWith(
        {
          event: 'review_snapshot_provider_rejected',
          providerStatus,
          providerErrorStatus: null,
          dispatch: 'answered',
          runId,
        },
        'Review snapshot rejected by Google: the location or request is not valid',
      )
    },
  )

  it('logs a null status when the rejection carries no dispatch evidence', async () => {
    const deps = makeDeps()
    const bare = Object.assign(new Error('rejected'), {
      _tag: 'GoogleReviewApiError' as const,
      code: 'provider_rejected' as const,
      recoverable: false,
    })
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(bare)

    await runReviewProviderSnapshot(deps)({ ...request, runId })

    expect(deps.logger.error).not.toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      {
        event: 'review_snapshot_provider_rejected',
        providerStatus: null,
        providerErrorStatus: null,
        dispatch: 'unknown',
        runId,
      },
      expect.any(String),
    )
  })

  it.each([
    'authorization_denied',
    'connection_unusable',
    'runtime_unavailable',
    'stale_source',
  ] as const)('preserves the Review sync authorization cause %s', async (code) => {
    const deps = makeDeps()
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
      Object.assign(new Error(code), { code }),
    )

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      {
        status: 'failed',
        runId,
        code,
      },
    )
    expect(deps.logger.error).not.toHaveBeenCalled()
  })

  it('logs a code-less provider failure with its bounded execution identity', async () => {
    const deps = makeDeps()
    const error = new Error('uncoded provider failure')
    vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(error)

    await expect(runReviewProviderSnapshot(deps)({ ...request, runId })).resolves.toEqual(
      {
        status: 'failed',
        runId,
        code: 'provider_failure',
      },
    )
    // runId only: the log schema bans tenant identifiers at logger call-sites, and
    // the run row resolves the property for whoever reads the log.
    expect(deps.logger.error).toHaveBeenCalledWith(
      {
        err: error,
        providerStatus: null,
        providerErrorStatus: null,
        dispatch: 'unknown',
        runId,
      },
      'review snapshot failed without a coded cause',
    )
  })

  // The cursor store is ephemeral by design (ADR 0050): a deploy that restarts
  // it drops every published page cursor. A run caught mid-scan then finds its
  // next cursor gone. That is a lost run to start again, not a broken one.
  describe('when the page cursor is gone from the store', () => {
    const RUN_STARTED_AT = new Date('2026-08-21T11:50:00.000Z')
    const cursorNotFound = (cursorStoreStartedAtMs?: number) =>
      Object.assign(new Error('Google review API request failed'), {
        _tag: 'GoogleReviewApiError' as const,
        code: 'cursor_not_found' as const,
        recoverable: false,
        ...(cursorStoreStartedAtMs === undefined ? {} : { cursorStoreStartedAtMs }),
      })
    const midScan = () =>
      makeDeps({
        currentRun: run({
          startedAt: RUN_STARTED_AT,
          mainPageIndex: 44,
          mainCursorRef: 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        }),
      })

    it('ends the run as cursor_lost when the store restarted after the run began', async () => {
      const deps = midScan()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
        cursorNotFound(RUN_STARTED_AT.getTime() + 5 * 60_000),
      )

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'cursor_lost' })
      expect(deps.repository.failRun).toHaveBeenCalledWith({
        runId,
        organizationId,
        code: 'cursor_lost',
      })
      expect(deps.repository.commitPage).not.toHaveBeenCalled()
      // Expected after every deploy: a warning with the execution identity,
      // never an error.
      expect(deps.logger.warn).toHaveBeenCalledWith(
        {
          event: 'review_snapshot_cursor_lost',
          runId,
          phase: 'main',
          pageIndex: 44,
        },
        'Review snapshot lost its page cursor to a cursor store restart',
      )
      expect(deps.logger.error).not.toHaveBeenCalled()
    })

    // No restart since the run began, yet the cursor is gone: something
    // dropped it, and that must stay as loud as it was.
    it('stays cursor_failure when the store has been up since before the run began', async () => {
      const deps = midScan()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
        cursorNotFound(RUN_STARTED_AT.getTime() - 60 * 60_000),
      )

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'cursor_failure' })
      expect(deps.logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'review_snapshot_cursor_lost' }),
        expect.anything(),
      )
    })

    it('stays cursor_failure when the store could not say when it started', async () => {
      const deps = midScan()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(cursorNotFound())

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'cursor_failure' })
    })
  })

  describe('when the Google port throws the provider failure itself', () => {
    const providerFailure = (
      fields: Readonly<{ code: string; providerStatus?: number; retryAfterMs?: number }>,
    ) =>
      Object.assign(new Error('provider call failed'), {
        _tag: 'GbpApiError',
        dispatch: 'answered',
        providerStatus: 429,
        ...fields,
      })

    it('checkpoints a rate-limited page scan with the provider backoff hint', async () => {
      const deps = makeDeps()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
        providerFailure({ code: 'rate_limited', retryAfterMs: 5_000 }),
      )

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({
        status: 'checkpointed',
        runId,
        state: 'scanning',
        retryAfterMs: 5_000,
      })
      expect(deps.googleReviewApi.discardReviewCursors).not.toHaveBeenCalled()
    })

    it.each([
      [{ code: 'auth_failed', providerStatus: 401 }, 'authorization_changed'],
      [{ code: 'upstream_error', providerStatus: 404 }, 'provider_rejected'],
    ] as const)('ends the run when the page scan fails with %j', async (fields, code) => {
      const deps = makeDeps()
      vi.mocked(deps.googleReviewApi.listReviewsPage).mockRejectedValue(
        providerFailure(fields),
      )

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code })
    })

    it('ends the confirmation as provider_rejected when the review read is refused', async () => {
      const deps = makeDeps({
        currentRun: run({
          state: 'confirming',
          phase: 'confirmation',
          confirmationDeadline: new Date('2026-08-16T12:00:00.000Z'),
        }),
      })
      vi.mocked(deps.repository.readNextLinkedCandidate).mockResolvedValue({
        runId,
        reviewId,
        expectedState: 'linked',
        expectedSourceRevision: 1,
        status: 'pending',
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      })
      vi.mocked(deps.googleReviewApi.getReview).mockRejectedValue(
        providerFailure({ code: 'upstream_error', providerStatus: 400 }),
      )

      await expect(
        runReviewProviderSnapshot(deps)({ ...request, runId }),
      ).resolves.toEqual({ status: 'failed', runId, code: 'provider_rejected' })
      expect(deps.repository.confirmLinkedCandidateMissing).not.toHaveBeenCalled()
    })
  })
})
