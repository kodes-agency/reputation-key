// reconcile-ambiguous-publications sweep handler tests (BQC-3.8).
//
// Due provider-pending and ambiguous rows (the repository applies the
// predicate) are reconciled one by one via
// reconcileReplyPublication: healed rows leave the set, still-failed rows
// stay for operator retry, and any row failure is isolated, counted, and
// rethrown at the end so BullMQ retries (mirroring retention-sweep — a
// failed row is never acknowledged as success).

import { describe, it, expect, vi } from 'vitest'
import { createReconcileAmbiguousPublicationsHandler } from './reconcile-ambiguous-publications.job'
import { ok, err } from '#/shared/domain'
import { reviewError } from '../../domain/errors'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReconcileReplyPublicationInput } from '../../application/use-cases/reconcile-reply-publication'
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
const PENDING_NEXT_DUE = new Date(NOW.getTime() + 60 * 1000)
const AMBIGUOUS_NEXT_DUE = new Date(NOW.getTime() + 15 * 60 * 1000)
const ORG_ID = organizationId('org-1')

function makeAmbiguousReply(
  id: string,
  reconcileDueAt: Date = DUE,
  overrides: Partial<Reply> = {},
): Reply {
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
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'ambiguous',
    publicationCycle: 1,
    publicationAttempts: 3,
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt,
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
  const replyRepo = {
    findDuePublicationReconciliationBatch: vi.fn(async () => batchQueue.shift() ?? []),
    deferPublicationReconciliation: vi.fn(async () => true),
  } as unknown as ReplyRepository
  return {
    replyRepo,
    reconcileReplyPublication: opts.reconcile,
    clock: () => NOW,
    runLease: {
      tryAcquire: vi.fn(async () => ({ release: leaseRelease })),
    },
    leaseRelease,
  }
}

const makeJob = () => ({ id: 'job-1', data: {} }) as never

describe('reconcile-ambiguous-publications sweep', () => {
  it('reconciles every due row and reports counts (healed + still_failed)', async () => {
    const rows = [makeAmbiguousReply('reply-1'), makeAmbiguousReply('reply-2')]
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce(ok({ outcome: 'confirmed_on_google' }))
      .mockResolvedValueOnce(ok({ outcome: 'absent' }))
    const deps = makeDeps({ batches: [rows], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()
    expect(deps.leaseRelease).toHaveBeenCalledOnce()

    // The sweep asks the repo for DUE rows only (now = the run clock).
    expect(deps.replyRepo.findDuePublicationReconciliationBatch).toHaveBeenCalledWith(
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
    expect(deps.replyRepo.deferPublicationReconciliation).toHaveBeenCalledOnce()
    expect(deps.replyRepo.deferPublicationReconciliation).toHaveBeenCalledWith({
      replyId: replyId('reply-2'),
      organizationId: ORG_ID,
      publicationCycle: 1,
      publicationState: 'ambiguous',
      currentDueAt: DUE,
      nextDueAt: AMBIGUOUS_NEXT_DUE,
      updatedAt: NOW,
    })
  })

  it('keeps a pending observation moving on a deterministic short retry window', async () => {
    const pending = makeAmbiguousReply('reply-pending', DUE, {
      status: 'approved',
      publicationState: 'pending_observation',
    })
    const reconcile = vi.fn(async (_input: ReconcileReplyPublicationInput) =>
      ok({ outcome: 'absent' as const }),
    )
    const deps = makeDeps({ batches: [[pending]], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.replyRepo.deferPublicationReconciliation).toHaveBeenCalledWith({
      replyId: replyId('reply-pending'),
      organizationId: ORG_ID,
      publicationCycle: 1,
      publicationState: 'pending_observation',
      currentDueAt: DUE,
      nextDueAt: PENDING_NEXT_DUE,
      updatedAt: NOW,
    })
  })

  it('starts each deferral window after that row finishes reconciling', async () => {
    const pending = makeAmbiguousReply('reply-slow', DUE, {
      status: 'approved',
      publicationState: 'pending_observation',
    })
    const finishedAt = new Date(NOW.getTime() + 2 * 60 * 1000)
    const clock = vi.fn().mockReturnValueOnce(NOW).mockReturnValueOnce(finishedAt)
    const reconcile = vi.fn(async (_input: ReconcileReplyPublicationInput) =>
      ok({ outcome: 'absent' as const }),
    )
    const deps = makeDeps({ batches: [[pending]], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      clock,
    } as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.replyRepo.deferPublicationReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        replyId: pending.id,
        updatedAt: finishedAt,
        nextDueAt: new Date(
          finishedAt.getTime() + (PENDING_NEXT_DUE.getTime() - NOW.getTime()),
        ),
      }),
    )
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
      .mockResolvedValueOnce(ok({ outcome: 'confirmed_on_google' }))
    const deps = makeDeps({ batches: [rows], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler(deps as never)

    await expect(handler(makeJob())).rejects.toThrow(/2 row\(s\) failed/)
    expect(deps.leaseRelease).toHaveBeenCalledOnce()

    // Every row was attempted despite the failures.
    expect(reconcile).toHaveBeenCalledTimes(3)
    // Failed provider reads are also moved out of this run's due set before
    // BullMQ retries, so one unhealthy row cannot monopolize the first page.
    expect(deps.replyRepo.deferPublicationReconciliation).toHaveBeenCalledTimes(2)
  })

  it('keyset-paginates within a run using the last row of each batch', async () => {
    const first = [makeAmbiguousReply('reply-1'), makeAmbiguousReply('reply-2')]
    const second = [makeAmbiguousReply('reply-3')]
    const reconcile = vi.fn(async () => ok({ outcome: 'absent' as const }))
    const deps = makeDeps({ batches: [first, second], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      batchSize: 2,
    } as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    const calls = vi.mocked(deps.replyRepo.findDuePublicationReconciliationBatch).mock
      .calls
    // The loop probes until a batch comes back empty.
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual([NOW, null, 2])
    expect(calls[1]).toEqual([NOW, { reconcileDueAt: DUE, id: 'reply-2' }, 2])
    expect(calls[2]).toEqual([NOW, { reconcileDueAt: DUE, id: 'reply-3' }, 2])
  })

  it('stops at the batch budget', async () => {
    const row = makeAmbiguousReply('reply-1')
    const reconcile = vi.fn(async () => ok({ outcome: 'absent' as const }))
    const deps = makeDeps({ batches: [[row], [row], [row]], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      batchSize: 1,
      maxBatches: 2,
    } as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()
    expect(deps.replyRepo.findDuePublicationReconciliationBatch).toHaveBeenCalledTimes(2)
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('stops before starting another provider read when the monotonic run deadline closes', async () => {
    const rows = [makeAmbiguousReply('reply-1'), makeAmbiguousReply('reply-2')]
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

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(reconcile).toHaveBeenCalledOnce()
    expect(reconcile).toHaveBeenCalledWith({
      replyId: replyId('reply-1'),
      organizationId: ORG_ID,
    })
    expect(deps.replyRepo.deferPublicationReconciliation).toHaveBeenCalledOnce()
    expect(deps.leaseRelease).toHaveBeenCalledOnce()
  })

  it('is a clean no-op when another replica holds the reconciliation lease', async () => {
    const reconcile = vi.fn()
    const deps = makeDeps({ batches: [[makeAmbiguousReply('reply-1')]], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      runLease: { tryAcquire: vi.fn(async () => null) },
    } as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.replyRepo.findDuePublicationReconciliationBatch).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(deps.leaseRelease).not.toHaveBeenCalled()
  })

  it('charges lease acquisition to the monotonic run budget', async () => {
    let monotonicMs = 0
    const reconcile = vi.fn()
    const deps = makeDeps({ batches: [[makeAmbiguousReply('reply-1')]], reconcile })
    const handler = createReconcileAmbiguousPublicationsHandler({
      ...deps,
      monotonicNowMs: () => monotonicMs,
      maxRunMs: 240_000,
      runLease: {
        tryAcquire: vi.fn(async () => {
          monotonicMs = 240_000
          return { release: deps.leaseRelease }
        }),
      },
    } as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.replyRepo.findDuePublicationReconciliationBatch).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(deps.leaseRelease).toHaveBeenCalledOnce()
  })

  it('reschedules an old absent row so a later due row gets the next bounded page', async () => {
    const firstDue = new Date(NOW.getTime() - 2 * 60 * 1000)
    const laterDue = new Date(NOW.getTime() - 60 * 1000)
    let rows = [
      makeAmbiguousReply('reply-old', firstDue),
      makeAmbiguousReply('reply-later', laterDue),
    ]
    const replyRepo = {
      findDuePublicationReconciliationBatch: vi.fn(
        async (
          now: Date,
          cursor: Readonly<{ reconcileDueAt: Date; id: string }> | null,
          limit: number,
        ) =>
          rows
            .filter(
              (row) =>
                row.reconcileDueAt !== null &&
                row.reconcileDueAt <= now &&
                (cursor === null ||
                  row.reconcileDueAt > cursor.reconcileDueAt ||
                  (row.reconcileDueAt.getTime() === cursor.reconcileDueAt.getTime() &&
                    row.id > cursor.id)),
            )
            .sort(
              (left, right) =>
                left.reconcileDueAt!.getTime() - right.reconcileDueAt!.getTime() ||
                left.id.localeCompare(right.id),
            )
            .slice(0, limit),
      ),
      deferPublicationReconciliation: vi.fn(
        async (command: { replyId: string; nextDueAt: Date }) => {
          rows = rows.map((row) =>
            row.id === command.replyId
              ? { ...row, reconcileDueAt: command.nextDueAt }
              : row,
          )
          return true
        },
      ),
    } as unknown as ReplyRepository
    const reconcile = vi.fn(async (_input: ReconcileReplyPublicationInput) =>
      ok({ outcome: 'absent' as const }),
    )
    const handler = createReconcileAmbiguousPublicationsHandler({
      replyRepo,
      reconcileReplyPublication: reconcile as never,
      clock: () => NOW,
      runLease: {
        tryAcquire: async () => ({ release: async () => {} }),
      },
      batchSize: 1,
      maxBatches: 2,
    })

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(reconcile.mock.calls.map(([input]) => input.replyId)).toEqual([
      replyId('reply-old'),
      replyId('reply-later'),
    ])
  })
})
