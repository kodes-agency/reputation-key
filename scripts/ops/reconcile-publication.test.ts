import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ok } from '../../src/shared/domain'
import { organizationId, replyId } from '../../src/shared/domain/ids'
import type {
  AmbiguousPublicationReconciliationCandidate,
  ReconcileReplyPublicationInput,
} from '../../src/contexts/review/application/public-api'
import {
  decodePublicationSweepResume,
  extractPublicationSweepResume,
  runAmbiguousPublicationSweepPage,
} from './reconcile-publication'

const DUE_THROUGH = new Date('2026-08-26T19:00:00.000Z')
const LATER = new Date('2026-08-26T20:00:00.000Z')
const ORG = organizationId('org-publication-sweep-test')

function ambiguousCandidate(
  id: string,
  reconcileDueAt: Date,
): AmbiguousPublicationReconciliationCandidate {
  return {
    replyId: replyId(id),
    organizationId: ORG,
    publicationState: 'ambiguous',
    reconcileDueAt,
  }
}

describe('operator ambiguous-publication sweep continuation', () => {
  it('accepts only the content-free Review candidate contract', () => {
    expectTypeOf<keyof AmbiguousPublicationReconciliationCandidate>().toEqualTypeOf<
      'replyId' | 'organizationId' | 'publicationState' | 'reconcileDueAt'
    >()
    expect(
      Object.keys(
        ambiguousCandidate('b1000000-0000-4000-8000-000000000020', DUE_THROUGH),
      ).sort(),
    ).toEqual(['organizationId', 'publicationState', 'reconcileDueAt', 'replyId'].sort())
  })

  it('resumes after persistent non-healing rows while preserving the original due-through boundary', async () => {
    const rows = [
      ambiguousCandidate(
        'b1000000-0000-4000-8000-000000000021',
        new Date('2026-08-26T18:00:00.000Z'),
      ),
      ambiguousCandidate(
        'b1000000-0000-4000-8000-000000000022',
        new Date('2026-08-26T18:01:00.000Z'),
      ),
      ambiguousCandidate(
        'b1000000-0000-4000-8000-000000000023',
        new Date('2026-08-26T18:02:00.000Z'),
      ),
    ]
    const findBatch = vi.fn(
      async (
        input: Readonly<{
          dueThrough: Date
          after: Readonly<{
            reconcileDueAt: Date
            replyId: ReturnType<typeof replyId>
          }> | null
          limit: number
        }>,
      ) => {
        const { dueThrough, after: cursor, limit } = input
        return rows
          .filter(
            (row) =>
              row.reconcileDueAt !== null &&
              row.reconcileDueAt <= dueThrough &&
              (!cursor ||
                row.reconcileDueAt > cursor.reconcileDueAt ||
                (row.reconcileDueAt.getTime() === cursor.reconcileDueAt.getTime() &&
                  row.replyId > cursor.replyId)),
          )
          .slice(0, limit)
      },
    )
    const reconcile = vi.fn(async (input: ReconcileReplyPublicationInput) => {
      expect(input.organizationId).toBe(ORG)
      return ok({ outcome: 'provider_review_missing' as const })
    })

    const first = await runAmbiguousPublicationSweepPage(
      { findCandidates: findBatch, reconcile, clock: () => DUE_THROUGH },
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
        replyId: row.replyId,
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
      id: rows[1]!.replyId,
    })

    const second = await runAmbiguousPublicationSweepPage(
      { findCandidates: findBatch, reconcile, clock: () => LATER },
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
    expect(findBatch).toHaveBeenNthCalledWith(2, {
      dueThrough: DUE_THROUGH,
      after: {
        reconcileDueAt: rows[1]!.reconcileDueAt,
        replyId: rows[1]!.replyId,
      },
      limit: 2,
    })
    expect(reconcile.mock.calls.map((call) => call[0]!.replyId)).toEqual(
      rows.map((row) => row.replyId),
    )
  })

  it('isolates a thrown reconciliation so the page still checkpoints later rows', async () => {
    const rows = [
      ambiguousCandidate(
        'b1000000-0000-4000-8000-000000000031',
        new Date('2026-08-26T18:10:00.000Z'),
      ),
      ambiguousCandidate(
        'b1000000-0000-4000-8000-000000000032',
        new Date('2026-08-26T18:11:00.000Z'),
      ),
    ]
    const reconcile = vi.fn(async ({ replyId: currentReplyId }) => {
      if (currentReplyId === rows[0]!.replyId) {
        throw new Error('provider read crashed')
      }
      return ok({ outcome: 'confirmed_on_google' as const })
    })

    const report = await runAmbiguousPublicationSweepPage(
      {
        findCandidates: vi.fn(async () => rows),
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
        replyId: rows[0]!.replyId,
        outcome: 'failed',
        detail: 'unexpected_error',
      },
      {
        replyId: rows[1]!.replyId,
        outcome: 'confirmed_on_google',
        detail: null,
      },
    ])
  })

  it('reports dry-run rows without evaluating provider truth', async () => {
    const rows = [
      ambiguousCandidate(
        'b1000000-0000-4000-8000-000000000041',
        new Date('2026-08-26T18:20:00.000Z'),
      ),
    ]
    const reconcile = vi.fn()

    const report = await runAmbiguousPublicationSweepPage(
      {
        findCandidates: vi.fn(async () => rows),
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
      replyId: rows[0]!.replyId,
      outcome: 'not_evaluated',
      detail: null,
    })
  })

  it('does not allow a dry-run cursor to skip rows when switching to apply', async () => {
    const rows = [
      ambiguousCandidate(
        'b1000000-0000-4000-8000-000000000051',
        new Date('2026-08-26T18:30:00.000Z'),
      ),
    ]
    const findBatch = vi.fn(async () => rows)
    const dryRun = await runAmbiguousPublicationSweepPage(
      {
        findCandidates: findBatch,
        reconcile: vi.fn(),
        clock: () => DUE_THROUGH,
      },
      { batchSize: 1, resumeToken: null, dryRun: true },
    )

    await expect(
      runAmbiguousPublicationSweepPage(
        {
          findCandidates: findBatch,
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
