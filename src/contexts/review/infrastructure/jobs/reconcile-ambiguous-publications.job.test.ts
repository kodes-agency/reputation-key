// Reconciliation sweep liveness tests.
//
// Every due publication state must leave the due set: provider-safe authorized
// work fails terminally, uncertain sends become operator-visible ambiguity, and
// ambiguity gets one final read before automatic reconciliation stops.

import { describe, expect, it, vi } from 'vitest'
import { createReconcileAmbiguousPublicationsHandler } from './reconcile-ambiguous-publications.job'
import { err, ok } from '#/shared/domain'
import { reviewError } from '../../domain/errors'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReconcileReplyPublicationInput } from '../../application/use-cases/reconcile-reply-publication'
import type { Reply } from '../../domain/types'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const NOW = new Date('2026-07-17T00:00:00Z')
const DUE = new Date(NOW.getTime() - 60_000)
const ORG_ID = organizationId('org-1')

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
  }
}

function makeDeps(opts: {
  batches: ReadonlyArray<ReadonlyArray<Reply>>
  reconcile: ReturnType<typeof vi.fn>
}) {
  const batchQueue = [...opts.batches]
  const leaseRelease = vi.fn(async () => {})
  const markPublicationAmbiguous = vi.fn(async (reply: Reply) => ({
    ...reply,
    status: 'publish_failed' as const,
    publicationState: 'ambiguous' as const,
    publicationLastErrorClass: 'ambiguous' as const,
  }))
  const markPublicationTerminal = vi.fn(
    async (reply: Reply, errorClass: Reply['publicationLastErrorClass']) => ({
      ...reply,
      status: 'publish_failed' as const,
      publicationState: 'terminal' as const,
      publicationLastErrorClass: errorClass,
      reconcileDueAt: null,
    }),
  )
  const replyRepo = {
    findDuePublicationReconciliationBatch: vi.fn(async () => batchQueue.shift() ?? []),
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
      markPublicationAmbiguous,
      markPublicationTerminal,
    },
    reconcileReplyPublication: opts.reconcile,
    clock: () => NOW,
    logger: { info: vi.fn(), warn: vi.fn() },
    runLease: {
      tryAcquire: vi.fn(async () => ({ release: leaseRelease })),
    },
    leaseRelease,
  }
}

const makeJob = () => ({ id: 'job-1', data: {} }) as never

async function runOne(reply: Reply, outcome: 'confirmed_on_google' | 'absent') {
  const reconcile = vi.fn(async (_input: ReconcileReplyPublicationInput) =>
    ok({ outcome }),
  )
  const deps = makeDeps({ batches: [[reply]], reconcile })
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
      expect.objectContaining({ _tag: 'review.reply.publish_failed' }),
      NOW,
    )
  })

  it('drives a stranded sending attempt through ambiguity to terminal without another PUT', async () => {
    const sending = makeReply('reply-sending', 'sending')
    const first = await runOne(sending, 'absent')

    expect(first.reconcile).toHaveBeenCalledOnce()
    expect(first.deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledWith(
      sending,
      expect.objectContaining({ _tag: 'review.reply.publish_failed' }),
      NOW,
    )
    expect(first.deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()

    const ambiguous = makeReply('reply-sending', 'ambiguous')
    const second = await runOne(ambiguous, 'absent')
    expect(second.reconcile).toHaveBeenCalledOnce()
    expect(second.deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      ambiguous,
      'ambiguous',
      null,
      NOW,
    )
  })

  it('bounds accepted-but-unobserved publication to two reads and a terminal outcome', async () => {
    const pending = makeReply('reply-pending', 'pending_observation')
    const first = await runOne(pending, 'absent')

    expect(first.deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledOnce()
    expect(first.deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()

    const ambiguous = makeReply('reply-pending', 'ambiguous')
    const second = await runOne(ambiguous, 'absent')
    expect(second.deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
    expect(first.reconcile).toHaveBeenCalledOnce()
    expect(second.reconcile).toHaveBeenCalledOnce()
  })

  it('terminally settles a due ambiguous row after its final non-confirming read', async () => {
    const ambiguous = makeReply('reply-ambiguous', 'ambiguous')
    const { deps } = await runOne(ambiguous, 'absent')

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      ambiguous,
      'ambiguous',
      null,
      NOW,
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('leaves provider-confirmed work untouched by failure settlement', async () => {
    const pending = makeReply('reply-confirmed', 'pending_observation')
    const { deps } = await runOne(pending, 'confirmed_on_google')

    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it('turns a failed first provider read into ambiguity, then stops after the final read failure', async () => {
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
    const secondDeps = makeDeps({ batches: [[ambiguous]], reconcile: secondReconcile })
    await createReconcileAmbiguousPublicationsHandler(secondDeps as never)(makeJob())
    expect(secondDeps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
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
