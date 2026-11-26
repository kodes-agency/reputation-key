import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { organizationId, replyId } from '../../src/shared/domain/ids'
import type { AmbiguousPublicationReconciliationCandidate } from '../../src/contexts/reputation/public-api'
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
    const first = await runAmbiguousPublicationSweepPage(
      { findCandidates: findBatch, clock: () => DUE_THROUGH },
      { batchSize: 2, resumeToken: null },
    )
    expect(first).toMatchObject({
      coverage: 'partial',
      coverageScope: 'frozen_due_through_keyset_segment',
      outcomeScope: 'current_page',
      dueThrough: DUE_THROUGH.toISOString(),
      seen: 2,
      notEvaluated: 2,
    })
    expect(first.nextResumeToken).toEqual(expect.any(String))
    expect(first.rows).toEqual(
      rows.slice(0, 2).map((row) => ({
        replyId: row.replyId,
        organizationId: row.organizationId,
        reconcileDueAt: row.reconcileDueAt!.toISOString(),
        outcome: 'not_evaluated',
        detail: null,
      })),
    )

    const decoded = decodePublicationSweepResume(first.nextResumeToken!)
    expect(decoded).toEqual({
      dueThrough: DUE_THROUGH,
      reconcileDueAt: rows[1]!.reconcileDueAt,
      id: rows[1]!.replyId,
    })

    const second = await runAmbiguousPublicationSweepPage(
      { findCandidates: findBatch, clock: () => LATER },
      { batchSize: 2, resumeToken: first.nextResumeToken },
    )
    expect(second).toMatchObject({
      coverage: 'complete',
      dueThrough: DUE_THROUGH.toISOString(),
      seen: 1,
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
  })

  it('reports dry-run rows without evaluating provider truth', async () => {
    const rows = [
      ambiguousCandidate(
        'b1000000-0000-4000-8000-000000000041',
        new Date('2026-08-26T18:20:00.000Z'),
      ),
    ]

    const report = await runAmbiguousPublicationSweepPage(
      { findCandidates: vi.fn(async () => rows), clock: () => DUE_THROUGH },
      { batchSize: 2, resumeToken: null },
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
    expect(report.rows[0]).toMatchObject({
      replyId: rows[0]!.replyId,
      outcome: 'not_evaluated',
      detail: null,
    })
  })

  it('resumes from a token that still carries the retired mode field', async () => {
    const token = Buffer.from(
      JSON.stringify({
        v: 1,
        mode: 'dry_run',
        dueThrough: DUE_THROUGH.toISOString(),
        reconcileDueAt: DUE_THROUGH.toISOString(),
        id: 'b1000000-0000-4000-8000-000000000051',
      }),
      'utf8',
    ).toString('base64url')

    expect(decodePublicationSweepResume(token)).toEqual({
      dueThrough: DUE_THROUGH,
      reconcileDueAt: DUE_THROUGH,
      id: 'b1000000-0000-4000-8000-000000000051',
    })
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
