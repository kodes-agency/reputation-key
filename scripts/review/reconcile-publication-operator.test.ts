import { describe, expect, it, vi } from 'vitest'
import { ok } from '../../src/shared/domain'
import { organizationId, replyId, reviewId, userId } from '../../src/shared/domain/ids'
import type { Reply } from '../../src/contexts/review/domain/types'
import type { ReconcileReplyPublicationInput } from '../../src/contexts/review/application/use-cases/reconcile-reply-publication'
import {
  decodePublicationSweepResume,
  extractPublicationSweepResume,
  runAmbiguousPublicationSweepPage,
} from '../ops/reconcile-publication'

const DUE_THROUGH = new Date('2026-08-26T19:00:00.000Z')
const LATER = new Date('2026-08-26T20:00:00.000Z')
const ORG = organizationId('org-publication-sweep-test')
const REVIEW = reviewId('b1000000-0000-4000-8000-000000000010')
const ACTOR = userId('operator-publication-sweep-test')

function ambiguousReply(id: string, reconcileDueAt: Date): Reply {
  return {
    id: replyId(id),
    reviewId: REVIEW,
    organizationId: ORG,
    text: 'Identifier-free fixture text',
    status: 'publish_failed',
    source: 'internal',
    createdBy: ACTOR,
    approvedBy: ACTOR,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 2,
    submittedAt: DUE_THROUGH,
    approvedAt: DUE_THROUGH,
    publishedAt: null,
    publicationState: 'ambiguous',
    publicationCycle: 1,
    publicationAttempts: 1,
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt,
    createdAt: DUE_THROUGH,
    updatedAt: DUE_THROUGH,
  }
}

describe('operator ambiguous-publication sweep continuation', () => {
  it('resumes after persistent non-healing rows while preserving the original due-through boundary', async () => {
    const rows = [
      ambiguousReply(
        'b1000000-0000-4000-8000-000000000021',
        new Date('2026-08-26T18:00:00.000Z'),
      ),
      ambiguousReply(
        'b1000000-0000-4000-8000-000000000022',
        new Date('2026-08-26T18:01:00.000Z'),
      ),
      ambiguousReply(
        'b1000000-0000-4000-8000-000000000023',
        new Date('2026-08-26T18:02:00.000Z'),
      ),
    ]
    const findBatch = vi.fn(
      async (
        dueThrough: Date,
        cursor: Readonly<{ reconcileDueAt: Date; id: string }> | null,
        limit: number,
      ) =>
        rows
          .filter(
            (row) =>
              row.reconcileDueAt !== null &&
              row.reconcileDueAt <= dueThrough &&
              (!cursor ||
                row.reconcileDueAt > cursor.reconcileDueAt ||
                (row.reconcileDueAt.getTime() === cursor.reconcileDueAt.getTime() &&
                  row.id > cursor.id)),
          )
          .slice(0, limit),
    )
    const reconcile = vi.fn(async (input: ReconcileReplyPublicationInput) => {
      expect(input.organizationId).toBe(ORG)
      return ok({ outcome: 'provider_review_missing' as const })
    })

    const first = await runAmbiguousPublicationSweepPage(
      { findBatch, reconcile, clock: () => DUE_THROUGH },
      { batchSize: 2, resumeToken: null, dryRun: false },
    )
    expect(first).toMatchObject({
      coverage: 'partial',
      coverageScope: 'frozen_due_through_keyset_segment',
      outcomeScope: 'current_page',
      dueThrough: DUE_THROUGH.toISOString(),
      seen: 2,
      confirmedOnGoogle: 0,
      notConfirmed: 2,
      failed: 0,
    })
    expect(first.nextResumeToken).toEqual(expect.any(String))
    expect(first.rows).toEqual(
      rows.slice(0, 2).map((row) => ({
        replyId: row.id,
        organizationId: row.organizationId,
        reconcileDueAt: row.reconcileDueAt!.toISOString(),
        outcome: 'not_confirmed',
        detail: 'provider_review_missing',
      })),
    )

    const decoded = decodePublicationSweepResume(first.nextResumeToken!)
    expect(decoded).toEqual({
      mode: 'apply',
      dueThrough: DUE_THROUGH,
      reconcileDueAt: rows[1]!.reconcileDueAt,
      id: rows[1]!.id,
    })

    const second = await runAmbiguousPublicationSweepPage(
      { findBatch, reconcile, clock: () => LATER },
      { batchSize: 2, resumeToken: first.nextResumeToken, dryRun: false },
    )
    expect(second).toMatchObject({
      coverage: 'complete',
      dueThrough: DUE_THROUGH.toISOString(),
      seen: 1,
      confirmedOnGoogle: 0,
      notConfirmed: 1,
      failed: 0,
      nextResumeToken: null,
    })
    expect(findBatch).toHaveBeenNthCalledWith(
      2,
      DUE_THROUGH,
      { reconcileDueAt: rows[1]!.reconcileDueAt, id: rows[1]!.id },
      2,
    )
    expect(reconcile.mock.calls.map((call) => call[0]!.replyId)).toEqual(
      rows.map((row) => row.id),
    )
  })

  it('isolates a thrown reconciliation so the page still checkpoints later rows', async () => {
    const rows = [
      ambiguousReply(
        'b1000000-0000-4000-8000-000000000031',
        new Date('2026-08-26T18:10:00.000Z'),
      ),
      ambiguousReply(
        'b1000000-0000-4000-8000-000000000032',
        new Date('2026-08-26T18:11:00.000Z'),
      ),
    ]
    const reconcile = vi.fn(async ({ replyId: currentReplyId }) => {
      if (currentReplyId === rows[0]!.id) throw new Error('provider read crashed')
      return ok({ outcome: 'confirmed_on_google' as const })
    })

    const report = await runAmbiguousPublicationSweepPage(
      {
        findBatch: vi.fn(async () => rows),
        reconcile,
        clock: () => DUE_THROUGH,
      },
      { batchSize: 2, resumeToken: null, dryRun: false },
    )

    expect(report).toMatchObject({
      coverage: 'partial',
      seen: 2,
      attempted: 2,
      confirmedOnGoogle: 1,
      notConfirmed: 0,
      failed: 1,
      unresolvedInPage: 1,
    })
    expect(report.nextResumeToken).toEqual(expect.any(String))
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(report.rows).toMatchObject([
      {
        replyId: rows[0]!.id,
        outcome: 'failed',
        detail: 'unexpected_error',
      },
      {
        replyId: rows[1]!.id,
        outcome: 'confirmed_on_google',
        detail: null,
      },
    ])
  })

  it('reports dry-run rows without evaluating provider truth', async () => {
    const rows = [
      ambiguousReply(
        'b1000000-0000-4000-8000-000000000041',
        new Date('2026-08-26T18:20:00.000Z'),
      ),
    ]
    const reconcile = vi.fn()

    const report = await runAmbiguousPublicationSweepPage(
      {
        findBatch: vi.fn(async () => rows),
        reconcile,
        clock: () => DUE_THROUGH,
      },
      { batchSize: 2, resumeToken: null, dryRun: true },
    )

    expect(report).toMatchObject({
      mode: 'dry_run',
      coverage: 'complete',
      coverageScope: 'frozen_due_through_keyset_segment',
      outcomeScope: 'current_page',
      seen: 1,
      attempted: 0,
      notEvaluated: 1,
      confirmedOnGoogle: 0,
      notConfirmed: 0,
      failed: 0,
      unresolvedInPage: 1,
      nextResumeToken: null,
    })
    expect(reconcile).not.toHaveBeenCalled()
    expect(report.rows[0]).toMatchObject({
      replyId: rows[0]!.id,
      outcome: 'not_evaluated',
      detail: null,
    })
  })

  it('does not allow a dry-run cursor to skip rows when switching to apply', async () => {
    const rows = [
      ambiguousReply(
        'b1000000-0000-4000-8000-000000000051',
        new Date('2026-08-26T18:30:00.000Z'),
      ),
    ]
    const findBatch = vi.fn(async () => rows)
    const dryRun = await runAmbiguousPublicationSweepPage(
      {
        findBatch,
        reconcile: vi.fn(),
        clock: () => DUE_THROUGH,
      },
      { batchSize: 1, resumeToken: null, dryRun: true },
    )

    await expect(
      runAmbiguousPublicationSweepPage(
        {
          findBatch,
          reconcile: vi.fn(),
          clock: () => LATER,
        },
        { batchSize: 1, resumeToken: dryRun.nextResumeToken, dryRun: false },
      ),
    ).rejects.toThrow('resume token mode does not match')
  })

  it('strips exactly one resume token before the shared operator parser runs', () => {
    expect(
      extractPublicationSweepResume([
        '--all-ambiguous',
        '--resume',
        'opaque-token',
        '--operator',
        'operator-1',
      ]),
    ).toEqual({
      argv: ['--all-ambiguous', '--operator', 'operator-1'],
      resumeToken: 'opaque-token',
    })
    expect(() => extractPublicationSweepResume(['--all-ambiguous', '--resume'])).toThrow(
      '--resume requires exactly one token',
    )
    expect(() =>
      extractPublicationSweepResume([
        '--all-ambiguous',
        '--resume',
        'first',
        '--resume',
        'second',
      ]),
    ).toThrow('--resume requires exactly one token')
  })
})
