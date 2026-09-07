import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createGoalProgramRepository } from './repositories/goal-program.repository'

function databaseReturning(rows: readonly Readonly<{ id: string }>[]) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(async () => rows)
  return {
    db: { select: vi.fn(() => chain) } as unknown as Database,
    chain,
  }
}

describe('Goal metric-correction candidate lookup', () => {
  it('returns deterministic unique closed-result identifiers', async () => {
    const { db, chain } = databaseReturning([
      { id: 'result-1' },
      { id: 'result-1' },
      { id: 'result-2' },
    ])

    await expect(
      createGoalProgramRepository(db).findClosedResultIdsForMetricImpact({
        organizationId: 'org-1',
        propertyId: '10000000-0000-4000-8000-000000000001',
        definitionVersionId: '10000000-0000-4000-8000-000000000002',
        portalId: '10000000-0000-4000-8000-000000000003',
        portalGroupId: '10000000-0000-4000-8000-000000000004',
        eventAt: new Date('2026-07-31T23:59:59.999Z'),
      }),
    ).resolves.toEqual(['result-1', 'result-2'])

    expect(chain.innerJoin).toHaveBeenCalledTimes(2)
    expect(chain.where).toHaveBeenCalledOnce()
    expect(chain.orderBy).toHaveBeenCalledOnce()
  })
})
