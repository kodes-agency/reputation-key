// reconcile-ambiguous-publications sweep handler tests (BQC-3.8).
//
// Due rows (publication_state='ambiguous' AND reconcile_due_at <= now — the
// repository applies the predicate) are reconciled one by one via
// reconcileReplyPublication: healed rows leave the set, still-failed rows
// stay for operator retry, and any row failure is isolated, counted, and
// rethrown at the end so BullMQ retries (mirroring retention-sweep — a
// failed row is never acknowledged as success).

import { describe, it, expect, vi } from 'vitest'
import { createReconcileAmbiguousPublicationsHandler } from './reconcile-ambiguous-publications.job'
import { ok, err } from '#/shared/domain'
import { reviewError } from '../../domain/errors'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { Reply } from '../../domain/types'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const NOW = new Date('2026-07-17T00:00:00Z')
const DUE = new Date(NOW.getTime() - 60 * 1000) // due one minute ago
const ORG_ID = organizationId('org-1')

function makeAmbiguousReply(id: string, reconcileDueAt: Date = DUE): Reply {
  return {
    id: replyId(id),
    reviewId: reviewId(`rev-${id}`),
    organizationId: ORG_ID,
    text: 'Thank you!',
    status: 'publish_failed',
    source: 'internal',
    createdBy: userId('user-1'),
    approvedBy: userId('user-1'),
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'ambiguous',
    publicationAttempts: 3,
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeDeps(opts: {
  batches: ReadonlyArray<ReadonlyArray<Reply>>
  reconcile: ReturnType<typeof vi.fn>
}) {
  const batchQueue = [...opts.batches]
  const replyRepo = {
    findAmbiguousPublicationBatch: vi.fn(async () => batchQueue.shift() ?? []),
  } as unknown as ReplyRepository
  return {
    replyRepo,
    reconcileReplyPublication: opts.reconcile,
    clock: () => NOW,
  }
}

const makeJob = () => ({ id: 'job-1', data: {} }) as never

describe('reconcile-ambiguous-publications sweep', () => {
  it('reconciles every due row and reports counts (healed + still_failed)', async () => {
    const rows = [makeAmbiguousReply('reply-1'), makeAmbiguousReply('reply-2')]
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce(ok({ outcome: 'published' }))
      .mockResolvedValueOnce(ok({ outcome: 'still_failed' }))
    const deps = makeDeps({ batches: [rows], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    // The sweep asks the repo for DUE rows only (now = the run clock).
    expect(deps.replyRepo.findAmbiguousPublicationBatch).toHaveBeenCalledWith(
      NOW,
      null,
      500,
    )
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(reconcile).toHaveBeenNthCalledWith(1, {
      replyId: replyId('reply-1'),
      organizationId: ORG_ID,
    })
    expect(reconcile).toHaveBeenNthCalledWith(2, {
      replyId: replyId('reply-2'),
      organizationId: ORG_ID,
    })
  })

  it('an empty due set is a clean no-op', async () => {
    const reconcile = vi.fn()
    const deps = makeDeps({ batches: [[]], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('isolates a per-row failure, finishes the batch, then throws for the BullMQ retry', async () => {
    const rows = [
      makeAmbiguousReply('reply-1'),
      makeAmbiguousReply('reply-2'),
      makeAmbiguousReply('reply-3'),
    ]
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce(err(reviewError('sync_failed', 'provider read failed')))
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(ok({ outcome: 'published' }))
    const deps = makeDeps({ batches: [rows], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler(deps as never)

    await expect(handler(makeJob())).rejects.toThrow(/2 row\(s\) failed/)

    // Every row was attempted despite the failures.
    expect(reconcile).toHaveBeenCalledTimes(3)
  })

  it('keyset-paginates within a run using the last row of each batch', async () => {
    const first = [makeAmbiguousReply('reply-1'), makeAmbiguousReply('reply-2')]
    const second = [makeAmbiguousReply('reply-3')]
    const reconcile = vi.fn(async () => ok({ outcome: 'still_failed' as const }))
    const deps = makeDeps({ batches: [first, second], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      batchSize: 2,
    } as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    const calls = vi.mocked(deps.replyRepo.findAmbiguousPublicationBatch).mock.calls
    // The loop probes until a batch comes back empty.
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual([NOW, null, 2])
    expect(calls[1]).toEqual([NOW, { reconcileDueAt: DUE, id: 'reply-2' }, 2])
    expect(calls[2]).toEqual([NOW, { reconcileDueAt: DUE, id: 'reply-3' }, 2])
  })

  it('stops at the batch budget', async () => {
    const row = makeAmbiguousReply('reply-1')
    const reconcile = vi.fn(async () => ok({ outcome: 'still_failed' as const }))
    const deps = makeDeps({ batches: [[row], [row], [row]], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      batchSize: 1,
      maxBatches: 2,
    } as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()
    expect(deps.replyRepo.findAmbiguousPublicationBatch).toHaveBeenCalledTimes(2)
  })
})
