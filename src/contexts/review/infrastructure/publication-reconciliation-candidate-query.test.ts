import { describe, expect, it, vi } from 'vitest'
import { organizationId, replyId } from '#/shared/domain/ids'
import { createPublicationReconciliationCandidateQuery } from './repositories/publication-reconciliation-candidate.repository'

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

function databaseReturning(rows: ReadonlyArray<Record<string, unknown>>) {
  const limit = vi.fn(async () => rows)
  const orderBy = vi.fn(() => ({ limit }))
  const where = vi.fn(() => ({ orderBy }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn((_projection: unknown) => ({ from }))
  return {
    db: { select } as never,
    select,
    limit,
  }
}

describe('publication reconciliation candidate query', () => {
  it('selects and returns only the content-free operator contract', async () => {
    const dueAt = new Date('2026-08-28T10:00:00.123Z')
    const reply = replyId('b1000000-0000-4000-8000-000000000091')
    const org = organizationId('org-publication-candidate-query')
    const { db, select, limit } = databaseReturning([
      {
        replyId: reply,
        organizationId: org,
        publicationState: 'ambiguous',
        reconcileDueAt: dueAt,
        text: 'must not cross the maintenance boundary',
        reviewerName: 'must not cross either',
      },
    ])

    const result = await createPublicationReconciliationCandidateQuery(
      db,
    ).findAmbiguousCandidates({
      dueThrough: new Date('2026-08-28T11:00:00.000Z'),
      after: null,
      limit: 25,
    })

    expect(Object.keys(select.mock.calls[0]![0] as object).sort()).toEqual(
      ['organizationId', 'publicationState', 'reconcileDueAt', 'replyId'].sort(),
    )
    expect(limit).toHaveBeenCalledWith(25)
    expect(result).toEqual([
      {
        replyId: reply,
        organizationId: org,
        publicationState: 'ambiguous',
        reconcileDueAt: dueAt,
      },
    ])
    expect(JSON.stringify(result)).not.toContain('must not cross')
  })

  it('fails closed if the persistence adapter violates the ambiguous-state contract', async () => {
    const { db } = databaseReturning([
      {
        replyId: 'b1000000-0000-4000-8000-000000000092',
        organizationId: 'org-publication-candidate-query',
        publicationState: 'pending_observation',
        reconcileDueAt: new Date('2026-08-28T10:00:00.000Z'),
      },
    ])

    await expect(
      createPublicationReconciliationCandidateQuery(db).findAmbiguousCandidates({
        dueThrough: new Date('2026-08-28T11:00:00.000Z'),
        after: null,
        limit: 1,
      }),
    ).rejects.toThrow('returned another state')
  })
})
