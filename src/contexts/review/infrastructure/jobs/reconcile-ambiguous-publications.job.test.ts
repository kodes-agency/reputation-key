// Reconciliation sweep liveness tests.
//
// Every due publication state has a bounded owner: provider-safe authorized
// work fails terminally, uncertain sends wait out a propagation grace and then
// become ambiguity, provider-accepted replies get bounded propagation grace,
// and ambiguity is read on a 72-hour ladder before automatic reconciliation
// stops. Positive never-dispatched evidence settles an uncertain send as not
// published; no outcome here writes to Google.

import { describe, expect, it, vi, type Mock } from 'vitest'
import { createReconcileAmbiguousPublicationsHandler } from './reconcile-ambiguous-publications.job'
import { err, ok } from '#/shared/domain'
import { reviewError } from '../../domain/errors'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReconcileReplyPublicationInput } from '../../application/use-cases/reconcile-reply-publication'
import type { Reply } from '../../domain/types'
import { PROVIDER_OBSERVATION_RECONCILE_DELAY_MS } from '../../domain/reply-publication-workflow'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const NOW = new Date('2026-07-17T00:00:00Z')
const DUE = new Date(NOW.getTime() - 60_000)
const ORG_ID = organizationId('org-1')
const MINUTE = 60_000
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE)
/** An attempt whose read ladder has run out (older than 72 hours). */
const LADDER_EXHAUSTED_START = minutesAgo(73 * 60)

function makeReply(
  id: string,
  publicationState: NonNullable<Reply['publicationState']>,
  overrides: Partial<Reply> = {},
): Reply {
  const failed = publicationState === 'ambiguous' || publicationState === 'terminal'
  return {
    id: replyId(id),
    reviewId: reviewId(`rev-${id}`),
    organizationId: ORG_ID,
    text: 'Thank you!',
    status: failed ? 'publish_failed' : 'approved',
    source: 'internal',
    createdBy: userId('user-1'),
    approvedBy: userId('user-1'),
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState,
    publicationCycle: 1,
    publicationAttempts: publicationState === 'requested' ? 0 : 1,
    publicationLastErrorClass:
      publicationState === 'authorized'
        ? 'retryable'
        : publicationState === 'ambiguous' || publicationState === 'terminal'
          ? 'ambiguous'
          : null,
    reconcileDueAt: DUE,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    templateId: overrides.templateId ?? null,
    templateVersion: overrides.templateVersion ?? null,
  }
}

function makeDeps(opts: {
  batches: ReadonlyArray<ReadonlyArray<Reply>>
  reconcile: Mock
  attemptProgress?: Readonly<{
    attemptStartedAt: Date
    absentObservationCount: number
  }> | null
  /** reply_publication_attempts.created_at for sending/ambiguous rows. */
  attemptStartedAt?: Date | null
  evidence?: 'possibly_dispatched' | 'never_dispatched' | 'too_recent'
}) {
  const batchQueue = [...opts.batches]
  const leaseRelease = vi.fn(async () => {})
  let persistedReply: Reply | null = null
  const markPublicationAmbiguous = vi.fn(async (reply: Reply) => ({
    ...reply,
    status: 'publish_failed' as const,
    publicationState: 'ambiguous' as const,
    publicationLastErrorClass: 'ambiguous' as const,
  }))
  const deferPendingPublicationObservation = vi.fn(
    async (reply: Reply, at: Date = NOW) => {
      persistedReply = {
        ...reply,
        publicationState: 'pending_observation' as const,
        reconcileDueAt: new Date(at.getTime() + PROVIDER_OBSERVATION_RECONCILE_DELAY_MS),
      }
      return persistedReply
    },
  )
  const markPublicationTerminal = vi.fn(
    async (reply: Reply, errorClass: Reply['publicationLastErrorClass']) => ({
      ...reply,
      status: 'publish_failed' as const,
      publicationState: 'terminal' as const,
      publicationLastErrorClass: errorClass,
      reconcileDueAt: null,
    }),
  )
  const deferUncertainSend = vi.fn(async (reply: Reply, dueAt: Date, _now: Date) => ({
    ...reply,
    reconcileDueAt: dueAt,
  }))
  const rescheduleAmbiguousReconciliation = vi.fn(
    async (reply: Reply, dueAt: Date, _now: Date) => ({
      ...reply,
      reconcileDueAt: dueAt,
    }),
  )
  const settleNeverDispatchedAttempt = vi.fn(
    async (reply: Reply, _event: unknown, _now: Date) => ({
      ...reply,
      status: 'publish_failed' as const,
      publicationState: 'terminal' as const,
      publicationLastErrorClass: 'retryable' as const,
      reconcileDueAt: null,
    }),
  )
  const replyRepo = {
    findDuePublicationReconciliationBatch: vi.fn(async () => batchQueue.shift() ?? []),
    findPublicationAttemptObservationProgress: vi.fn(
      async () => opts.attemptProgress ?? null,
    ),
    findCurrentPublicationAttemptStartedAt: vi.fn(async () =>
      opts.attemptStartedAt === undefined
        ? LADDER_EXHAUSTED_START
        : opts.attemptStartedAt,
    ),
  } as unknown as ReplyRepository
  return {
    replyRepo,
    reviewRepo: {
      findById: vi.fn(async (id: Reply['reviewId']) => ({
        id,
        propertyId: 'prop-1',
      })),
    },
    replyCommandStore: {
      deferPendingPublicationObservation,
      markPublicationAmbiguous,
      markPublicationTerminal,
      deferUncertainSend,
      rescheduleAmbiguousReconciliation,
      settleNeverDispatchedAttempt,
    },
    dispatchEvidence: {
      findDispatchEvidence: vi.fn(async () => opts.evidence ?? 'possibly_dispatched'),
    },
    reconcileReplyPublication: opts.reconcile,
    clock: () => NOW,
    logger: { info: vi.fn(), warn: vi.fn() },
    runLease: {
      tryAcquire: vi.fn(async () => ({ release: leaseRelease })),
    },
    leaseRelease,
    getPersistedReply: () => persistedReply,
  }
}

const makeJob = () => ({ id: 'job-1', data: {} }) as never

async function runOne(
  reply: Reply,
  outcome: 'confirmed_on_google' | 'absent' | 'unreadable' | 'provider_review_missing',
  attemptProgress?: Readonly<{
    attemptStartedAt: Date
    absentObservationCount: number
  }> | null,
  uncertain: Pick<Parameters<typeof makeDeps>[0], 'attemptStartedAt' | 'evidence'> = {},
) {
  const reconcile = vi.fn(async (_input: ReconcileReplyPublicationInput) =>
    ok({ outcome }),
  )
  const deps = makeDeps({ batches: [[reply]], reconcile, attemptProgress, ...uncertain })
  const handler = createReconcileAmbiguousPublicationsHandler(deps as never)
  await handler(makeJob())
  return { deps, reconcile }
}

describe('reconcile-ambiguous-publications sweep', () => {
  it('terminally fails a due authorized retry without issuing another provider request', async () => {
    const authorized = makeReply('reply-authorized', 'authorized')
    const { deps, reconcile } = await runOne(authorized, 'absent')

    expect(reconcile).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      authorized,
      'retryable',
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'not_sent',
      }),
      NOW,
    )
  })

  it.each([
    ['absent', 'absent'],
    ['unreadable', 'unreadable'],
  ] as const)(
    'keeps a sending attempt waiting inside the grace when the read is %s',
    async (_label, outcome) => {
      const sending = makeReply('reply-sending', 'sending')
      const { deps, reconcile } = await runOne(sending, outcome, null, {
        attemptStartedAt: minutesAgo(5),
      })

      expect(reconcile).toHaveBeenCalledOnce()
      expect(deps.replyCommandStore.deferUncertainSend).toHaveBeenCalledWith(
        sending,
        new Date(NOW.getTime() + MINUTE),
        NOW,
      )
      expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
      expect(
        deps.replyRepo.findPublicationAttemptObservationProgress,
      ).not.toHaveBeenCalled()
    },
  )

  it('keeps a sending attempt waiting inside the grace when the read failed', async () => {
    const sending = makeReply('reply-sending-read-error', 'sending')
    const reconcile = vi.fn(async () =>
      err(reviewError('sync_failed', 'provider read failed')),
    )
    const deps = makeDeps({
      batches: [[sending]],
      reconcile,
      attemptStartedAt: minutesAgo(5),
    })

    await createReconcileAmbiguousPublicationsHandler(deps as never)(makeJob())

    expect(deps.replyCommandStore.deferUncertainSend).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('marks a sending attempt ambiguous past the grace, due at the next ladder rung', async () => {
    const sending = makeReply('reply-sending', 'sending')
    const attemptStartedAt = minutesAgo(20)
    const { deps } = await runOne(sending, 'absent', null, { attemptStartedAt })

    expect(deps.replyCommandStore.deferUncertainSend).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledWith(
      sending,
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'unconfirmed',
      }),
      NOW,
      new Date(attemptStartedAt.getTime() + 30 * MINUTE),
    )
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it('does not wait out the grace for a review Google no longer returns', async () => {
    const sending = makeReply('reply-sending-missing', 'sending')
    const attemptStartedAt = minutesAgo(5)
    const { deps } = await runOne(sending, 'provider_review_missing', null, {
      attemptStartedAt,
    })

    expect(deps.replyCommandStore.deferUncertainSend).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledWith(
      sending,
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'unconfirmed',
      }),
      NOW,
      new Date(attemptStartedAt.getTime() + 15 * MINUTE),
    )
  })

  it.each(['sending', 'ambiguous'] as const)(
    'settles a never-dispatched %s attempt as not published without reading Google',
    async (state) => {
      const uncertain = makeReply(`reply-never-sent-${state}`, state)
      const attemptStartedAt = minutesAgo(6)
      const { deps, reconcile } = await runOne(uncertain, 'absent', null, {
        attemptStartedAt,
        evidence: 'never_dispatched',
      })

      expect(deps.dispatchEvidence.findDispatchEvidence).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        replyId: uncertain.id,
        publicationCycle: 1,
        attemptNumber: 1,
        attemptStartedAt,
        now: NOW,
      })
      expect(deps.replyCommandStore.settleNeverDispatchedAttempt).toHaveBeenCalledWith(
        uncertain,
        state === 'sending'
          ? expect.objectContaining({
              _tag: 'review.reply.publish_failed',
              outcome: 'not_sent',
            })
          : null,
        NOW,
      )
      expect(reconcile).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.deferUncertainSend).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
      expect(
        deps.replyCommandStore.rescheduleAmbiguousReconciliation,
      ).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    },
  )

  it('never consults dispatch evidence for a write Google acknowledged', async () => {
    const pending = makeReply('reply-acknowledged', 'pending_observation')
    const { deps } = await runOne(pending, 'absent', null, {
      attemptStartedAt: minutesAgo(30),
      evidence: 'never_dispatched',
    })

    expect(deps.dispatchEvidence.findDispatchEvidence).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
  })

  it('reads Google when the dispatch evidence lookup fails', async () => {
    const ambiguous = makeReply('reply-evidence-down', 'ambiguous')
    const reconcile = vi.fn(async () => ok({ outcome: 'confirmed_on_google' as const }))
    const deps = makeDeps({
      batches: [[ambiguous]],
      reconcile,
      attemptStartedAt: minutesAgo(20),
    })
    deps.dispatchEvidence.findDispatchEvidence.mockRejectedValueOnce(
      new Error('permit lookup failed'),
    )

    await createReconcileAmbiguousPublicationsHandler(deps as never)(makeJob())

    expect(reconcile).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
  })

  it.each([
    ['absent', ok({ outcome: 'absent' as const })],
    ['unreadable', ok({ outcome: 'unreadable' as const })],
    ['failed', err(reviewError('sync_failed', 'provider read failed'))],
  ])(
    'reschedules ambiguity on the ladder when the read is %s',
    async (_label, readResult) => {
      const ambiguous = makeReply('reply-ladder', 'ambiguous')
      const attemptStartedAt = minutesAgo(20)
      const deps = makeDeps({
        batches: [[ambiguous]],
        reconcile: vi.fn(async () => readResult),
        attemptStartedAt,
      })

      await createReconcileAmbiguousPublicationsHandler(deps as never)(makeJob())

      expect(
        deps.replyCommandStore.rescheduleAmbiguousReconciliation,
      ).toHaveBeenCalledWith(
        ambiguous,
        new Date(attemptStartedAt.getTime() + 30 * MINUTE),
        NOW,
      )
      expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['15 minutes', 15, 'sending'],
    ['4 hours', 4 * 60, 'ambiguous'],
    ['71 hours', 71 * 60, 'ambiguous'],
  ] as const)(
    'heals a confirmed reply at any rung (%s after the attempt started)',
    async (_label, ageMinutes, state) => {
      const uncertain = makeReply(`reply-heal-${ageMinutes}`, state)
      const { deps } = await runOne(uncertain, 'confirmed_on_google', null, {
        attemptStartedAt: minutesAgo(ageMinutes),
      })

      expect(deps.replyCommandStore.deferUncertainSend).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
      expect(
        deps.replyCommandStore.rescheduleAmbiguousReconciliation,
      ).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    },
  )

  it('ends automatic checks only when the 72-hour ladder has run out', async () => {
    const ambiguous = makeReply('reply-ladder-done', 'ambiguous')
    const { deps } = await runOne(ambiguous, 'absent', null, {
      attemptStartedAt: LADDER_EXHAUSTED_START,
    })

    expect(
      deps.replyCommandStore.rescheduleAmbiguousReconciliation,
    ).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      ambiguous,
      'ambiguous',
      null,
      NOW,
    )
  })

  it('ends automatic checks for ambiguity whose attempt start is missing', async () => {
    const ambiguous = makeReply('reply-no-start', 'ambiguous')
    const { deps } = await runOne(ambiguous, 'absent', null, { attemptStartedAt: null })

    expect(deps.dispatchEvidence.findDispatchEvidence).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
  })

  it('keeps an accepted reply waiting while its current attempt is inside propagation grace', async () => {
    const pending = makeReply('reply-propagating', 'pending_observation')
    const { deps, reconcile } = await runOne(pending, 'absent', {
      attemptStartedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      absentObservationCount: 1,
    })

    expect(reconcile).toHaveBeenCalledOnce()
    expect(deps.getPersistedReply()).toMatchObject({
      publicationState: 'pending_observation',
      reconcileDueAt: new Date(NOW.getTime() + PROVIDER_OBSERVATION_RECONCILE_DELAY_MS),
    })
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it.each([
    // D3: ambiguity joins the ladder at the rung after the attempt's age.
    {
      boundary: 'propagation window',
      attemptStartedAt: new Date(NOW.getTime() - 15 * 60 * 1000),
      absentObservationCount: 1,
      rungMs: 30 * MINUTE,
    },
    {
      boundary: 'grace read cap',
      attemptStartedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
      absentObservationCount: 4,
      rungMs: 15 * MINUTE,
    },
  ])('advances pending work after the $boundary is exhausted', async (row) => {
    const { rungMs, ...progress } = row
    const pending = makeReply(`reply-${progress.boundary}`, 'pending_observation')
    const { deps } = await runOne(pending, 'absent', progress)

    expect(
      deps.replyCommandStore.deferPendingPublicationObservation,
    ).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledWith(
      pending,
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'unconfirmed',
      }),
      NOW,
      new Date(progress.attemptStartedAt.getTime() + rungMs),
    )
  })

  it('moves grace-exhausted accepted-but-unobserved work onto the ambiguous ladder', async () => {
    const pending = makeReply('reply-pending', 'pending_observation')
    const first = await runOne(pending, 'absent')

    expect(first.deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledOnce()
    expect(first.deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()

    const ambiguous = makeReply('reply-pending', 'ambiguous')
    const second = await runOne(ambiguous, 'absent', null, {
      attemptStartedAt: minutesAgo(20),
    })
    expect(
      second.deps.replyCommandStore.rescheduleAmbiguousReconciliation,
    ).toHaveBeenCalledOnce()
    expect(second.deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(first.reconcile).toHaveBeenCalledOnce()
    expect(second.reconcile).toHaveBeenCalledOnce()
  })

  it.each([
    {
      position: 'inside',
      attemptStartedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      absentObservationCount: 1,
    },
    {
      position: 'outside',
      attemptStartedAt: new Date(NOW.getTime() - 16 * 60 * 1000),
      absentObservationCount: 4,
    },
  ])('confirms immediately $position propagation grace', async (progress) => {
    const pending = makeReply(
      `reply-confirmed-${progress.position}`,
      'pending_observation',
    )
    const { deps } = await runOne(pending, 'confirmed_on_google', progress)

    expect(
      deps.replyCommandStore.deferPendingPublicationObservation,
    ).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it('turns a failed first provider read into ambiguity, and a failed read never ends the ladder', async () => {
    const pending = makeReply('reply-read-error', 'pending_observation')
    const firstReconcile = vi.fn(async () =>
      err(reviewError('sync_failed', 'provider read failed')),
    )
    const firstDeps = makeDeps({ batches: [[pending]], reconcile: firstReconcile })
    await createReconcileAmbiguousPublicationsHandler(firstDeps as never)(makeJob())
    expect(firstDeps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledOnce()

    const ambiguous = makeReply('reply-read-error', 'ambiguous')
    const secondReconcile = vi.fn(async () =>
      err(reviewError('sync_failed', 'provider read still failed')),
    )
    const secondDeps = makeDeps({
      batches: [[ambiguous]],
      reconcile: secondReconcile,
      attemptStartedAt: minutesAgo(47 * 60),
    })
    await createReconcileAmbiguousPublicationsHandler(secondDeps as never)(makeJob())
    expect(
      secondDeps.replyCommandStore.rescheduleAmbiguousReconciliation,
    ).toHaveBeenCalledWith(ambiguous, new Date(NOW.getTime() + MINUTE * 60), NOW)
    expect(secondDeps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  // postgres-recovery-fence.ts turns every restored `sending` row into
  // approved/ambiguous without touching its status. Such an attempt may have
  // had its permit written after the restore point, so permit absence proves
  // nothing and the store refuses to settle or reschedule it; reconciliation
  // refuses to read it. Before D3 the sweep ended it at once, and it must still.
  it.each(['never_dispatched', 'possibly_dispatched'] as const)(
    'ends a restore-fenced approved/ambiguous row as terminal ambiguity (%s)',
    async (evidence) => {
      const fenced = makeReply('reply-restore-fenced', 'ambiguous', {
        status: 'approved',
      })
      const { deps, reconcile } = await runOne(fenced, 'absent', null, {
        attemptStartedAt: minutesAgo(20),
        evidence,
      })

      expect(deps.dispatchEvidence.findDispatchEvidence).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
      expect(reconcile).not.toHaveBeenCalled()
      expect(
        deps.replyCommandStore.rescheduleAmbiguousReconciliation,
      ).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
        fenced,
        'ambiguous',
        expect.objectContaining({
          _tag: 'review.reply.publish_failed',
          outcome: 'unconfirmed',
        }),
        NOW,
      )
    },
  )

  // D6: an unreadable echo records no observation, so it cannot count toward
  // the absent-read cap; only the attempt's age bounds its wait.
  it('keeps an accepted reply waiting inside propagation grace when its echo is unreadable', async () => {
    const pending = makeReply('reply-unreadable-echo', 'pending_observation')
    const { deps } = await runOne(pending, 'unreadable', {
      attemptStartedAt: minutesAgo(10),
      absentObservationCount: 0,
    })

    expect(
      deps.replyCommandStore.deferPendingPublicationObservation,
    ).toHaveBeenCalledWith(pending, NOW)
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('moves an unreadable accepted reply onto the ladder once propagation grace ends', async () => {
    const pending = makeReply('reply-unreadable-late', 'pending_observation')
    const attemptStartedAt = minutesAgo(16)
    const { deps } = await runOne(pending, 'unreadable', {
      attemptStartedAt,
      absentObservationCount: 0,
    })

    expect(
      deps.replyCommandStore.deferPendingPublicationObservation,
    ).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledWith(
      pending,
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'unconfirmed',
      }),
      NOW,
      new Date(attemptStartedAt.getTime() + 30 * MINUTE),
    )
  })

  it('logs why a read was unreadable, content-free', async () => {
    const ambiguous = makeReply('reply-whitespace', 'ambiguous')
    const deps = makeDeps({
      batches: [[ambiguous]],
      reconcile: vi.fn(async () =>
        ok({
          outcome: 'unreadable' as const,
          reason: 'whitespace_only_difference' as const,
        }),
      ),
      attemptStartedAt: minutesAgo(20),
    })

    await createReconcileAmbiguousPublicationsHandler(deps as never)(makeJob())

    expect(deps.logger.info).toHaveBeenCalledWith(
      { reason: 'whitespace_only_difference' },
      expect.any(String),
    )
  })

  it('isolates a settlement write failure, processes the batch, then retries the sweep', async () => {
    const rows = [
      makeReply('reply-broken', 'ambiguous'),
      makeReply('reply-healed', 'pending_observation'),
    ]
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce(ok({ outcome: 'absent' }))
      .mockResolvedValueOnce(ok({ outcome: 'confirmed_on_google' }))
    const deps = makeDeps({ batches: [rows], reconcile })
    deps.replyCommandStore.markPublicationTerminal.mockRejectedValueOnce(
      new Error('database unavailable'),
    )

    await expect(
      createReconcileAmbiguousPublicationsHandler(deps as never)(makeJob()),
    ).rejects.toThrow(/1 row\(s\) failed/)
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(deps.leaseRelease).toHaveBeenCalledOnce()
  })

  it('keyset-paginates through settled rows', async () => {
    const first = [makeReply('reply-1', 'ambiguous'), makeReply('reply-2', 'ambiguous')]
    const second = [makeReply('reply-3', 'ambiguous')]
    const reconcile = vi.fn(async () => ok({ outcome: 'absent' as const }))
    const deps = makeDeps({ batches: [first, second], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      batchSize: 2,
    } as never)

    await handler(makeJob())

    const calls = vi.mocked(deps.replyRepo.findDuePublicationReconciliationBatch).mock
      .calls
    expect(calls).toEqual([
      [NOW, null, 2],
      [NOW, { reconcileDueAt: DUE, id: 'reply-2' }, 2],
      [NOW, { reconcileDueAt: DUE, id: 'reply-3' }, 2],
    ])
  })

  it('stops before starting another provider read when the monotonic run deadline closes', async () => {
    const rows = [makeReply('reply-1', 'ambiguous'), makeReply('reply-2', 'ambiguous')]
    let monotonicMs = 0
    const reconcile = vi.fn(async () => {
      monotonicMs = 240_000
      return ok({ outcome: 'absent' as const })
    })
    const deps = makeDeps({ batches: [rows], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      monotonicNowMs: () => monotonicMs,
      maxRunMs: 240_000,
    } as never)

    await handler(makeJob())

    expect(reconcile).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
    expect(deps.leaseRelease).toHaveBeenCalledOnce()
  })

  it('is a clean no-op when another replica holds the reconciliation lease', async () => {
    const reconcile = vi.fn()
    const deps = makeDeps({ batches: [[makeReply('reply-1', 'ambiguous')]], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      runLease: { tryAcquire: vi.fn(async () => null) },
    } as never)

    await handler(makeJob())

    expect(deps.replyRepo.findDuePublicationReconciliationBatch).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(deps.leaseRelease).not.toHaveBeenCalled()
  })
})
